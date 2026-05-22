import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCredential } from "../_shared/credentials.ts";

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

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function formatSummaryForWhatsApp(
  groupName: string,
  summaryJson: Record<string, unknown>,
  messageCount: number,
  participantCount: number,
  sentiment: { positive: number; neutral: number; negative: number },
  periodStart: string
): string {
  const date = new Date(periodStart);
  const dayOfWeek = WEEKDAYS[date.getDay()];
  const dateStr = date.toLocaleDateString("pt-BR");

  const resumoGeral = (summaryJson.resumo_geral as string) || "";
  const topicos = (summaryJson.topicos as Array<Record<string, unknown>>) || [];
  const participantes = (summaryJson.participantes_ativos as Array<Record<string, unknown>>) || [];
  const pendencias = (summaryJson.pendencias as Array<Record<string, unknown>>) || [];
  const destaques = (summaryJson.destaques as string[]) || [];
  const recursos = (summaryJson.recursos_compartilhados as Array<Record<string, unknown>>) || [];
  const insight = (summaryJson.insight_do_dia as string) || "";
  const stats = (summaryJson.estatisticas as Record<string, unknown>) || {};
  const midias = (stats.midias as Record<string, number>) || {};

  const lines: string[] = [];

  // Header
  lines.push(`📋 *RESUMO DO GRUPO - ${groupName}*`);
  lines.push(`🗓️ ${dayOfWeek}, ${dateStr}`);
  lines.push(`🔢 ${messageCount} mensagens analisadas`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Summary
  lines.push("*📌 RESUMO DO DIA*");
  lines.push(`> ${resumoGeral}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Topics
  if (topicos.length > 0) {
    lines.push("*💬 PRINCIPAIS TÓPICOS*");
    lines.push("");
    for (const t of topicos) {
      lines.push(`*${t.titulo}*`);
      lines.push(`→ ${t.descricao}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // Active participants
  if (participantes.length > 0) {
    lines.push("*🗣️ PARTICIPANTES ATIVOS*");
    for (const p of participantes) {
      const badge = p.badge ? ` (${String(p.badge)})` : "";
      lines.push(`• *${p.nome}*${badge} - ${p.mensagens} mensagens`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Decisions (resolved topics)
  const resolved = topicos.filter((t) => t.status === "resolved");
  if (resolved.length > 0) {
    lines.push("*✅ DECISÕES E ENCAMINHAMENTOS*");
    for (const t of resolved) {
      lines.push(`• ${t.titulo}: ${t.descricao}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Pending items
  if (pendencias.length > 0) {
    lines.push("*❓ PENDÊNCIAS*");
    for (const p of pendencias) {
      const resp = p.responsavel_nome ? ` (${p.responsavel_nome})` : "";
      lines.push(`• ${p.descricao}${resp}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Shared resources
  if (recursos.length > 0) {
    lines.push("*🔗 RECURSOS COMPARTILHADOS*");
    for (const r of recursos) {
      lines.push(`• *${r.titulo}*: ${r.url}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Stats
  lines.push("*📊 ESTATÍSTICAS*");
  lines.push(`• Mensagens: ${messageCount} | Participantes Ativos: ~${participantCount}`);
  if (midias.imagens || midias.audios) {
    lines.push(`• Mídias: ${midias.imagens || 0} imagens, ${midias.audios || 0} áudios`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Insight
  if (insight) {
    lines.push("*💡 INSIGHT DO DIA*");
    lines.push(`> ${insight}`);
  }

  return lines.join("\n");
}

async function sendWhatsAppMessage(
  apiUrl: string,
  instanceToken: string,
  groupChatId: string,
  text: string
): Promise<void> {
  // UAZAPI v2: POST /send/text com header `token` = instance token
  const url = `${apiUrl.replace(/\/+$/, "")}/send/text`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: instanceToken,
    },
    body: JSON.stringify({
      number: groupChatId,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`UAZAPI /send/text error ${res.status}: ${err}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { summary_id: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.summary_id) {
    return json({ error: "summary_id is required" }, 400);
  }

  // 1. Get summary
  const { data: summary, error: sumErr } = await supabase
    .from("summaries")
    .select("*")
    .eq("id", body.summary_id)
    .single();

  if (sumErr || !summary) {
    return json({ error: "Summary not found" }, 404);
  }

  // 2. Get group
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, whatsapp_group_id, uazapi_config_id")
    .eq("id", summary.group_id)
    .single();

  if (!group) {
    return json({ error: "Group not found" }, 404);
  }

  // 3. Get UAZAPI config
  const apiUrl = await getCredential("uazapi_api_url");
  const instanceToken = await getCredential("uazapi_instance_token");
  if (!apiUrl || !instanceToken) {
    return json({ error: "Credenciais UAZAPI incompletas — acesse /settings/credentials" }, 400);
  }

  // 4. Format message
  const text = formatSummaryForWhatsApp(
    group.name,
    summary.summary_json as Record<string, unknown>,
    summary.message_count,
    summary.participant_count,
    summary.sentiment as { positive: number; neutral: number; negative: number },
    summary.period_start
  );

  // 5. Send via Evolution API
  try {
    await sendWhatsAppMessage(
      apiUrl,
      instanceToken,
      group.whatsapp_group_id,
      text
    );
  } catch (err) {
    console.error("Send error:", err);
    return json({
      error: `Failed to send: ${(err as Error).message}`,
      sent_to_group: false,
    }, 502);
  }

  // 6. Mark as sent
  await supabase
    .from("summaries")
    .update({ sent_to_group: true })
    .eq("id", body.summary_id);

  return json({ status: "ok", sent_to_group: true });
});
