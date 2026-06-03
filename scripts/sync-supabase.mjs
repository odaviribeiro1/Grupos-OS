#!/usr/bin/env node
// scripts/sync-supabase.mjs
// Aplica migrations e re-deploya Edge Functions no Supabase do aluno SEM
// passar pelo wizard inteiro. Não toca em Vercel — pra setup inicial completo,
// use /setup. Útil quando o code de uma Edge Function muda ou migrations
// novas são adicionadas.
//
// Uso:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ACCESS_TOKEN=sbp_... \
//   node scripts/sync-supabase.mjs

import fs from "node:fs";
import path from "node:path";

const URL = process.env.SUPABASE_URL;
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!URL || !PAT) {
  console.error("SUPABASE_URL e SUPABASE_ACCESS_TOKEN são obrigatórios");
  process.exit(1);
}

const ref = URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1];
if (!ref) {
  console.error("URL inválida — esperado https://<ref>.supabase.co");
  process.exit(1);
}

async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL falhou (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function listAppliedSteps() {
  await runSql(`
    create table if not exists public._bootstrap_state (
      step text primary key,
      completed_at timestamptz not null default now(),
      metadata jsonb
    );
    alter table public._bootstrap_state enable row level security;
  `);
  const result = await runSql(`select step from public._bootstrap_state;`);
  const rows = Array.isArray(result) ? result : result?.data ?? [];
  return new Set(rows.map((r) => r.step));
}

async function markStep(step, metadata = {}) {
  const escStep = step.replace(/'/g, "''");
  const escMeta = JSON.stringify(metadata).replace(/'/g, "''");
  await runSql(`
    insert into public._bootstrap_state (step, completed_at, metadata)
    values ('${escStep}', now(), '${escMeta}'::jsonb)
    on conflict (step) do update set completed_at = excluded.completed_at, metadata = excluded.metadata;
  `);
}

async function applyMigrations() {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = await listAppliedSteps();
  let appliedCount = 0;
  for (const file of files) {
    const step = `migration:${file}`;
    if (applied.has(step)) {
      console.log(`  [skip] ${file}`);
      continue;
    }
    console.log(`  [apply] ${file}`);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await runSql(sql);
    await markStep(step, { file });
    appliedCount++;
  }
  console.log(`  → ${appliedCount} aplicadas, ${files.length - appliedCount} já existentes`);
}

function listFunctionSlugs() {
  const dir = path.join(process.cwd(), "supabase/functions");
  return fs
    .readdirSync(dir)
    .filter((n) => n !== "_shared")
    .filter((n) => fs.statSync(path.join(dir, n)).isDirectory())
    .sort();
}

function listSharedFiles() {
  const dir = path.join(process.cwd(), "supabase/functions/_shared");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".ts")).map((n) => ({
      path: `_shared/${n}`,
      source: fs.readFileSync(path.join(dir, n), "utf8"),
    }));
  } catch {
    return [];
  }
}

async function deployFunction(slug) {
  const entrypoint = `${slug}/index.ts`;
  const source = fs.readFileSync(
    path.join(process.cwd(), "supabase/functions", slug, "index.ts"),
    "utf8"
  );

  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          name: slug,
          entrypoint_path: entrypoint,
          verify_jwt: false,
        }),
      ],
      { type: "application/json" }
    )
  );
  form.append("file", new Blob([source], { type: "application/typescript" }), entrypoint);
  for (const shared of listSharedFiles()) {
    form.append("file", new Blob([shared.source], { type: "application/typescript" }), shared.path);
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: "POST", headers: { Authorization: `Bearer ${PAT}` }, body: form }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
}

async function deployAllFunctions() {
  const slugs = listFunctionSlugs();
  console.log(`  Deploying ${slugs.length} Edge Functions...`);
  for (const slug of slugs) {
    process.stdout.write(`  [deploy] ${slug.padEnd(28)} `);
    try {
      await deployFunction(slug);
      console.log("✓");
    } catch (e) {
      console.log(`✗ ${e.message}`);
      throw e;
    }
  }
}

async function scheduleCron() {
  const fnUrl = `${URL.replace(/\/+$/, "")}/functions/v1/cron-daily-summary`;
  const escaped = fnUrl.replace(/'/g, "''");
  console.log(`  URL: ${fnUrl}`);
  await runSql(`select grupos.schedule_daily_summary('${escaped}');`);
  await markStep("cron_scheduled", { function_url: fnUrl });
  console.log("  ✓ pg_cron agendado (0 * * * *)");
}

(async () => {
  console.log(`Sync Supabase: ${ref}\n`);
  console.log("1. Migrations");
  await applyMigrations();
  console.log("\n2. Edge Functions");
  await deployAllFunctions();
  console.log("\n3. Cron");
  await scheduleCron();
  console.log("\n✓ Tudo aplicado.");
})().catch((e) => {
  console.error("\n✗ Falha:", e.message);
  process.exit(1);
});
