-- ============================================================================
-- error_logs — tabela de logs de erros das Edge Functions
-- Usada por logError() em webhook-uazapi e generate-summary
-- ============================================================================

create table if not exists grupos.error_logs (
  id uuid primary key default gen_random_uuid(),
  function_name text not null,
  error_message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists error_logs_created_at_idx
  on grupos.error_logs (created_at desc);

create index if not exists error_logs_function_name_idx
  on grupos.error_logs (function_name, created_at desc);

alter table grupos.error_logs enable row level security;

-- Apenas service_role pode inserir/ler (Edge Functions); usuários não têm acesso
drop policy if exists "error_logs_service_role_only" on grupos.error_logs;
create policy "error_logs_service_role_only" on grupos.error_logs
  for all using (false) with check (false);
