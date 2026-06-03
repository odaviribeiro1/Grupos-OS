import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRYPTO_KEY = Deno.env.get("CRYPTO_KEY")!;

const cache = new Map<string, { value: string | null; expiresAt: number }>();

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function decrypt(payload: string): Promise<string> {
  if (!CRYPTO_KEY || CRYPTO_KEY.length !== 64 || !/^[a-f0-9]+$/i.test(CRYPTO_KEY)) {
    throw new Error("CRYPTO_KEY ausente ou inválida");
  }
  const [ivHex, tagHex, cipherHex] = payload.split(":");
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error("Payload de criptografia malformado");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    fromHex(CRYPTO_KEY),
    "AES-GCM",
    false,
    ["decrypt"]
  );
  const cipher = fromHex(`${cipherHex}${tagHex}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(ivHex), tagLength: 128 },
    key,
    cipher
  );
  return new TextDecoder().decode(plaintext);
}

export async function getCredential(key: string, ttlMs = 60_000): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase
    .from("app_settings")
    .select("value_encrypted")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  const value = data ? await decrypt(data.value_encrypted as string) : null;
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export async function requireCredential(key: string, label: string): Promise<string> {
  const value = await getCredential(key);
  if (!value) {
    throw new Error(`${label} não configurada — acesse /settings/credentials`);
  }
  return value;
}
