import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCredential, pgRest, verifyAccessToken } from "../src/lib/credentials";

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
  return (arr as Record<string, unknown>[]).map((g) => {
    const participants = Array.isArray(g.Participants)
      ? (g.Participants as unknown[])
      : Array.isArray(g.participants)
        ? (g.participants as unknown[])
        : null;
    return {
      id: (g.id as string) || (g.JID as string) || (g.jid as string) || "",
      name: (g.name as string) || (g.Name as string) || (g.subject as string) || "(sem nome)",
      participantsCount:
        (g.participantsCount as number | undefined) ??
        (g.ParticipantCount as number | undefined) ??
        participants?.length,
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
