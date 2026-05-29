import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCredential } from "../_shared/credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

// UAZAPI v2 participant: { JID, PhoneNumber, LID, IsAdmin, IsSuperAdmin, DisplayName }
type UazapiParticipant = {
  JID?: string;
  jid?: string;
  PhoneNumber?: string;
  phoneNumber?: string;
  LID?: string;
  lid?: string;
  IsAdmin?: boolean;
  isAdmin?: boolean;
  IsSuperAdmin?: boolean;
  isSuperAdmin?: boolean;
  DisplayName?: string;
  displayName?: string;
};

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function extractPhone(jid: string): string {
  const match = jid.match(/^(\d+)@/);
  return match ? match[1] : "";
}

// Busca participantes de um grupo via UAZAPI v2.
// /group/list retorna TODOS os grupos com Participants embarcados.
// Filtramos pelo JID do grupo desejado.
async function fetchParticipants(
  apiUrl: string,
  instanceToken: string,
  groupChatId: string
): Promise<UazapiParticipant[]> {
  const url = `${normalizeUrl(apiUrl)}/group/list`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", token: instanceToken },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UAZAPI /group/list error ${res.status}: ${text}`);
  }

  const body = await res.json();
  const groups = Array.isArray(body)
    ? body
    : Array.isArray(body.groups)
    ? body.groups
    : [];

  const group = groups.find((g: Record<string, unknown>) => {
    const id = (g.JID as string) || (g.jid as string) || (g.id as string);
    return id === groupChatId;
  });

  if (!group) {
    throw new Error(`Group ${groupChatId} not found in UAZAPI /group/list`);
  }

  const participants = (group.Participants as UazapiParticipant[]) ||
    (group.participants as UazapiParticipant[]) ||
    [];
  return participants;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: caller } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
    return json({ error: "Apenas administradores podem sincronizar participantes" }, 403);
  }

  let body: { group_id: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.group_id) {
    return json({ error: "group_id is required" }, 400);
  }

  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("id, whatsapp_group_id, uazapi_config_id")
    .eq("id", body.group_id)
    .single();

  if (groupErr || !group) {
    return json({ error: "Group not found" }, 404);
  }

  const apiUrl = await getCredential("uazapi_api_url");
  const instanceToken = await getCredential("uazapi_instance_token");
  if (!apiUrl || !instanceToken) {
    return json({ error: "Credenciais UAZAPI incompletas — acesse /settings/credentials" }, 400);
  }

  let participants: UazapiParticipant[];
  try {
    participants = await fetchParticipants(
      apiUrl,
      instanceToken,
      group.whatsapp_group_id
    );
  } catch (err) {
    console.error("Failed to fetch participants:", err);
    return json({ error: `UAZAPI error: ${(err as Error).message}` }, 502);
  }

  let upserted = 0;
  const errors: string[] = [];

  for (const p of participants) {
    const jid = p.JID || p.jid || "";
    if (!jid) continue;
    const phone = p.PhoneNumber || p.phoneNumber || "";
    const lid = p.LID || p.lid || null;
    const isAdmin = p.IsAdmin === true || p.isAdmin === true || p.IsSuperAdmin === true || p.isSuperAdmin === true;
    const isSuperAdmin = p.IsSuperAdmin === true || p.isSuperAdmin === true;
    const displayName = p.DisplayName || p.displayName || "";

    const record = {
      group_id: group.id,
      jid,
      lid,
      phone_number: phone ? extractPhone(phone) || phone : extractPhone(jid),
      display_name: displayName,
      is_admin: isAdmin,
      is_super_admin: isSuperAdmin,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase
      .from("group_participants")
      .upsert(record, { onConflict: "group_id,jid" });

    if (upsertErr) {
      errors.push(`${jid}: ${upsertErr.message}`);
    } else {
      upserted++;
    }
  }

  const { error: updateErr } = await supabase
    .from("groups")
    .update({ participant_count: participants.length, updated_at: new Date().toISOString() })
    .eq("id", group.id);

  if (updateErr) {
    console.error("Failed to update group participant_count:", updateErr);
  }

  return json({
    status: "ok",
    total_from_api: participants.length,
    upserted,
    errors: errors.length > 0 ? errors : undefined,
  });
});
