-- ============================================================================
-- Cron diário de resumos: habilita pg_cron + pg_net e expõe um wrapper
-- idempotente pra (re)agendar o job. O bootstrap chama
-- grupos.schedule_daily_summary(<edge_function_url>) após as migrations,
-- injetando a URL já com o project ref correto.
--
-- Job: roda 03:00 UTC = 00:00 America/Sao_Paulo (Brasília não tem DST).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function grupos.schedule_daily_summary(p_function_url text)
returns void
language plpgsql
security definer
set search_path = grupos, public, cron, net
as $$
begin
  -- Tira o job antigo (se existir) antes de reagendar — torna o setup
  -- idempotente: re-rodar o bootstrap atualiza a URL sem duplicar jobs.
  if exists (select 1 from cron.job where jobname = 'grupos-daily-summary') then
    perform cron.unschedule('grupos-daily-summary');
  end if;

  perform cron.schedule(
    'grupos-daily-summary',
    '0 3 * * *',
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
