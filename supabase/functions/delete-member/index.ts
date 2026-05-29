import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "grupos" },
});

const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function logError(errorMessage: string, payload?: unknown) {
  try {
    await supabase.from("error_logs").insert({
      function_name: "delete-member",
      error_message: errorMessage,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
    });
  } catch { /* best effort */ }
}

async function deleteAuthUserWithRetry(memberId: string) {
  let lastErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await authClient.auth.admin.deleteUser(memberId);
    if (!error) return { ok: true as const };
    lastErr = error;
    await logError(`deleteUser retry ${attempt + 1}: ${error.message}`, { memberId });
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return { ok: false as const, error: lastErr };
}

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

  let body: { member_id: string; requester_id: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.member_id || !body.requester_id) {
    return json({ error: "member_id and requester_id are required" }, 400);
  }

  if (body.member_id === body.requester_id) {
    return json({ error: "Cannot delete yourself" }, 400);
  }

  // Verify requester is admin or owner
  const { data: requester } = await supabase
    .from("users")
    .select("role")
    .eq("id", body.requester_id)
    .single();

  if (!requester || (requester.role !== "admin" && requester.role !== "owner")) {
    return json({ error: "Only admins can delete members" }, 403);
  }

  // Delete from grupos.users
  const { error: dbErr } = await supabase
    .from("users")
    .delete()
    .eq("id", body.member_id);

  if (dbErr) {
    return json({ error: `Database error: ${dbErr.message}` }, 500);
  }

  // Delete from auth.users with retry (revokes all sessions immediately)
  const deleteResult = await deleteAuthUserWithRetry(body.member_id);

  if (deleteResult.ok) {
    return json({ status: "ok", message: "Member deleted and session revoked" });
  }

  // Delete failed — fallback: ban the user to invalidate access without deleting
  const { error: banErr } = await authClient.auth.admin.updateUserById(
    body.member_id,
    { ban_duration: "876000h" }
  );

  if (!banErr) {
    await logError(
      `deleteUser failed after 3 retries, banned as fallback: ${deleteResult.error?.message}`,
      { memberId: body.member_id }
    );
    return json({
      status: "banned",
      message: "Could not delete auth user, but access was revoked via ban",
    });
  }

  await logError(
    `deleteUser AND ban both failed: delete=${deleteResult.error?.message}, ban=${banErr.message}`,
    { memberId: body.member_id }
  );

  return json({
    status: "partial",
    message: "Removed from team but failed to revoke auth access",
    error: deleteResult.error?.message,
  });
});
