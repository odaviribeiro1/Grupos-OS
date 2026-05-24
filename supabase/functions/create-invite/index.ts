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

  // Convite via Supabase Auth: cria o usuário (invited_at preenchido), o Supabase
  // envia o email com o link e a pessoa define a senha em /set-password. A role
  // viaja no user_metadata; o trigger grupos.handle_new_auth_user materializa a
  // linha em grupos.users com essa role.
  const appUrl = (await getCredential("app_url")) ?? "";
  const redirectTo = appUrl ? `${appUrl}/set-password?type=invite` : undefined;

  const { data, error: inviteErr } = await authClient.auth.admin.inviteUserByEmail(
    email,
    { data: { role }, ...(redirectTo ? { redirectTo } : {}) }
  );

  if (inviteErr) {
    // Usuário pode já existir: nesse caso, apenas atualiza a role.
    const { data: list } = await authClient.auth.admin.listUsers();
    const existing = list?.users?.find(
      (u) => u.email?.toLowerCase() === email
    );
    if (existing) {
      await supabase
        .from("users")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return json({
        ok: true,
        user_id: existing.id,
        email_sent: false,
        message: "Usuário já existe — papel atualizado.",
      });
    }
    return json({ error: inviteErr.message }, 400);
  }

  // Garante a role em grupos.users (o trigger já cria a linha; o upsert reforça).
  if (data?.user) {
    await supabase.from("users").upsert(
      {
        id: data.user.id,
        email,
        name: email.split("@")[0],
        role,
      },
      { onConflict: "id" }
    );
  }

  return json({
    ok: true,
    user_id: data?.user?.id,
    email_sent: true,
  });
});
