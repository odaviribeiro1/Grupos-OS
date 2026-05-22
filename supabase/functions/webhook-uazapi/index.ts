import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCredential } from "../_shared/credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function sanitize(input: string): string {
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;
const ipCounters = new Map<string, { count: number; start: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounters.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    ipCounters.set(ip, { count: 1, start: now });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || res.status < 500) return res;
    if (attempt < retries) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    } else {
      return res;
    }
  }
  throw new Error("Unreachable");
}

async function transcribeAudio(fileUrl: string, openaiKey: string): Promise<string> {
  const audioRes = await fetch(fileUrl);
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  const ext = fileUrl.split(".").pop()?.split("?")[0] || "ogg";
  const form = new FormData();
  form.append("file", audioBlob, `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "pt");

  const whisperRes = await fetchWithRetry(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    }
  );

  if (!whisperRes.ok) {
    const err = await whisperRes.text().catch(() => "");
    throw new Error(`Whisper error ${whisperRes.status}: ${err}`);
  }

  const result = await whisperRes.json();
  return result.text || "";
}

function extractQuotedMessageId(data: Record<string, unknown>): string | null {
  const quoted = data.quoted;
  if (!quoted) return null;
  if (typeof quoted === "string") return quoted;
  if (typeof quoted === "object") {
    const q = quoted as Record<string, unknown>;
    return (
      (q.messageid as string) ||
      (q.messageId as string) ||
      (q.id as string) ||
      (q.stanzaId as string) ||
      null
    );
  }
  return null;
}

function extractTimestamp(data: Record<string, unknown>): string {
  const ts = data.messageTimestamp ?? data.timestamp;
  if (typeof ts === "number") {
    return new Date(ts < 2e10 ? ts * 1000 : ts).toISOString();
  }
  if (typeof ts === "string") {
    const n = Number(ts);
    if (!isNaN(n) && n < 2e10) return new Date(n * 1000).toISOString();
    if (!isNaN(n)) return new Date(n).toISOString();
    return ts;
  }
  return new Date().toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Rate limiting
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return json({ error: "Rate limit exceeded" }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // UAZAPI v2 manda payload aninhado: { EventType, chat: {...}, message: {...} }
  // Versões antigas mandavam flat ou em `data`. Suportamos os 3 formatos.
  const msg = (payload.message as Record<string, unknown>) || null;
  const chat = (payload.chat as Record<string, unknown>) || null;
  const data: Record<string, unknown> = msg ??
    (payload.data as Record<string, unknown>) ??
    payload;

  const chatId =
    (data.chatId as string) ||
    (data.chat_id as string) ||
    (data.chatid as string) ||
    (data.remoteJid as string) ||
    (chat?.wa_chatid as string) ||
    (chat?.id as string) ||
    "";

  // Filtra: só processa mensagens de grupo
  const isGroup =
    data.isGroup === true ||
    data.fromGroup === true ||
    chat?.wa_isGroup === true ||
    chatId.endsWith("@g.us");
  if (!isGroup) {
    return json({ status: "ignored", reason: "not a group message" });
  }

  // Normaliza messageType. UAZAPI v2 manda "Conversation"/"ExtendedTextMessage"/
  // "ImageMessage"/"AudioMessage" etc. Antigas mandavam "text"/"audio"/etc.
  const rawType = ((data.messageType as string) || (data.type as string) || "text").trim();
  const messageType = (() => {
    const lower = rawType.toLowerCase();
    if (lower === "conversation" || lower === "extendedtextmessage" || lower === "text") return "text";
    if (lower === "imagemessage" || lower === "image") return "image";
    if (lower === "audiomessage" || lower === "audio") return "audio";
    if (lower === "videomessage" || lower === "video") return "video";
    if (lower === "documentmessage" || lower === "document") return "document";
    if (lower === "stickermessage" || lower === "sticker") return "sticker";
    if (lower === "reactionmessage" || lower === "reaction") return "reaction";
    if (lower === "pollcreationmessage" || lower === "pollupdatemessage" || lower === "vote") return "vote";
    if (lower === "convertoptions") return "convertOptions";
    return rawType;
  })();

  // Filtra: ignora reaction, vote e convertOptions
  if (
    messageType === "reaction" ||
    messageType === "vote" ||
    messageType === "convertOptions"
  ) {
    return json({ status: "ignored", reason: `messageType: ${messageType}` });
  }

  if (!chatId) {
    return json({ error: "Missing chatId" }, 400);
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, uazapi_config_id, is_active")
    .eq("whatsapp_group_id", chatId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (groupError) {
    await logError("webhook-uazapi", `Group lookup: ${groupError.message}`, { chatId });
    return json({ error: "Database error" }, 500);
  }

  if (!group) {
    return json({ status: "ignored", reason: "group not monitored or inactive" });
  }

  // Áudio: baixa de fileURL e transcreve via Whisper
  const fileUrl =
    (data.fileURL as string) || (data.fileUrl as string) || null;
  let text = (data.text as string) || "";
  let isTranscribed = false;
  let originalAudioUrl: string | null = null;

  if (messageType === "audio" && fileUrl) {
    originalAudioUrl = fileUrl;
    const openaiKey = await getCredential("openai_api_key");

    if (openaiKey) {
      try {
        text = await transcribeAudio(fileUrl, openaiKey);
        isTranscribed = true;
      } catch (err) {
        await logError("webhook-uazapi", `Transcription: ${(err as Error).message}`, { fileUrl });
        text = "[Áudio - transcrição falhou]";
      }
    } else {
      text = "[Áudio - sem chave OpenAI configurada]";
    }
  }

  const sanitizedText = text ? sanitize(text) : null;
  const senderName = sanitize((data.senderName as string) || "");

  const messageId =
    (data.messageid as string) ||
    (data.messageId as string) ||
    (data.id as string) ||
    "";
  const senderJid =
    (data.sender as string) ||
    (data.senderJid as string) ||
    (data.participant as string) ||
    "";
  const fromMe = data.fromMe === true;
  const wasSentByApi =
    data.was_sent_by_api === true || data.wasSentByApi === true;

  const record = {
    group_id: group.id,
    uazapi_message_id: messageId || null,
    chat_id: chatId,
    sender_jid: senderJid,
    sender_name: senderName,
    message_type: messageType,
    text: sanitizedText,
    original_audio_url: originalAudioUrl,
    is_transcribed: isTranscribed,
    quoted_message_id: extractQuotedMessageId(data),
    from_me: fromMe,
    was_sent_by_api: wasSentByApi,
    message_timestamp: extractTimestamp(data),
    ai_metadata: data.ai_metadata ?? null,
    raw_payload: payload,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert(record)
    .select("id")
    .single();

  if (insertError) {
    await logError("webhook-uazapi", `Insert: ${insertError.message}`, { chatId, messageId });
    return json({ error: "Failed to insert message", detail: insertError.message }, 500);
  }

  return json({ status: "ok", message_id: inserted.id });
});
