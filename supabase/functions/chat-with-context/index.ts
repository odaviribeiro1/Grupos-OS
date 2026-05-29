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

function computePeriodRange(
  periodType: string,
  customStart?: string,
  customEnd?: string
): { start: string; end: string } {
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const localNow = new Date(
    now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000
  );

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
      const s = new Date(localNow);
      s.setHours(0, 0, 0, 0);
      const offset = (brasiliaOffset + now.getTimezoneOffset()) * 60000;
      return {
        start: new Date(s.getTime() - offset).toISOString(),
        end: now.toISOString(),
      };
    }
    case "yesterday": {
      const s = new Date(localNow);
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setHours(23, 59, 59, 999);
      const offset = (brasiliaOffset + now.getTimezoneOffset()) * 60000;
      return {
        start: new Date(s.getTime() - offset).toISOString(),
        end: new Date(e.getTime() - offset).toISOString(),
      };
    }
    case "custom":
      return { start: customStart!, end: customEnd! };
    default:
      return {
        start: new Date(now.getTime() - 24 * 3600_000).toISOString(),
        end: now.toISOString(),
      };
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
  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: {
    group_id: string;
    user_id: string;
    message: string;
    session_id?: string;
    period_type?: string;
    period_start?: string;
    period_end?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.group_id || !body.user_id || !body.message) {
    return json({ error: "group_id, user_id, and message are required" }, 400);
  }

  if (body.user_id !== user.id) {
    return json({ error: "user_id não corresponde ao token de autenticação" }, 403);
  }

  // 1. Get group
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, uazapi_config_id")
    .eq("id", body.group_id)
    .single();
  if (!group) return json({ error: "Group not found" }, 404);

  // 2. Get OpenAI key
  const openaiKey = await getCredential("openai_api_key");
  if (!openaiKey) {
    return json({ error: "Credencial OpenAI não configurada — acesse /settings/credentials" }, 400);
  }

  // 3. Period range
  const periodType = body.period_type || "today";
  const { start: periodStart, end: periodEnd } = computePeriodRange(
    periodType,
    body.period_start,
    body.period_end
  );

  // 4. Fetch messages for context
  const { data: messages } = await supabase
    .from("messages")
    .select("sender_name, sender_jid, text, message_timestamp")
    .eq("group_id", group.id)
    .gte("message_timestamp", periodStart)
    .lte("message_timestamp", periodEnd)
    .order("message_timestamp", { ascending: true })
    .limit(500);

  const filteredMsgs = (messages ?? []).filter(
    (m: Record<string, unknown>) =>
      !(m.from_me === true && m.was_sent_by_api === true)
  );

  const messagesContext = filteredMsgs
    .map((m: Record<string, unknown>) => {
      const ts = new Date(m.message_timestamp as string).toLocaleTimeString(
        "pt-BR",
        { hour: "2-digit", minute: "2-digit" }
      );
      return `[${ts}] ${m.sender_name || m.sender_jid}: ${m.text || "[mídia]"}`;
    })
    .join("\n");

  // 5. Fetch group rules
  const { data: rulesData } = await supabase
    .from("group_rules")
    .select("rule_text")
    .eq("group_id", group.id);
  const rules = (rulesData ?? []).map((r: Record<string, unknown>) => r.rule_text).join("\n");

  // 6. RAG: search knowledge base by similarity to user's question
  let knowledgeContext = "";
  try {
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: body.message.slice(0, 2000) }),
    });
    if (embRes.ok) {
      const embData = await embRes.json();
      const embedding = embData.data[0].embedding;
      const { data: kbDocs } = await supabase.rpc("match_knowledge", {
        query_embedding: JSON.stringify(embedding),
        match_group_id: group.id,
        match_threshold: 0.5,
        match_count: 3,
      });
      if (kbDocs && kbDocs.length > 0) {
        knowledgeContext = kbDocs
          .map((d: { title: string; content: string }) => `[${d.title}]: ${d.content.slice(0, 500)}`)
          .join("\n\n");
      }
    }
  } catch (err) {
    console.error("Knowledge RAG error:", err);
  }

  // 7. Load or create session
  type ChatMsg = { role: string; content: string };
  let sessionId = body.session_id;
  let history: ChatMsg[] = [];

  if (sessionId) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id, messages")
      .eq("id", sessionId)
      .single();
    if (session) {
      history = (session.messages as ChatMsg[]) || [];
    }
  }

  // 8. Build system prompt
  const systemPrompt = `Você é um assistente inteligente especializado em analisar conversas de grupos de WhatsApp. Responda perguntas do usuário com base no contexto fornecido.

GRUPO: ${group.name}

REGRAS DE ANÁLISE:
${rules || "Nenhuma regra específica."}

KNOWLEDGE BASE:
${knowledgeContext || "Nenhum documento."}

MENSAGENS DO PERÍODO (${periodType}):
${messagesContext || "Nenhuma mensagem neste período."}

Responda de forma clara, concisa e em português. Use os dados acima para fundamentar suas respostas.`;

  // 9. Append user message to history
  history.push({ role: "user", content: body.message });

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  // 10. Call OpenAI with streaming
  const openaiRes = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: openaiMessages,
        temperature: 0.4,
        max_tokens: 2048,
        stream: true,
      }),
    }
  );

  if (!openaiRes.ok) {
    const err = await openaiRes.text().catch(() => "");
    return json({ error: `OpenAI error ${openaiRes.status}: ${err}` }, 502);
  }

  // 11. Stream SSE response while collecting full text
  const reader = openaiRes.body!.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                );
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (err) {
        console.error("Stream error:", err);
      }

      // 12. Save session after streaming completes
      history.push({ role: "assistant", content: fullResponse });

      if (sessionId) {
        await supabase
          .from("chat_sessions")
          .update({
            messages: history,
            context_period_start: periodStart,
            context_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
      } else {
        const { data: newSession } = await supabase
          .from("chat_sessions")
          .insert({
            group_id: group.id,
            user_id: body.user_id,
            context_period_start: periodStart,
            context_period_end: periodEnd,
            messages: history,
          })
          .select("id")
          .single();
        if (newSession) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ session_id: newSession.id })}\n\n`
            )
          );
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
