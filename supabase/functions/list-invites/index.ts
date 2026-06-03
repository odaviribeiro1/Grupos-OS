import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
    return json({ error: "Apenas o owner pode ver convites" }, 403);
  }

  // Pendente = convidado pelo Auth (invited_at preenchido) e que ainda não
  // ativou a conta (sem last_sign_in_at).
  const { data: list, error: listErr } = await authClient.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listErr) return json({ error: listErr.message }, 500);

  const invites = (list?.users ?? [])
    .filter((u) => u.invited_at && !u.last_sign_in_at)
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: (u.user_metadata?.role as string) ?? "member",
      invited_at: u.invited_at as string,
    }));

  return json({ invites });
});
