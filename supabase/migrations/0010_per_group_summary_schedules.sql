-- ============================================================================
-- Resumo automático configurável POR GRUPO.
-- Uma linha por grupo (unique em group_id) — substitui o "cron único pra todos"
-- por uma decisão a cada hora: o cron-daily-summary lê esta tabela e processa
-- apenas grupos cujo schedule case com a hora/dia/dow atuais.
-- ============================================================================

create table if not exists grupos.group_summary_schedules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null unique references grupos.groups(id) on delete cascade,
  enabled boolean not null default true,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  hour int not null check (hour >= 0 and hour <= 23),
  -- 0 = domingo, 6 = sábado (compatível com EXTRACT(DOW FROM ...) e JS getDay())
  day_of_week int check (day_of_week is null or (day_of_week >= 0 and day_of_week <= 6)),
  -- 1-31; o cron pula meses que não têm aquele dia (ex: 31 em fevereiro)
  day_of_month int check (day_of_month is null or (day_of_month >= 1 and day_of_month <= 31)),
  send_to_group boolean not null default false,
  -- Marca a última execução pra evitar gerar 2x na mesma hora
  -- (cron pode reexecutar via pg_net retry/timeout)
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_frequency_fields check (
    (frequency = 'daily')
    or (frequency = 'weekly' and day_of_week is not null)
    or (frequency = 'monthly' and day_of_month is not null)
  )
);

drop trigger if exists set_updated_at on grupos.group_summary_schedules;
create trigger set_updated_at before update on grupos.group_summary_schedules
  for each row execute function grupos.tg_set_updated_at();

alter table grupos.group_summary_schedules enable row level security;

drop policy if exists "schedules_owner_all" on grupos.group_summary_schedules;
create policy "schedules_owner_all" on grupos.group_summary_schedules
  for all
  using (
    exists (
      select 1 from grupos.groups g
      where g.id = group_summary_schedules.group_id
        and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from grupos.groups g
      where g.id = group_summary_schedules.group_id
        and g.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Atualiza schedule_daily_summary pra rodar A CADA HORA (0 * * * *) ao invés
-- de só às 3am. Cada grupo decide seu próprio horário em
-- group_summary_schedules; o cron-daily-summary verifica match a cada execução.
-- ============================================================================
create or replace function grupos.schedule_daily_summary(p_function_url text)
returns void
language plpgsql
security definer
set search_path = grupos, public, cron, net
as $$
begin
  if exists (select 1 from cron.job where jobname = 'grupos-daily-summary') then
    perform cron.unschedule('grupos-daily-summary');
  end if;

  perform cron.schedule(
    'grupos-daily-summary',
    '0 * * * *',  -- a cada hora no minuto 0
    format(
      $cmd$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type', 'application/json')
        );
      $cmd$,
      p_function_url
    )
  );
end $$;
