create table if not exists public.app_settings (
  key text primary key,
  value_encrypted text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create table if not exists public._bootstrap_state (
  step text primary key,
  completed_at timestamptz not null default now(),
  metadata jsonb
);

alter table public._bootstrap_state enable row level security;
