import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createDecipheriv } from "node:crypto";

// Autossuficiente de propósito (sem import de arquivo local) — ver nota em
// api/credentials.ts. Supabase via fetch cru (PostgREST/GoTrue).

const ALGORITHM = "aes-256-gcm";

type UazapiGroup = {
  id: string;
  name: string;
  participantsCount?: number;
};

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function normalizeUrl(raw: string) {
  return raw.trim().replace(/\/+$/, "");
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

function decrypt(payload: string): string {
  const [ivHex, tagHex, cipherHex] = payload.split(":");
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error("Payload de criptografia malformado");
  }
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
  if (!res.ok) {
    throw new Error(`getCredential(${key}) falhou (${res.status}): ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ value_encrypted: string }>;
  return rows[0] ? decrypt(rows[0].value_encrypted) : null;
}

async function getAuthedUser(req: VercelRequest) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase não configurado");
  }
  return verifyAccessToken(auth.replace("Bearer ", ""));
}

async function fetchGroups(): Promise<UazapiGroup[]> {
  const apiUrl = await getCredential("uazapi_api_url");
  const instanceToken = await getCredential("uazapi_instance_token");
  if (!apiUrl || !instanceToken) {
    throw new Error("Credenciais UAZAPI incompletas. Configure URL e token da instância.");
  }

  const res = await fetch(`${normalizeUrl(apiUrl)}/group/list`, {
    method: "GET",
    headers: { "Content-Type": "application/json", token: instanceToken },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`UAZAPI /group/list falhou (${res.status}): ${text}`);
  const body = text ? JSON.parse(text) : [];
  const arr = Array.isArray(body) ? body : Array.isArray(body.groups) ? body.groups : [];

  // UAZAPI v2 (Baileys) tem nomenclatura inconsistente entre instalações: algumas
  // versões usam `JID`/`Participants`, outras `wa_chatid`/`wa_size` (prefixo wa_).
  // Tenta todos os field names conhecidos antes de cair pra contar o array.
  return (arr as Record<string, unknown>[]).map((g) => {
    const participants = Array.isArray(g.Participants)
      ? (g.Participants as unknown[])
      : Array.isArray(g.participants)
        ? (g.participants as unknown[])
        : Array.isArray(g.wa_participants)
          ? (g.wa_participants as unknown[])
          : null;

    const count =
      (g.participantsCount as number | undefined) ??
      (g.ParticipantCount as number | undefined) ??
      (g.wa_size as number | undefined) ??
      (g.wa_count as number | undefined) ??
      (g.size as number | undefined) ??
      participants?.length ??
      0;

    return {
      id:
        (g.wa_chatid as string) ||
        (g.JID as string) ||
        (g.jid as string) ||
        (g.id as string) ||
        (g.chatId as string) ||
        "",
      name:
        (g.wa_name as string) ||
        (g.wa_subject as string) ||
        (g.subject as string) ||
        (g.name as string) ||
        (g.Name as string) ||
        "(sem nome)",
      participantsCount: count,
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await getAuthedUser(req);
    if (!user) return json(res, 401, { success: false, message: "Não autorizado" });

    if (req.method === "GET") {
      const groups = await fetchGroups();
      const existingRes = await pgRest("/groups?select=whatsapp_group_id", {}, "grupos");
      const existing = existingRes.ok
        ? ((await existingRes.json()) as Array<{ whatsapp_group_id: string }>)
        : [];
      return json(res, 200, {
        groups,
        existing_ids: existing.map((row) => row.whatsapp_group_id),
      });
    }

    if (req.method === "POST") {
      const body = req.body as { groups?: UazapiGroup[] };
      const selected = body.groups ?? [];
      if (selected.length === 0) return json(res, 400, { success: false, message: "Nenhum grupo selecionado" });
      const rows = selected.map((group) => ({
        user_id: user.id,
        uazapi_config_id: null,
        whatsapp_group_id: group.id,
        name: group.name,
        participant_count: group.participantsCount ?? 0,
        is_active: true,
      }));
      const insertRes = await pgRest("/groups", { method: "POST", body: JSON.stringify(rows) }, "grupos");
      if (!insertRes.ok) {
        throw new Error(`Falha ao salvar grupos (${insertRes.status}): ${await insertRes.text()}`);
      }
      return json(res, 200, { success: true });
    }

    return json(res, 405, { success: false, message: "Método não permitido" });
  } catch (err) {
    return json(res, 500, {
      success: false,
      message: err instanceof Error ? err.message : "Falha na integração UAZAPI",
    });
  }
}
