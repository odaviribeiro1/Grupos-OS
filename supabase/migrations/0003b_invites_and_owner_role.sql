-- ============================================================================
-- Migration 0003b: convites + role owner/member (parte 2)
--
-- Pré-requisito: 0003a já rodou (valores 'owner'/'member' commitados no enum).
-- Owner = único, criado no primeiro signup (ou existing admin promovido)
-- Member = entra via convite (link válido por 7 dias)
-- Roles antigas (admin, editor) permanecem no enum por compatibilidade
-- ============================================================================

set search_path to grupos, public;

-- 1. Tabela de convites
create table if not exists grupos.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique,
  role grupos.user_role not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invites_token_idx
  on grupos.invites(token)
  where used_at is null and revoked_at is null;

create index if not exists invites_email_idx on grupos.invites(email);

alter table grupos.invites enable row level security;

drop policy if exists invites_owner_all on grupos.invites;
create policy invites_owner_all on grupos.invites
  for all using (
    exists (
      select 1 from grupos.users
      where id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- 3. Substituir trigger handle_new_auth_user
-- Comportamento novo:
--   - Se grupos.users está vazia: novo user vira 'owner' sem precisar de convite
--   - Senão: precisa do invite_token em raw_user_meta_data, válido e correspondendo ao email
create or replace function grupos.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = grupos, public, auth
as $$
declare
  v_user_count int;
  v_invite_token text;
  v_invite_record grupos.invites%rowtype;
  v_role grupos.user_role;
begin
  select count(*) into v_user_count from grupos.users;

  -- Caso 1: primeira pessoa do sistema vira owner (sem convite)
  if v_user_count = 0 then
    insert into grupos.users (id, email, name, role)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      'owner'
    )
    on conflict (id) do nothing;
    return new;
  end if;

  -- Caso 2: signup só com convite válido
  v_invite_token := new.raw_user_meta_data->>'invite_token';

  if v_invite_token is null or v_invite_token = '' then
    raise exception 'Self-signup desabilitado. Solicite um convite ao owner desta instância.';
  end if;

  select * into v_invite_record
  from grupos.invites
  where token = v_invite_token
    and used_at is null
    and revoked_at is null
    and expires_at > now()
    and lower(email) = lower(new.email);

  if not found then
    raise exception 'Convite inválido, expirado, já utilizado ou email não corresponde.';
  end if;

  v_role := v_invite_record.role;

  -- Marcar convite como usado
  update grupos.invites
  set used_at = now()
  where id = v_invite_record.id;

  -- Criar registro do usuário com a role do convite
  insert into grupos.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function grupos.handle_new_auth_user();

-- 4. Migrar primeiro user existente para 'owner' (se ainda for admin)
-- Compatibilidade: instâncias antigas tinham todos como admin; o primeiro vira owner.
update grupos.users
set role = 'owner', updated_at = now()
where id = (select id from grupos.users order by created_at asc limit 1)
  and role = 'admin';

-- 5. Helper: função que retorna se o usuário atual é owner
create or replace function grupos.is_owner()
returns boolean
language sql
stable
security definer
set search_path = grupos
as $$
  select exists (
    select 1 from grupos.users
    where id = auth.uid() and role = 'owner'
  );
$$;
