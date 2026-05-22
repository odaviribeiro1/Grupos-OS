import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const hex = process.env.CRYPTO_KEY;
  if (!hex || hex.length !== 64 || !/^[a-f0-9]+$/i.test(hex)) {
    throw new Error("CRYPTO_KEY ausente ou inválida (esperado: 64 chars hex)");
  }
  return Buffer.from(hex, "hex");
}

export function getSupabaseAdmin(schema = "public") {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
  }
  return createClient(url, key, {
    db: { schema },
    auth: { persistSession: false },
  });
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
  const supabase = getSupabaseAdmin("public");
  const { data, error } = await supabase
    .from("app_settings")
    .select("value_encrypted")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? decrypt(data.value_encrypted as string) : null;
}

export async function setCredential(key: string, plaintext: string): Promise<void> {
  const supabase = getSupabaseAdmin("public");
  const { error } = await supabase.from("app_settings").upsert({
    key,
    value_encrypted: encrypt(plaintext),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function listExistingCredentials(keys: string[]) {
  const supabase = getSupabaseAdmin("public");
  if (keys.length === 0) return {};
  const { data, error } = await supabase
    .from("app_settings")
    .select("key")
    .in("key", keys);
  if (error) throw error;
  const existing = new Set((data ?? []).map((row) => row.key as string));
  return Object.fromEntries(keys.map((key) => [key, { exists: existing.has(key) }]));
}
