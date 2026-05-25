import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createCipheriv, randomBytes } from "node:crypto";

// Esta function é INTENCIONALMENTE autossuficiente: NENHUM import de arquivo local.
// As serverless functions deste projeto ("type":"module") quebram com
// FUNCTION_INVOCATION_FAILED ao importar qualquer módulo local relativo (mesmo
// dentro de api/) — o crash é no carregamento do módulo. Então os helpers ficam
// inline aqui, igual ao api/bootstrap.ts (que funciona: só @vercel/node + builtins).
// Acesso ao Supabase via fetch cru (PostgREST/GoTrue), como no bootstrap.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

type AuthResult = { userId: string } | { error: 401 | 403; message: string };

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente`);
  return value;
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
    throw new Error("CRYPTO_KEY ausente ou inválida (esperado: 64 chars hex)");
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

async function setCredential(key: string, plaintext: string): Promise<void> {
  const res = await pgRest(`/app_settings`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      key,
      value_encrypted: encrypt(plaintext),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`setCredential(${key}) falhou (${res.status}): ${await res.text()}`);
  }
}

async function listExistingCredentials(keys: string[]) {
  if (keys.length === 0) return {};
  const inList = keys.map((k) => encodeURIComponent(k)).join(",");
  const res = await pgRest(`/app_settings?key=in.(${inList})&select=key`);
  if (!res.ok) {
    throw new Error(`listExistingCredentials falhou (${res.status}): ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ key: string }>;
  const existing = new Set(rows.map((row) => row.key));
  return Object.fromEntries(keys.map((key) => [key, { exists: existing.has(key) }]));
}

// ⚠️ Espelha setupConfig.appCredentials[].validate (setup.config.ts, frontend) —
// serverless não pode importar setup.config; ao mudar uma credencial, atualize aqui.
async function validateAppCredential(
  key: string,
  value: string
): Promise<{ ok: boolean; message?: string }> {
  const v = value.trim();
  switch (key) {
    case "openai_api_key": {
      if (!/^sk-/i.test(v)) {
        return { ok: false, message: "A chave OpenAI deve começar com sk-" };
      }
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${v}` },
      });
      return res.ok
        ? { ok: true }
        : { ok: false, message: "Chave OpenAI inválida ou sem permissão" };
    }
    case "uazapi_api_url":
      return /^https?:\/\/\S+\.\S+/i.test(v.replace(/\/+$/, ""))
        ? { ok: true }
        : { ok: false, message: "Informe uma URL válida começando com http:// ou https://" };
    case "app_url":
      return /^https:\/\/\S+\.\S+/i.test(v.replace(/\/+$/, ""))
        ? { ok: true }
        : { ok: false, message: "Informe uma URL https válida" };
    case "uazapi_admin_token":
    case "uazapi_instance_token":
      return v.length >= 8 ? { ok: true } : { ok: false, message: "Token muito curto" };
    default:
      return { ok: false, message: `Credencial desconhecida: ${key}` };
  }
}

// Guard de acesso: owner E admin (decisão de produto, Prompt 4). Role lida do
// source of truth grupos.users via service role.
async function requireOwner(req: VercelRequest): Promise<AuthResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: 401, message: "Token de acesso ausente" };
  }
  const jwt = authHeader.slice("Bearer ".length);

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return { error: 401, message: "Supabase não configurado" };
  }

  const user = await verifyAccessToken(jwt);
  if (!user) {
    return { error: 401, message: "Sessão inválida ou expirada" };
  }

  const res = await pgRest(`/users?id=eq.${user.id}&select=role&limit=1`, {}, "grupos");
  const rows = res.ok ? ((await res.json()) as Array<{ role: string }>) : [];
  const role = rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return { error: 403, message: "Apenas administradores podem editar credenciais" };
  }

  return { userId: user.id };
}

async function markCredentialsSaved(keys: string[]) {
  await pgRest(`/_bootstrap_state`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      step: "app_credentials_saved",
      completed_at: new Date().toISOString(),
      metadata: { keys },
    }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireOwner(req);
  if ("error" in auth) {
    return json(res, auth.error, { success: false, message: auth.message });
  }

  try {
    if (req.method === "GET") {
      const rawKeys = req.query.keys;
      const keys = String(Array.isArray(rawKeys) ? rawKeys[0] : rawKeys ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      return json(res, 200, await listExistingCredentials(keys));
    }

    if (req.method !== "POST") {
      return json(res, 405, { success: false, message: "Método não permitido" });
    }

    const body = req.body as { credentials?: Record<string, string> } | Record<string, string>;
    const credentials =
      "credentials" in body && body.credentials ? body.credentials : (body as Record<string, string>);

    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const result = await validateAppCredential(key, value);
      if (!result.ok) {
        return json(res, 400, {
          success: false,
          key,
          message: result.message ?? "Credencial inválida",
        });
      }
    }

    const saved: string[] = [];
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      await setCredential(key, value.trim());
      saved.push(key);
    }

    await markCredentialsSaved(saved);
    return json(res, 200, { success: true, saved });
  } catch (err) {
    return json(res, 500, {
      success: false,
      message: err instanceof Error ? err.message : "Falha ao salvar credenciais",
    });
  }
}
