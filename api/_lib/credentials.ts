import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Fica em api/_lib/ (não em src/) DE PROPÓSITO: serverless functions da Vercel que
// importam arquivos de fora da pasta api/ quebram com FUNCTION_INVOCATION_FAILED
// (com "type":"module", o bundle não resolve esses imports cross-dir). Mantendo este
// módulo dentro de api/, os imports são locais (./_lib/...) e funcionam.
// (api/_* é ignorado pelo roteamento da Vercel, então não vira endpoint.)
// O Supabase é acessado por fetch cru (PostgREST/GoTrue), como no api/bootstrap.ts —
// o @supabase/supabase-js só roda no frontend (src/lib/supabase.ts).

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

// Validação server-side das credenciais da aplicação no momento de salvar.
// ⚠️ Espelha as regras de `setupConfig.appCredentials[].validate` (setup.config.ts,
// usado pelo frontend). Como serverless functions não podem importar setup.config
// (fora de api/), mantemos esta cópia — ao adicionar/alterar uma credencial no
// setup.config, atualize aqui também.
export async function validateAppCredential(
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
      return v.length >= 8
        ? { ok: true }
        : { ok: false, message: "Token muito curto" };
    default:
      return { ok: false, message: `Credencial desconhecida: ${key}` };
  }
}
