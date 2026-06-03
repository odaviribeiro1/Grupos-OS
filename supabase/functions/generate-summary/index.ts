import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCredential } from "../_shared/credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

type PeriodType = "6h" | "12h" | "today" | "yesterday" | "custom";

function computePeriodRange(
  periodType: PeriodType,
  customStart?: string,
  customEnd?: string
): { start: string; end: string } {
  const now = new Date();
  // Use Brasilia offset (UTC-3)
  const brasiliaOffset = -3 * 60;
  const localNow = new Date(now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000);

  switch (periodType) {
    case "6h":
      return {
        start: new Date(now.getTime() - 6 * 3600_000).toISOString(),
        end: now.toISOString(),
      };
    case "12h":
      return {
        start: new Date(now.getTime() - 12 * 3600_000).toISOString(),
        end: now.toISOString(),
      };
    case "today": {
      const todayStart = new Date(localNow);
      todayStart.setHours(0, 0, 0, 0);
      const todayStartUtc = new Date(todayStart.getTime() - (brasiliaOffset + now.getTimezoneOffset()) * 60000);
      return {
        start: todayStartUtc.toISOString(),
        end: now.toISOString(),
      };
    }
    case "yesterday": {
      const ydayStart = new Date(localNow);
      ydayStart.setDate(ydayStart.getDate() - 1);
      ydayStart.setHours(0, 0, 0, 0);
      const ydayEnd = new Date(ydayStart);
      ydayEnd.setHours(23, 59, 59, 999);
      const offset = (brasiliaOffset + now.getTimezoneOffset()) * 60000;
      return {
        start: new Date(ydayStart.getTime() - offset).toISOString(),
        end: new Date(ydayEnd.getTime() - offset).toISOString(),
      };
    }
    case "custom":
      return { start: customStart!, end: customEnd! };
    default:
      return { start: new Date(now.getTime() - 24 * 3600_000).toISOString(), end: now.toISOString() };
  }
}

async function searchKnowledge(groupId: string, queryText: string, openaiKey: string): Promise<string> {
  try {
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: queryText.slice(0, 2000) }),
    });
    if (!embRes.ok) return "";
    const embData = await embRes.json();
    const embedding = embData.data[0].embedding;

    const { data } = await supabase.rpc("match_knowledge", {
      query_embedding: JSON.stringify(embedding),
      match_group_id: groupId,
      match_threshold: 0.5,
      match_count: 3,
    });
    if (!data || data.length === 0) return "";
    return data.map((d: { title: string; content: string }) => `[${d.title}]: ${d.content.slice(0, 500)}`).join("\n\n");
  } catch (err) {
    console.error("Knowledge search error:", err);
    return "";
  }
}

function buildPrompt(
  messages: Array<{ sender_name: string; text: string; message_timestamp: string; sender_jid: string; quoted_message_id: string | null; uazapi_message_id: string | null }>,
  rules: string[],
  admins: string[],
  period: string,
  knowledgeContext: string
): string {
  const rulesBlock = rules.length > 0 ? rules.join("\n") : "Nenhuma regra específica.";
  const adminBlock = admins.length > 0 ? admins.join(", ") : "Nenhum admin identificado.";
  const messagesBlock = messages
    .map((m) => {
      const ts = new Date(m.message_timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const quote = m.quoted_message_id ? ` [citando: ${m.quoted_message_id}]` : "";
      return `[${ts}] ${m.sender_name || m.sender_jid}: ${m.text || "[mídia]"}${quote} (id: ${m.uazapi_message_id || "?"})`;
    })
    .join("\n");

  return `Você é um analista de comunidades. Analise as mensagens do grupo de WhatsApp e gere um resumo estruturado.

REGRAS DE ANÁLISE DO GRUPO:
${rulesBlock}

KNOWLEDGE BASE (contexto adicional):
${knowledgeContext || "Nenhum documento."}

PARTICIPANTES ADMIN DO GRUPO (badge "Mentor"):
${adminBlock}

MENSAGENS DO PERÍODO (${period}):
${messagesBlock}

Gere um JSON com a seguinte estrutura:
{
  "resumo_geral": "texto do resumo do dia",
  "topicos": [
    {
      "titulo": "título do tópico",
      "descricao": "resumo da discussão",
      "status": "resolved" | "pending",
      "mensagens_relacionadas": ["id1", "id2"],
      "quantidade_mensagens": number
    }
  ],
  "participantes_ativos": [
    {
      "jid": "jid",
      "nome": "nome",
      "mensagens": number,
      "respostas": number,
      "badge": "mentor" | "super_engajado" | "engajado" | null
    }
  ],
  "pendencias": [
    {
      "descricao": "texto",
      "responsavel_jid": "jid ou null",
      "responsavel_nome": "nome ou null"
    }
  ],
  "sentimento": {
    "positivo": number (0-100),
    "neutro": number (0-100),
    "negativo": number (0-100)
  },
  "destaques": ["destaque 1", "destaque 2"],
  "recursos_compartilhados": [
    { "titulo": "nome", "url": "link" }
  ],
  "insight_do_dia": "texto",
  "estatisticas": {
    "total_mensagens": number,
    "participantes_ativos": number,
    "midias": { "imagens": number, "audios": number, "documentos": number }
  }
}

REGRAS DE BADGE:
- "mentor": participante que consta como Admin do grupo
- "engajado": 4 a 10 mensagens no período
- "super_engajado": 11+ mensagens no período

REGRAS DE RESOLUÇÃO:
- Uma dúvida é "resolved" se uma pergunta recebeu resposta(s) na thread (campo quoted)
- Caso contrário, é "pending"

Para cálculo de tempo médio de resposta:
- Identifique mensagens que são perguntas
- Encontre a primeira resposta (quoted ou resposta temporal)
- Calcule a diferença em minutos

IMPORTANTE: Retorne APENAS o JSON, sem markdown, sem \`\`\`json, sem texto antes ou depois. Os valores de "sentimento" devem somar exatamente 100.`;
}

async function logError(functionName: string, errorMessage: string, payload?: unknown) {
  try {
    await supabase.from("error_logs").insert({
      function_name: functionName,
      error_message: errorMessage,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
    });
  } catch { /* best effort */ }
}

async function callOpenAI(
  prompt: string,
  openaiKey: string
): Promise<Record<string, unknown>> {
  const body = JSON.stringify({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Você é um analista de comunidades que gera resumos estruturados em JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body,
    });
    if (res.ok || res.status < 500) break;
    const delay = Math.pow(2, attempt) * 1000;
    await logError("generate-summary", `OpenAI retry ${attempt + 1}: HTTP ${res.status}`, null);
    await new Promise((r) => setTimeout(r, delay));
  }

  if (!res || !res.ok) {
    const err = await res?.text().catch(() => "") ?? "";
    throw new Error(`OpenAI error ${res?.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  }

  let body: {
    group_id: string;
    period_type?: PeriodType;
    period_start?: string;
    period_end?: string;
    regenerate_summary_id?: string;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.group_id) {
    return json({ error: "group_id is required" }, 400);
  }

  const periodType: PeriodType = body.period_type || "today";

  // 1. Get group info
  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("id, name, uazapi_config_id, whatsapp_group_id")
    .eq("id", body.group_id)
    .single();

  if (groupErr || !group) {
    return json({ error: "Group not found" }, 404);
  }

  // 2. Get OpenAI key
  const openaiKey = await getCredential("openai_api_key");
  if (!openaiKey) {
    return json({ error: "Credencial OpenAI não configurada — acesse /settings/credentials" }, 400);
  }

  // 3. Compute period range
  const { start: periodStart, end: periodEnd } = computePeriodRange(
    periodType,
    body.period_start,
    body.period_end
  );

  // 4. Fetch messages (exclude from_me AND was_sent_by_api)
  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("id, uazapi_message_id, sender_jid, sender_name, message_type, text, quoted_message_id, from_me, was_sent_by_api, message_timestamp")
    .eq("group_id", group.id)
    .gte("message_timestamp", periodStart)
    .lte("message_timestamp", periodEnd)
    .order("message_timestamp", { ascending: true });

  if (msgErr) {
    console.error("Messages fetch error:", msgErr);
    return json({ error: "Failed to fetch messages" }, 500);
  }

  const filteredMessages = (messages ?? []).filter(
    (m) => !(m.from_me === true && m.was_sent_by_api === true)
  );

  if (filteredMessages.length === 0) {
    return json({ error: "No messages in this period", period_start: periodStart, period_end: periodEnd }, 400);
  }

  // 5. Fetch admins from group_participants
  const { data: participants } = await supabase
    .from("group_participants")
    .select("jid, display_name, is_admin")
    .eq("group_id", group.id);

  const adminJids = (participants ?? [])
    .filter((p) => p.is_admin)
    .map((p) => p.display_name || p.jid);

  // 6. Fetch group rules
  const { data: rulesData } = await supabase
    .from("group_rules")
    .select("rule_text")
    .eq("group_id", group.id);

  const rules = (rulesData ?? []).map((r) => r.rule_text);

  // 7. SQL metrics: activity per hour
  const activityByHour: Record<number, number> = {};
  for (let h = 0; h < 24; h++) activityByHour[h] = 0;
  for (const m of filteredMessages) {
    const hour = new Date(m.message_timestamp).getHours();
    activityByHour[hour] = (activityByHour[hour] || 0) + 1;
  }

  // Peak hour
  let peakHour = 0;
  let peakCount = 0;
  for (const [h, c] of Object.entries(activityByHour)) {
    if (c > peakCount) {
      peakCount = c;
      peakHour = Number(h);
    }
  }

  // 8. Participant count (distinct senders, excluding bot)
  const uniqueSenders = new Set(filteredMessages.map((m) => m.sender_jid));
  const participantCount = uniqueSenders.size;

  // 9. Avg response time via quoted_message_id
  let totalResponseMs = 0;
  let responseCount = 0;
  const msgTimestampMap = new Map<string, string>();
  for (const m of filteredMessages) {
    if (m.uazapi_message_id) {
      msgTimestampMap.set(m.uazapi_message_id, m.message_timestamp);
    }
  }
  for (const m of filteredMessages) {
    if (m.quoted_message_id && msgTimestampMap.has(m.quoted_message_id)) {
      const questionTs = new Date(msgTimestampMap.get(m.quoted_message_id)!).getTime();
      const answerTs = new Date(m.message_timestamp).getTime();
      if (answerTs > questionTs) {
        totalResponseMs += answerTs - questionTs;
        responseCount++;
      }
    }
  }
  const avgResponseMinutes = responseCount > 0 ? Math.round(totalResponseMs / responseCount / 60000) : 0;

  // 9.5 RAG: search knowledge base
  const messagesPreview = filteredMessages.slice(0, 10).map((m) => m.text || "").join(" ");
  const knowledgeContext = await searchKnowledge(group.id, messagesPreview, openaiKey);

  // 10. Build prompt and call LLM
  const periodLabel = `${periodType} (${new Date(periodStart).toLocaleString("pt-BR")} → ${new Date(periodEnd).toLocaleString("pt-BR")})`;
  const prompt = buildPrompt(filteredMessages, rules, adminJids, periodLabel, knowledgeContext);

  let llmResult: Record<string, unknown>;
  try {
    llmResult = await callOpenAI(prompt, openaiKey);
  } catch (err) {
    console.error("LLM error:", err);
    return json({ error: `LLM error: ${(err as Error).message}` }, 502);
  }

  // 11. If regenerating, delete old summary + related records
  if (body.regenerate_summary_id) {
    await supabase.from("pending_items").delete().eq("summary_id", body.regenerate_summary_id);
    await supabase.from("discussions").delete().eq("summary_id", body.regenerate_summary_id);
    await supabase.from("summaries").delete().eq("id", body.regenerate_summary_id);
  }

  // 12. Ensure sentiment sums to 100
  const sentiment = llmResult.sentimento as Record<string, number> | undefined;
  let sentimentObj = { positive: 33, neutral: 34, negative: 33 };
  if (sentiment) {
    const pos = sentiment.positivo ?? 33;
    const neu = sentiment.neutro ?? 34;
    const neg = sentiment.negativo ?? 33;
    const total = pos + neu + neg;
    if (total > 0 && total !== 100) {
      const factor = 100 / total;
      sentimentObj = {
        positive: Math.round(pos * factor),
        neutral: Math.round(neu * factor),
        negative: 100 - Math.round(pos * factor) - Math.round(neu * factor),
      };
    } else {
      sentimentObj = { positive: pos, neutral: neu, negative: neg };
    }
  }

  // 13. Insert summary
  const { data: summary, error: sumErr } = await supabase
    .from("summaries")
    .insert({
      group_id: group.id,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      summary_text: (llmResult.resumo_geral as string) || "",
      summary_json: llmResult,
      message_count: filteredMessages.length,
      participant_count: participantCount,
      peak_hour: `${peakHour}:00`,
      avg_response_time_minutes: avgResponseMinutes,
      sentiment: sentimentObj,
      is_auto_generated: false,
      sent_to_group: false,
    })
    .select("id")
    .single();

  if (sumErr) {
    console.error("Summary insert error:", sumErr);
    return json({ error: "Failed to save summary", detail: sumErr.message }, 500);
  }

  // 14. Insert discussions
  const topicos = (llmResult.topicos as Array<Record<string, unknown>>) || [];
  for (const t of topicos) {
    const { error: discErr } = await supabase.from("discussions").insert({
      summary_id: summary.id,
      title: (t.titulo as string) || "",
      description: (t.descricao as string) || "",
      status: (t.status as string) === "resolved" ? "resolved" : "pending",
      message_count: (t.quantidade_mensagens as number) || 0,
      related_message_ids: (t.mensagens_relacionadas as string[]) || [],
    });
    if (discErr) console.error("Discussion insert error:", discErr);
  }

  // 15. Insert pending items
  const pendencias = (llmResult.pendencias as Array<Record<string, unknown>>) || [];
  for (const p of pendencias) {
    const { error: pendErr } = await supabase.from("pending_items").insert({
      summary_id: summary.id,
      description: (p.descricao as string) || "",
      assigned_participant_jid: (p.responsavel_jid as string) || null,
      assigned_participant_name: (p.responsavel_nome as string) || null,
    });
    if (pendErr) console.error("Pending item insert error:", pendErr);
  }

  return json({
    status: "ok",
    summary_id: summary.id,
    message_count: filteredMessages.length,
    participant_count: participantCount,
    peak_hour: `${peakHour}:00`,
    avg_response_time_minutes: avgResponseMinutes,
    topics_count: topicos.length,
    pending_count: pendencias.length,
  });
});
