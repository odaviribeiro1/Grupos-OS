import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCredential } from "../_shared/credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  const text: string[] = [];
  const str = new TextDecoder("latin1").decode(bytes);

  const streamMatches = str.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
  for (const m of streamMatches) {
    const raw = m[1];
    const btMatches = raw.matchAll(/\(([^)]*)\)/g);
    for (const bt of btMatches) {
      const decoded = bt[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\\\/g, "\\")
        .replace(/\\([()])/g, "$1");
      if (decoded.trim()) text.push(decoded);
    }
    const hexMatches = raw.matchAll(/<([0-9A-Fa-f]+)>/g);
    for (const hm of hexMatches) {
      const hex = hm[1];
      let decoded = "";
      for (let i = 0; i < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      if (decoded.trim() && /[a-zA-ZÀ-ÿ]/.test(decoded)) text.push(decoded);
    }
  }

  const result = text.join(" ").replace(/\s+/g, " ").trim();
  if (result.length > 50) return result;

  const fallback: string[] = [];
  const tjMatches = str.matchAll(/Tj\s*\(([^)]+)\)/g);
  for (const m of tjMatches) fallback.push(m[1]);
  const tjResult = fallback.join(" ").replace(/\s+/g, " ").trim();

  return tjResult || result || "[PDF sem texto extraível]";
}

async function generateEmbedding(
  text: string,
  openaiKey: string
): Promise<number[]> {
  const truncated = text.slice(0, 8000);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: truncated,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Embedding error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const file = formData.get("file") as File | null;
  const groupId = formData.get("group_id") as string | null;
  const title = formData.get("title") as string | null;

  if (!file || !groupId) {
    return json({ error: "file and group_id are required" }, 400);
  }

  // 1. Verify group exists
  const { data: group } = await supabase
    .from("groups")
    .select("id, uazapi_config_id")
    .eq("id", groupId)
    .single();
  if (!group) return json({ error: "Group not found" }, 404);

  // 2. Get OpenAI key
  const openaiKey = await getCredential("openai_api_key");
  if (!openaiKey) {
    return json({ error: "Credencial OpenAI não configurada — acesse /settings/credentials" }, 400);
  }

  // 3. Upload to Storage
  const fileName = `${groupId}/${Date.now()}-${file.name}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadErr } = await storageClient.storage
    .from("knowledge")
    .upload(fileName, bytes, { contentType: file.type });

  if (uploadErr) {
    console.error("Storage upload error:", uploadErr);
    return json({ error: "Failed to upload file" }, 500);
  }

  const { data: urlData } = storageClient.storage
    .from("knowledge")
    .getPublicUrl(fileName);
  const fileUrl = urlData?.publicUrl || fileName;

  // 4. Extract text
  let content: string;
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "pdf") {
    content = await extractTextFromPdf(bytes);
  } else {
    content = new TextDecoder().decode(bytes);
  }

  if (!content || content.length < 10) {
    content = `[Arquivo: ${file.name}]`;
  }

  // 5. Generate embedding
  let embedding: number[];
  try {
    embedding = await generateEmbedding(content, openaiKey);
  } catch (err) {
    console.error("Embedding error:", err);
    return json({
      error: `Failed to generate embedding: ${(err as Error).message}`,
    }, 500);
  }

  // 6. Insert into knowledge_base
  const { data: doc, error: insertErr } = await supabase
    .from("knowledge_base")
    .insert({
      group_id: groupId,
      title: title || file.name,
      content,
      embedding: JSON.stringify(embedding),
      file_url: fileUrl,
    })
    .select("id, title, created_at")
    .single();

  if (insertErr) {
    console.error("Insert error:", insertErr);
    return json({ error: "Failed to save document", detail: insertErr.message }, 500);
  }

  return json({
    status: "ok",
    document: doc,
    content_length: content.length,
    embedding_dimensions: embedding.length,
  });
});
