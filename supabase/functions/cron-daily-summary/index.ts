import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Schedule = {
  id: string;
  group_id: string;
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  hour: number;
  day_of_week: number | null;
  day_of_month: number | null;
  send_to_group: boolean;
  last_run_at: string | null;
};

// Hora ATUAL em Brasília (UTC-3, sem horário de verão desde 2019). Retorna os
// componentes que precisamos pra decidir match: hora cheia (0-23), dia da
// semana (0=domingo) e dia do mês (1-31).
function brasiliaNow(): { hour: number; dayOfWeek: number; dayOfMonth: number } {
  const nowUtc = new Date();
  const brasilia = new Date(nowUtc.getTime() - 3 * 60 * 60 * 1000);
  return {
    hour: brasilia.getUTCHours(),
    dayOfWeek: brasilia.getUTCDay(),
    dayOfMonth: brasilia.getUTCDate(),
  };
}

function scheduleMatches(s: Schedule, now: { hour: number; dayOfWeek: number; dayOfMonth: number }): boolean {
  if (s.hour !== now.hour) return false;
  if (s.frequency === "daily") return true;
  if (s.frequency === "weekly") return s.day_of_week === now.dayOfWeek;
  if (s.frequency === "monthly") return s.day_of_month === now.dayOfMonth;
  return false;
}

// Janela do resumo pra cada frequência. Daily reusa "today" (lógica já testada
// no generate-summary). Weekly/monthly usam custom: 7 ou 30 dias até agora.
function periodWindow(frequency: Schedule["frequency"]):
  | { period_type: "today" }
  | { period_type: "custom"; period_start: string; period_end: string } {
  if (frequency === "daily") return { period_type: "today" };
  const end = new Date();
  const start = new Date(end);
  if (frequency === "weekly") start.setDate(start.getDate() - 7);
  else start.setDate(start.getDate() - 30);
  return {
    period_type: "custom",
    period_start: start.toISOString(),
    period_end: end.toISOString(),
  };
}

// Idempotência: se last_run_at é da mesma hora cheia que agora, pula.
// pg_net pode retry/duplicar — sem isso geramos resumos duplicados.
function alreadyRanThisHour(lastRunAt: string | null): boolean {
  if (!lastRunAt) return false;
  const last = new Date(lastRunAt);
  const now = new Date();
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate() &&
    last.getUTCHours() === now.getUTCHours()
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const now = brasiliaNow();

  // Pega schedules habilitados que casam com a hora atual no SQL — reduz o
  // trabalho do lado do JS e evita iterar grupos que não vão rodar agora.
  const { data: schedules, error: schedErr } = await supabase
    .from("group_summary_schedules")
    .select("id, group_id, enabled, frequency, hour, day_of_week, day_of_month, send_to_group, last_run_at")
    .eq("enabled", true)
    .eq("hour", now.hour);

  if (schedErr) {
    console.error("Failed to fetch schedules:", schedErr);
    return json({ error: "Failed to fetch schedules" }, 500);
  }

  if (!schedules || schedules.length === 0) {
    return json({ status: "ok", message: "No schedules match this hour", hour: now.hour });
  }

  const results: Array<{
    schedule_id: string;
    group_id: string;
    matched: boolean;
    summary_generated: boolean;
    sent_to_group: boolean;
    skipped_reason?: string;
    error?: string;
  }> = [];

  for (const raw of schedules) {
    const s = raw as unknown as Schedule;
    const matched = scheduleMatches(s, now);
    const r = {
      schedule_id: s.id,
      group_id: s.group_id,
      matched,
      summary_generated: false,
      sent_to_group: false,
      skipped_reason: undefined as string | undefined,
      error: undefined as string | undefined,
    };

    if (!matched) {
      r.skipped_reason = "frequency/day mismatch";
      results.push(r);
      continue;
    }

    if (alreadyRanThisHour(s.last_run_at)) {
      r.skipped_reason = "already ran this hour";
      results.push(r);
      continue;
    }

    // Confirma que o grupo ainda está ativo
    const { data: group } = await supabase
      .from("groups")
      .select("id, is_active")
      .eq("id", s.group_id)
      .maybeSingle();

    if (!group || !group.is_active) {
      r.skipped_reason = "group inactive";
      results.push(r);
      continue;
    }

    try {
      const window = periodWindow(s.frequency);
      const genRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ group_id: s.group_id, ...window }),
      });
      const genData = await genRes.json();

      if (!genRes.ok) {
        r.error = `generate-summary: ${genData.error || genRes.status}`;
        results.push(r);
        continue;
      }

      r.summary_generated = true;
      const summaryId = genData.summary_id;

      if (summaryId) {
        await supabase
          .from("summaries")
          .update({ is_auto_generated: true })
          .eq("id", summaryId);
      }

      if (s.send_to_group && summaryId) {
        const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-summary-to-group`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            // Autentica como chamada interna (ver send-summary-to-group)
            "x-internal-secret": Deno.env.get("CRYPTO_KEY") ?? "",
          },
          body: JSON.stringify({ summary_id: summaryId }),
        });
        const sendData = await sendRes.json();
        if (sendRes.ok) {
          r.sent_to_group = true;
        } else {
          r.error = `send-summary: ${sendData.error || sendRes.status}`;
        }
      }

      await supabase
        .from("group_summary_schedules")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", s.id);
    } catch (err) {
      r.error = (err as Error).message;
    }

    results.push(r);
  }

  return json({ status: "ok", hour: now.hour, processed: results.length, results });
});
