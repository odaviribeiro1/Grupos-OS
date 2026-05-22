-- ============================================================================
-- GrupOS — Módulo 1: Schema grupos (fundação)
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;

create schema if not exists grupos;

-- ============================================================================
-- ENUMS
-- ============================================================================
do $$ begin
  create type grupos.user_role as enum ('admin', 'editor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grupos.summary_period_type as enum ('6h', '12h', 'today', 'yesterday', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grupos.discussion_status as enum ('resolved', 'pending');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- TRIGGER DE updated_at
-- ============================================================================
create or replace function grupos.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================================
-- USERS
-- ============================================================================
create table if not exists grupos.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  avatar_url text,
  role grupos.user_role not null default 'editor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on grupos.users;
create trigger set_updated_at before update on grupos.users
  for each row execute function grupos.tg_set_updated_at();

-- ============================================================================
-- UAZAPI CONFIG
-- ============================================================================
create table if not exists grupos.uazapi_config (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references grupos.users(id) on delete cascade,
  instance_id text,
  instance_connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on grupos.uazapi_config;
create trigger set_updated_at before update on grupos.uazapi_config
  for each row execute function grupos.tg_set_updated_at();

-- ============================================================================
-- GROUPS
-- ============================================================================
create table if not exists grupos.groups (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references grupos.users(id) on delete cascade,
  uazapi_config_id uuid references grupos.uazapi_config(id) on delete set null,
  whatsapp_group_id text not null,
  name text not null,
  participant_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on grupos.groups;
create trigger set_updated_at before update on grupos.groups
  for each row execute function grupos.tg_set_updated_at();

-- ============================================================================
-- GROUP RULES
-- ============================================================================
create table if not exists grupos.group_rules (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references grupos.groups(id) on delete cascade,
  rule_text text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- GROUP PARTICIPANTS
-- ============================================================================
create table if not exists grupos.group_participants (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references grupos.groups(id) on delete cascade,
  jid text not null,
  lid text,
  phone_number text,
  display_name text,
  is_admin boolean not null default false,
  is_super_admin boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (group_id, jid)
);
drop trigger if exists set_updated_at on grupos.group_participants;
create trigger set_updated_at before update on grupos.group_participants
  for each row execute function grupos.tg_set_updated_at();

-- ============================================================================
-- MESSAGES
-- ============================================================================
create table if not exists grupos.messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references grupos.groups(id) on delete cascade,
  uazapi_message_id text,
  chat_id text,
  sender_jid text,
  sender_name text,
  message_type text,
  text text,
  original_audio_url text,
  is_transcribed boolean not null default false,
  quoted_message_id text,
  from_me boolean not null default false,
  was_sent_by_api boolean not null default false,
  message_timestamp timestamptz,
  ai_metadata jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_group_ts
  on grupos.messages (group_id, message_timestamp);
create index if not exists idx_messages_group_created
  on grupos.messages (group_id, created_at);
create index if not exists idx_messages_sender_jid
  on grupos.messages (sender_jid);

-- ============================================================================
-- KNOWLEDGE BASE
-- ============================================================================
create table if not exists grupos.knowledge_base (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references grupos.groups(id) on delete cascade,
  title text not null,
  content text not null,
  embedding vector(1536),
  file_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_embedding
  on grupos.knowledge_base using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================================
-- SUMMARIES
-- ============================================================================
create table if not exists grupos.summaries (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references grupos.groups(id) on delete cascade,
  period_type grupos.summary_period_type not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  summary_text text,
  summary_json jsonb,
  message_count integer not null default 0,
  participant_count integer not null default 0,
  peak_hour text,
  avg_response_time_minutes integer,
  sentiment jsonb,
  is_auto_generated boolean not null default false,
  sent_to_group boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_summaries_group_period
  on grupos.summaries (group_id, period_start);

-- ============================================================================
-- DISCUSSIONS
-- ============================================================================
create table if not exists grupos.discussions (
  id uuid primary key default uuid_generate_v4(),
  summary_id uuid not null references grupos.summaries(id) on delete cascade,
  title text not null,
  description text,
  status grupos.discussion_status not null default 'pending',
  message_count integer not null default 0,
  related_message_ids text[],
  created_at timestamptz not null default now()
);

-- ============================================================================
-- PENDING ITEMS
-- ============================================================================
create table if not exists grupos.pending_items (
  id uuid primary key default uuid_generate_v4(),
  summary_id uuid not null references grupos.summaries(id) on delete cascade,
  description text not null,
  assigned_participant_jid text,
  assigned_participant_name text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- CHAT SESSIONS
-- ============================================================================
create table if not exists grupos.chat_sessions (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references grupos.groups(id) on delete cascade,
  user_id uuid not null references grupos.users(id) on delete cascade,
  context_period_start timestamptz,
  context_period_end timestamptz,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on grupos.chat_sessions;
create trigger set_updated_at before update on grupos.chat_sessions
  for each row execute function grupos.tg_set_updated_at();

-- ============================================================================
-- EXPOR SCHEMA PARA PostgREST
-- ============================================================================
grant usage on schema grupos to anon, authenticated, service_role;
grant all on all tables in schema grupos to anon, authenticated, service_role;
grant all on all sequences in schema grupos to anon, authenticated, service_role;
grant all on all functions in schema grupos to anon, authenticated, service_role;
alter default privileges in schema grupos
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema grupos
  grant all on sequences to anon, authenticated, service_role;

-- ============================================================================
-- RLS — habilitar em todas as tabelas
-- ============================================================================
alter table grupos.users               enable row level security;
alter table grupos.uazapi_config       enable row level security;
alter table grupos.groups              enable row level security;
alter table grupos.group_rules         enable row level security;
alter table grupos.group_participants  enable row level security;
alter table grupos.messages            enable row level security;
alter table grupos.knowledge_base      enable row level security;
alter table grupos.summaries           enable row level security;
alter table grupos.discussions         enable row level security;
alter table grupos.pending_items       enable row level security;
alter table grupos.chat_sessions       enable row level security;

-- ============================================================================
-- POLICIES — escopo por user_id (auth.uid())
-- ============================================================================

-- users: cada usuário só lê/atualiza o próprio registro
drop policy if exists "users_self_select" on grupos.users;
create policy "users_self_select" on grupos.users
  for select using (id = auth.uid());

drop policy if exists "users_self_insert" on grupos.users;
create policy "users_self_insert" on grupos.users
  for insert with check (id = auth.uid());

drop policy if exists "users_self_update" on grupos.users;
create policy "users_self_update" on grupos.users
  for update using (id = auth.uid());

-- uazapi_config
drop policy if exists "uazapi_config_owner_all" on grupos.uazapi_config;
create policy "uazapi_config_owner_all" on grupos.uazapi_config
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- groups
drop policy if exists "groups_owner_all" on grupos.groups;
create policy "groups_owner_all" on grupos.groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- group_rules (via group -> user_id)
drop policy if exists "group_rules_owner_all" on grupos.group_rules;
create policy "group_rules_owner_all" on grupos.group_rules
  for all using (
    exists (select 1 from grupos.groups g
            where g.id = group_rules.group_id and g.user_id = auth.uid())
  ) with check (
    exists (select 1 from grupos.groups g
            where g.id = group_rules.group_id and g.user_id = auth.uid())
  );

-- group_participants
drop policy if exists "group_participants_owner_all" on grupos.group_participants;
create policy "group_participants_owner_all" on grupos.group_participants
  for all using (
    exists (select 1 from grupos.groups g
            where g.id = group_participants.group_id and g.user_id = auth.uid())
  ) with check (
    exists (select 1 from grupos.groups g
            where g.id = group_participants.group_id and g.user_id = auth.uid())
  );

-- messages
drop policy if exists "messages_owner_all" on grupos.messages;
create policy "messages_owner_all" on grupos.messages
  for all using (
    exists (select 1 from grupos.groups g
            where g.id = messages.group_id and g.user_id = auth.uid())
  ) with check (
    exists (select 1 from grupos.groups g
            where g.id = messages.group_id and g.user_id = auth.uid())
  );

-- knowledge_base
drop policy if exists "knowledge_base_owner_all" on grupos.knowledge_base;
create policy "knowledge_base_owner_all" on grupos.knowledge_base
  for all using (
    exists (select 1 from grupos.groups g
            where g.id = knowledge_base.group_id and g.user_id = auth.uid())
  ) with check (
    exists (select 1 from grupos.groups g
            where g.id = knowledge_base.group_id and g.user_id = auth.uid())
  );

-- summaries
drop policy if exists "summaries_owner_all" on grupos.summaries;
create policy "summaries_owner_all" on grupos.summaries
  for all using (
    exists (select 1 from grupos.groups g
            where g.id = summaries.group_id and g.user_id = auth.uid())
  ) with check (
    exists (select 1 from grupos.groups g
            where g.id = summaries.group_id and g.user_id = auth.uid())
  );

-- discussions (via summary -> group -> user)
drop policy if exists "discussions_owner_all" on grupos.discussions;
create policy "discussions_owner_all" on grupos.discussions
  for all using (
    exists (
      select 1 from grupos.summaries s
      join grupos.groups g on g.id = s.group_id
      where s.id = discussions.summary_id and g.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from grupos.summaries s
      join grupos.groups g on g.id = s.group_id
      where s.id = discussions.summary_id and g.user_id = auth.uid()
    )
  );

-- pending_items
drop policy if exists "pending_items_owner_all" on grupos.pending_items;
create policy "pending_items_owner_all" on grupos.pending_items
  for all using (
    exists (
      select 1 from grupos.summaries s
      join grupos.groups g on g.id = s.group_id
      where s.id = pending_items.summary_id and g.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from grupos.summaries s
      join grupos.groups g on g.id = s.group_id
      where s.id = pending_items.summary_id and g.user_id = auth.uid()
    )
  );

-- chat_sessions
drop policy if exists "chat_sessions_owner_all" on grupos.chat_sessions;
create policy "chat_sessions_owner_all" on grupos.chat_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- TRIGGER: criar grupos.users automaticamente quando auth.users é criado
-- ============================================================================
create or replace function grupos.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into grupos.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'admin'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function grupos.handle_new_auth_user();
