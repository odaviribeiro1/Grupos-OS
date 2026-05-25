import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// IMPORTANTE: este módulo é importado pelas serverless functions da Vercel
// (api/credentials.ts, api/uazapi.ts). Com `"type": "module"` no package.json, o
// @vercel/node empacota essas funções como ESM, e o @supabase/supabase-js quebra
// nesse bundle (FUNCTION_INVOCATION_FAILED). Por isso falamos com o Supabase via
// `fetch` cru no PostgREST/GoTrue — mesmo padrão do api/bootstrap.ts, que funciona.
// O client @supabase/supabase-js continua sendo usado SÓ no frontend (src/lib/supabase.ts).

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const hex = process.env.CRYPTO_KEY;
  if (!hex || hex.length !== 64 || !/^[a-f0-9]+$/i.test(hex)) {
    throw new Error("CRYPTO_KEY ausente ou inválida (esperado: 64 chars hex)");
  }
  return Buffer.from(hex, "hex");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

// Fetch no PostgREST com a service role key. `schema` != "public" usa os headers
// Accept-Profile/Content-Profile (o schema precisa estar exposto no PostgREST —
// o bootstrap expõe public,graphql_public,grupos).
export async function pgRest(
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

// Valida um access token de usuário via GoTrue. Retorna id/email ou null.
export async function verifyAccessToken(
  jwt: string
): Promise<{ id: string; email: string | null } | null> {
  const base = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string | null };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, cipherHex] = payload.split(":");
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error("Payload de criptografia malformado");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function getCredential(key: string): Promise<string | null> {
  const res = await pgRest(
    `/app_settings?key=eq.${encodeURIComponent(key)}&select=value_encrypted&limit=1`
  );
  if (!res.ok) {
    throw new Error(`getCredential(${key}) falhou (${res.status}): ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ value_encrypted: string }>;
  return rows[0] ? decrypt(rows[0].value_encrypted) : null;
}

export async function setCredential(key: string, plaintext: string): Promise<void> {
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

export async function listExistingCredentials(keys: string[]) {
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
