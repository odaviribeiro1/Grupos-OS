-- ============================================================================
-- Migration 0007: convites via Supabase Auth (substitui o sistema por token)
--
-- Antes: convite gerava um token em grupos.invites e o aceite acontecia em
-- /invite?token=... via supabase.auth.signUp({ data: { invite_token } }).
-- Agora: o admin usa auth.admin.inviteUserByEmail — o Supabase cria o usuário
-- (com invited_at preenchido), envia o email com link, e a pessoa define a senha
-- em /set-password. Sem token, sem tabela de convites, sem Resend.
-- ============================================================================

set search_path to grupos, public;

-- 1. Novo trigger de signup:
--    - grupos.users vazia  -> primeiro usuário vira 'owner' (bootstrap)
--    - convidado pelo admin (invited_at preenchido pelo inviteUserByEmail) -> entra
--      com a role vinda do user_metadata (default 'member')
--    - self-signup público (invited_at nulo) continua BLOQUEADO
create or replace function grupos.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = grupos, public, auth
as $$
declare
  v_user_count int;
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

  -- Caso 2: apenas usuários convidados via Supabase Auth (admin.inviteUserByEmail
  -- preenche invited_at). Self-signup público (invited_at nulo) é bloqueado.
  if new.invited_at is null then
    raise exception 'Self-signup desabilitado. Solicite um convite ao owner desta instância.';
  end if;

  v_role := case
    when new.raw_user_meta_data->>'role' in ('member', 'editor', 'admin')
      then (new.raw_user_meta_data->>'role')::grupos.user_role
    else 'member'::grupos.user_role
  end;

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

-- Recriar o trigger (a função acima já é referenciada por ele; recriar por segurança)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function grupos.handle_new_auth_user();

-- 2. Remover a tabela de convites por token (substituída pelo fluxo do Auth).
--    cascade derruba policy/índices associados.
drop table if exists grupos.invites cascade;
