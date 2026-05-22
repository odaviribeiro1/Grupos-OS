import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

  let body: { email: string; role: string; inviter_id: string; origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.email || !body.role || !body.inviter_id) {
    return json({ error: "email, role, and inviter_id are required" }, 400);
  }

  if (body.role !== "admin" && body.role !== "editor") {
    return json({ error: "role must be admin or editor" }, 400);
  }

  // Verify inviter is admin
  const { data: inviter } = await supabase
    .from("users")
    .select("role")
    .eq("id", body.inviter_id)
    .single();

  if (!inviter || inviter.role !== "admin") {
    return json({ error: "Only admins can invite members" }, 403);
  }

  // Try to invite via Supabase Auth
  const redirectTo = body.origin
    ? `${body.origin}/set-password?type=invite`
    : undefined;
  const { data, error: inviteErr } = await authClient.auth.admin.inviteUserByEmail(
    body.email.trim(),
    redirectTo ? { redirectTo } : undefined
  );

  if (inviteErr) {
    // User might already exist
    const { data: existingUsers } = await authClient.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(
      (u) => u.email === body.email.trim()
    );
    if (existing) {
      // Update role for existing user
      await supabase
        .from("users")
        .update({ role: body.role, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return json({
        status: "ok",
        message: "User already exists, role updated",
        user_id: existing.id,
      });
    }
    return json({ error: inviteErr.message }, 400);
  }

  // Set role for the new user
  if (data?.user) {
    // The auth trigger should create the user in grupos.users
    // But if not yet, upsert
    await supabase
      .from("users")
      .upsert(
        {
          id: data.user.id,
          email: body.email.trim(),
          name: body.email.split("@")[0],
          role: body.role,
        },
        { onConflict: "id" }
      );
  }

  return json({
    status: "ok",
    message: "Invitation sent",
    user_id: data?.user?.id,
  });
});
