import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCredential } from "../_shared/credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendInviteEmail(
  resendKey: string,
  from: string,
  to: string,
  inviteUrl: string
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Você foi convidado para o GrupOS",
      html: `<p>Você foi convidado para esta instância do GrupOS.</p>
        <p>Clique no link abaixo para criar sua conta (válido por 7 dias):</p>
        <p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
    }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Não autorizado" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "grupos" },
    auth: { persistSession: false },
  });
  const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Identificar caller via JWT
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authErr,
  } = await authClient.auth.getUser(token);
  if (authErr || !user) return json({ error: "Sessão inválida" }, 401);

  // Validar que é owner (admin também aceito por compat)
  const { data: caller } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
    return json({ error: "Apenas o owner pode criar convites" }, 403);
  }

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const email = body.email?.toLowerCase().trim();
  const role = body.role ?? "member";

  if (!email || !email.includes("@")) {
    return json({ error: "Email inválido" }, 400);
  }
  if (role !== "member" && role !== "editor") {
    return json({ error: "Role inválido (apenas 'member' ou 'editor')" }, 400);
  }

  // Gerar token criptográfico (32 bytes hex = 64 chars)
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const inviteToken = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: invite, error: insertErr } = await supabase
    .from("invites")
    .insert({
      email,
      token: inviteToken,
      role,
      invited_by: user.id,
    })
    .select()
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  const appUrl = (await getCredential("app_url")) ?? "";
  const inviteUrl = `${appUrl}/invite?token=${inviteToken}`;
  const resendKey = await getCredential("resend_api_key");
  const from = (await getCredential("email_from")) ?? "noreply@example.com";
  let emailSent = false;
  if (resendKey) {
    try {
      emailSent = await sendInviteEmail(resendKey, from, email, inviteUrl);
    } catch {
      // ignora — owner pode usar o link manualmente
    }
  }

  return json({
    ok: true,
    invite_id: invite.id,
    invite_url: inviteUrl,
    email_sent: emailSent,
    expires_at: invite.expires_at,
  });
});
