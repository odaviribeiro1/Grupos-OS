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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 1. Get all active groups
  const { data: groups, error: groupsErr } = await supabase
    .from("groups")
    .select("id, name, whatsapp_group_id")
    .eq("is_active", true);

  if (groupsErr) {
    console.error("Failed to fetch groups:", groupsErr);
    return json({ error: "Failed to fetch groups" }, 500);
  }

  if (!groups || groups.length === 0) {
    return json({ status: "ok", message: "No active groups", results: [] });
  }

  const results: Array<{
    group_id: string;
    group_name: string;
    summary_generated: boolean;
    sent_to_group: boolean;
    error?: string;
  }> = [];

  for (const group of groups) {
    const result = {
      group_id: group.id,
      group_name: group.name,
      summary_generated: false,
      sent_to_group: false,
      error: undefined as string | undefined,
    };

    try {
      // 2. Check if group has messages today
      const now = new Date();
      const brasiliaOffset = -3 * 60;
      const localNow = new Date(
        now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000
      );
      const todayStart = new Date(localNow);
      todayStart.setHours(0, 0, 0, 0);
      const offset = (brasiliaOffset + now.getTimezoneOffset()) * 60000;
      const todayStartUtc = new Date(todayStart.getTime() - offset).toISOString();

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("group_id", group.id)
        .gte("message_timestamp", todayStartUtc)
        .or("from_me.eq.false,was_sent_by_api.eq.false");

      if (!count || count === 0) {
        result.error = "No messages today";
        results.push(result);
        continue;
      }

      // Idempotência: se já existe resumo de hoje para o grupo, pula (o cron pode
      // reexecutar/retry/timeout). Sem isso, gera e envia resumos duplicados.
      const { data: existing } = await supabase
        .from("summaries")
        .select("id")
        .eq("group_id", group.id)
        .eq("period_type", "today")
        .gte("period_start", todayStartUtc)
        .limit(1)
        .maybeSingle();
      if (existing) {
        result.error = "Summary already exists today (skipped)";
        results.push(result);
        continue;
      }

      // 3. Call generate-summary
      const genRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          group_id: group.id,
          period_type: "today",
        }),
      });

      const genData = await genRes.json();

      if (!genRes.ok) {
        result.error = `generate-summary: ${genData.error || genRes.status}`;
        results.push(result);
        continue;
      }

      result.summary_generated = true;
      const summaryId = genData.summary_id;

      // 4. Call send-summary-to-group
      const sendRes = await fetch(
        `${SUPABASE_URL}/functions/v1/send-summary-to-group`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            // Autentica como chamada interna confiável (ver send-summary-to-group).
            "x-internal-secret": Deno.env.get("CRYPTO_KEY") ?? "",
          },
          body: JSON.stringify({ summary_id: summaryId }),
        }
      );

      const sendData = await sendRes.json();

      if (!sendRes.ok) {
        result.error = `send-summary: ${sendData.error || sendRes.status}`;
        results.push(result);
        continue;
      }

      result.sent_to_group = true;

      // 5. Mark summary as auto-generated
      await supabase
        .from("summaries")
        .update({ is_auto_generated: true })
        .eq("id", summaryId);
    } catch (err) {
      result.error = (err as Error).message;
    }

    results.push(result);
  }

  return json({
    status: "ok",
    processed: results.length,
    results,
  });
});
