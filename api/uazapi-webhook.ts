import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createDecipheriv } from "node:crypto";

// Autossuficiente de propósito (sem import local) — ver nota em api/credentials.ts.
// Lê e escreve a config de webhook da instância UAZAPI usando o token salvo em
// app_settings. O frontend manda só a URL desejada; este handler resolve credenciais
// e tenta múltiplos endpoints (UAZAPI v2 tem variações: /webhook vs /instance/updateWebhook).

const ALGORITHM = "aes-256-gcm";

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function pgRest(
  path: string,
  init: RequestInit = {},
  schema = "public"
): Promise<Response> {
  const base = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (schema !== "public") {
    headers["Accept-Profile"] = schema;
    headers["Content-Profile"] = schema;
  }
  return fetch(`${base}/rest/v1${path}`, { ...init, headers });
}

async function verifyAccessToken(jwt: string): Promise<{ id: string } | null> {
  const base = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ? { id: user.id } : null;
}

function getCryptoKey(): Buffer {
  const hex = process.env.CRYPTO_KEY;
  if (!hex || hex.length !== 64 || !/^[a-f0-9]+$/i.test(hex)) {
    throw new Error("CRYPTO_KEY ausente ou inválida");
  }
  return Buffer.from(hex, "hex");
}

function decrypt(payload: string): string {
  const [ivHex, tagHex, cipherHex] = payload.split(":");
  if (!ivHex || !tagHex || !cipherHex) throw new Error("Payload de criptografia malformado");
  const decipher = createDecipheriv(ALGORITHM, getCryptoKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

async function getCredential(key: string): Promise<string | null> {
  const res = await pgRest(
    `/app_settings?key=eq.${encodeURIComponent(key)}&select=value_encrypted&limit=1`
  );
  if (!res.ok) throw new Error(`getCredential(${key}) falhou (${res.status})`);
  const rows = (await res.json()) as Array<{ value_encrypted: string }>;
  return rows[0] ? decrypt(rows[0].value_encrypted) : null;
}

async function requireOwner(req: VercelRequest): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 500; message: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return { ok: false, status: 401, message: "Token ausente" };
  const jwt = authHeader.slice("Bearer ".length);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, message: "Supabase não configurado" };
  }
  const user = await verifyAccessToken(jwt);
  if (!user) return { ok: false, status: 401, message: "Sessão inválida" };
  const res = await pgRest(`/users?id=eq.${user.id}&select=role&limit=1`, {}, "grupos");
  if (!res.ok) return { ok: false, status: 500, message: `Falha ao verificar permissões (${res.status})` };
  const rows = (await res.json()) as Array<{ role: string }>;
  const role = rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return { ok: false, status: 403, message: "Apenas administradores podem alterar webhook UAZAPI" };
  }
  return { ok: true };
}

// POST /webhook — o endpoint canônico da UAZAPI v2 (Go/Baileys). Outros endpoints
// como /instance/updateWebhook não existem nessa versão (retornam 405).
// excludeMessages é []string (não objeto) — mas omitimos por completo, já que
// fazemos a filtragem (fromMe + was_sent_by_api) na própria Edge Function.
async function setWebhook(apiUrl: string, token: string, webhookUrl: string): Promise<{ ok: boolean; tried: Array<{ endpoint: string; status: number; body: string }> }> {
  const base = normalizeUrl(apiUrl);
  // Variações de event name pra cobrir nomenclaturas conhecidas da UAZAPI.
  // Se UAZAPI rejeitar algum, tentamos a próxima combinação.
  const eventSets: string[][] = [
    ["messages"],
    ["messages_upsert"],
    ["messages", "messages_upsert"],
    [], // fallback: vazio = todos os eventos (algumas versões aceitam)
  ];

  const endpoint = `${base}/webhook`;
  const tried: Array<{ endpoint: string; status: number; body: string }> = [];
  for (const events of eventSets) {
    const body = { enabled: true, url: webhookUrl, events };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      tried.push({
        endpoint: `${endpoint} events=[${events.join(",")}]`,
        status: res.status,
        body: text.slice(0, 500),
      });
      if (res.ok) return { ok: true, tried };
    } catch (err) {
      tried.push({
        endpoint: `${endpoint} events=[${events.join(",")}]`,
        status: 0,
        body: err instanceof Error ? err.message : "network",
      });
    }
  }
  return { ok: false, tried };
}

async function getWebhook(apiUrl: string, token: string): Promise<{ status: number; body: string }> {
  const base = normalizeUrl(apiUrl);
  const res = await fetch(`${base}/webhook`, {
    method: "GET",
    headers: { "Content-Type": "application/json", token },
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { success: false, message: auth.message });

  let apiUrl: string | null;
  let token: string | null;
  try {
    apiUrl = await getCredential("uazapi_api_url");
    token = await getCredential("uazapi_instance_token");
  } catch (err) {
    return json(res, 500, { success: false, message: err instanceof Error ? err.message : "Falha ao ler credenciais" });
  }
  if (!apiUrl || !token) {
    return json(res, 400, { success: false, message: "Credenciais UAZAPI ausentes em app_settings" });
  }

  if (req.method === "GET") {
    try {
      const result = await getWebhook(apiUrl, token);
      return json(res, 200, { success: result.status >= 200 && result.status < 400, ...result });
    } catch (err) {
      return json(res, 502, { success: false, message: err instanceof Error ? err.message : "Falha ao consultar UAZAPI" });
    }
  }

  if (req.method === "POST") {
    if (!req.body || typeof req.body !== "object") {
      return json(res, 400, { success: false, message: "Corpo inválido" });
    }
    const body = req.body as { webhook_url?: string };
    if (!body.webhook_url || typeof body.webhook_url !== "string") {
      return json(res, 400, { success: false, message: "webhook_url obrigatório" });
    }
    try {
      const result = await setWebhook(apiUrl, token, body.webhook_url.trim());
      return json(res, result.ok ? 200 : 502, {
        success: result.ok,
        tried: result.tried,
        message: result.ok
          ? "Webhook configurado na UAZAPI."
          : "Nenhum endpoint UAZAPI aceitou a config — veja `tried`.",
      });
    } catch (err) {
      return json(res, 502, { success: false, message: err instanceof Error ? err.message : "Falha ao configurar webhook" });
    }
  }

  return json(res, 405, { success: false, message: "Método não permitido" });
}
