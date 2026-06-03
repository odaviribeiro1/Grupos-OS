import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authErr,
  } = await authClient.auth.getUser(token);
  if (authErr || !user) return json({ error: "Sessão inválida" }, 401);

  const { data: caller } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
    return json({ error: "Apenas o owner pode revogar convites" }, 403);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  if (!body.user_id) return json({ error: "user_id obrigatório" }, 400);

  // Só revoga convites pendentes (usuário ainda não ativou a conta). Membros
  // ativos devem ser removidos pela lista de Membros (delete-member).
  const { data: target, error: getErr } =
    await authClient.auth.admin.getUserById(body.user_id);
  if (getErr || !target?.user) {
    return json({ error: "Convite não encontrado" }, 404);
  }
  if (target.user.last_sign_in_at) {
    return json(
      { error: "Usuário já ativou a conta; remova pela lista de Membros." },
      400
    );
  }

  // Deleta o usuário no Auth — o FK on delete cascade remove de grupos.users.
  const { error: delErr } = await authClient.auth.admin.deleteUser(body.user_id);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ ok: true, user_id: body.user_id });
});
