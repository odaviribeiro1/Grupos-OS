/**
 * Drives the REAL bootstrap against the disposable Supabase, via the local /api/bootstrap
 * handler. The prod-Vercel steps (vercel_envs_set, redeploy_triggered) are pre-marked
 * because this token's scope (SAML) can't reach the project — those steps mutate the
 * production Vercel deployment, which is irrelevant to local testing. Everything else
 * (migrations, Edge Function deploy, PostgREST, owner) runs for real.
 *
 * Prints the bootstrap-generated CRYPTO_KEY so the integration phase can pin the local
 * server to it (so locally-saved creds match what the Edge Functions decrypt with).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.test"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.PW_BASE_URL || "http://localhost:5180";
const ref = env.SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)[1];
const PAT = env.SUPABASE_PAT;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt sql (${r.status}): ${t}`);
  return t ? JSON.parse(t) : {};
}

(async () => {
  // 1. Ensure state table + pre-mark the prod-Vercel steps so bootstrap skips them.
  await sql(`create table if not exists public._bootstrap_state (step text primary key, completed_at timestamptz not null default now(), metadata jsonb);
    insert into public._bootstrap_state (step, metadata) values
      ('vercel_envs_set', '{"skipped":"local test — token scope/SAML"}'::jsonb),
      ('redeploy_triggered', '{"skipped":"local test — no prod redeploy"}'::jsonb)
    on conflict (step) do nothing;`);
  console.log("pre-marked vercel steps");

  // 2. Run the real bootstrap.
  const body = {
    supabase_url: env.SUPABASE_URL,
    supabase_anon_key: env.SUPABASE_ANON_KEY,
    supabase_service_role_key: env.SUPABASE_SERVICE_ROLE_KEY,
    supabase_pat: PAT,
    vercel_token: env.VERCEL_TOKEN,
    owner_email: env.TEST_OWNER_EMAIL,
    owner_password: env.TEST_OWNER_PASSWORD,
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/bootstrap`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log(`bootstrap [${res.status}] in ${Date.now() - t0}ms:`);
  console.log(JSON.stringify(data, null, 2));

  // 3. Read the crypto key bootstrap stored (Edge Functions decrypt with this).
  const rows = await sql(`select metadata->>'crypto_key' as k from public._bootstrap_state where step='crypto_key_generated';`);
  const key = (Array.isArray(rows) ? rows : rows.data)?.[0]?.k;
  console.log("CRYPTO_KEY(masked):", key ? key.slice(0, 8) + "…" + key.slice(-4) : "MISSING");
  console.log("CRYPTO_KEY_FULL=" + (key || ""));
})().catch((e) => { console.error("PROVISION FAILED:", e.message); process.exit(1); });
