import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type BootstrapBody = {
  supabase_url?: string;
  supabase_anon_key?: string;
  supabase_service_role_key?: string;
  supabase_pat?: string;
  vercel_token?: string;
  owner_email?: string;
  owner_password?: string;
  vercel_project_id?: string;
};

const ROOT = process.cwd();
const CORE_STATE_SQL = `
create table if not exists public._bootstrap_state (
  step text primary key,
  completed_at timestamptz not null default now(),
  metadata jsonb
);
alter table public._bootstrap_state enable row level security;
`;

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function projectRefFromUrl(url: string) {
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!match) throw new Error("SUPABASE_URL inválida");
  return match[1];
}

async function supabaseQuery(ref: string, pat: string, query: string) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase Management API falhou (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

async function adminFetch(supabaseUrl: string, serviceKey: string, path: string, init?: RequestInit) {
  return fetch(`${supabaseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function hasStep(ref: string, pat: string, step: string) {
  const escaped = step.replace(/'/g, "''");
  const result = await supabaseQuery(
    ref,
    pat,
    `select exists(select 1 from public._bootstrap_state where step = '${escaped}') as exists;`
  );
  return Boolean(result?.[0]?.exists ?? result?.data?.[0]?.exists);
}

async function getStepMetadata(ref: string, pat: string, step: string) {
  const escaped = step.replace(/'/g, "''");
  const result = await supabaseQuery(
    ref,
    pat,
    `select metadata from public._bootstrap_state where step = '${escaped}' limit 1;`
  );
  return (result?.[0]?.metadata ?? result?.data?.[0]?.metadata ?? null) as Record<string, unknown> | null;
}

async function getOrCreateCryptoKey(ref: string, pat: string) {
  const metadata = await getStepMetadata(ref, pat, "crypto_key_generated");
  const existing = typeof metadata?.crypto_key === "string" ? metadata.crypto_key : "";
  if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
  const cryptoKey = randomBytes(32).toString("hex");
  await markStep(ref, pat, "crypto_key_generated", { crypto_key: cryptoKey });
  return cryptoKey;
}

async function markStep(ref: string, pat: string, step: string, metadata: Record<string, unknown> = {}) {
  const escapedStep = step.replace(/'/g, "''");
  const escapedMetadata = JSON.stringify(metadata).replace(/'/g, "''");
  await supabaseQuery(
    ref,
    pat,
    `insert into public._bootstrap_state (step, completed_at, metadata)
     values ('${escapedStep}', now(), '${escapedMetadata}'::jsonb)
     on conflict (step) do nothing;`
  );
}

function listMigrationFiles() {
  const dir = join(ROOT, "supabase", "migrations");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}

function listFunctionSlugs() {
  const dir = join(ROOT, "supabase", "functions");
  return readdirSync(dir)
    .filter((name) => name !== "_shared")
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function readFunctionSource(slug: string) {
  return readFileSync(join(ROOT, "supabase", "functions", slug, "index.ts"), "utf8");
}

// Arquivos compartilhados (supabase/functions/_shared/*.ts). São enviados junto de
// cada função no deploy multipart para que os imports relativos `../_shared/...`
// resolvam no runtime do Deno — preserva o mesmo layout de pastas do código-fonte.
function listSharedFiles() {
  const dir = join(ROOT, "supabase", "functions", "_shared");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  } catch {
    files = [];
  }
  return files.map((file) => ({
    path: `_shared/${file}`,
    source: readFileSync(join(dir, file), "utf8"),
  }));
}

// Deploy via multipart/form-data no endpoint atual (/functions/deploy?slug=...).
// O endpoint legado (POST/PATCH /functions com body application/typescript) foi
// descontinuado e não suporta múltiplos arquivos. Upsert idempotente por slug:
// envia index.ts como entrypoint (sob <slug>/index.ts) + os módulos _shared, para
// que `../_shared/...` resolva igual ao layout local.
async function deployFunction(ref: string, pat: string, slug: string) {
  const entrypoint = `${slug}/index.ts`;
  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [JSON.stringify({ name: slug, entrypoint_path: entrypoint, verify_jwt: false })],
      { type: "application/json" }
    )
  );
  form.append("file", new Blob([readFunctionSource(slug)], { type: "application/typescript" }), entrypoint);
  for (const shared of listSharedFiles()) {
    form.append("file", new Blob([shared.source], { type: "application/typescript" }), shared.path);
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: "POST", headers: { Authorization: `Bearer ${pat}` }, body: form }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Deploy da Edge Function ${slug} falhou (${res.status}): ${text}`);
}

async function setSupabaseSecrets(
  ref: string,
  pat: string,
  values: Record<string, string>
) {
  // A Management API rejeita secrets com prefixo SUPABASE_ (reservados e injetados
  // automaticamente nas Edge Functions). Filtra fora; se nada sobrar, não chama a API.
  const secrets = Object.entries(values)
    .filter(([name]) => !name.startsWith("SUPABASE_"))
    .map(([name, value]) => ({ name, value }));
  if (secrets.length === 0) return;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify(secrets),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao configurar secrets no Supabase (${res.status}): ${text}`);
}

async function configurePostgrest(ref: string, pat: string) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/postgrest`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      db_schema: "public,graphql_public,grupos",
      db_extra_search_path: "public, extensions, grupos",
      max_rows: 1000,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao expor schema grupos no PostgREST (${res.status}): ${text}`);
}

async function createOwner(body: Required<Pick<BootstrapBody,
  "supabase_url" | "supabase_service_role_key" | "owner_email" | "owner_password"
>>) {
  const encoded = encodeURIComponent(body.owner_email.toLowerCase().trim());
  const lookup = await adminFetch(
    body.supabase_url,
    body.supabase_service_role_key,
    `/auth/v1/admin/users?email=${encoded}`
  );
  const lookupJson = await lookup.json().catch(() => null) as { users?: Array<{ id: string }> } | null;
  let userId = lookupJson?.users?.[0]?.id;

  if (!userId) {
    const create = await adminFetch(body.supabase_url, body.supabase_service_role_key, "/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: body.owner_email.toLowerCase().trim(),
        password: body.owner_password,
        email_confirm: true,
        user_metadata: { role: "owner", created_via: "setup_wizard" },
        app_metadata: { role: "owner" },
      }),
    });
    const text = await create.text();
    if (!create.ok) {
      if (create.status === 422 && text.includes("registered")) {
        return createOwner(body);
      }
      throw new Error(create.status === 400 && text.includes("weak_password")
        ? "Senha fraca. Use pelo menos 8 caracteres com letras e números."
        : `Falha ao criar owner (${create.status}): ${text}`);
    }
    const created = JSON.parse(text) as { id: string };
    userId = created.id;
  }

  const email = body.owner_email.toLowerCase().trim().replace(/'/g, "''");
  const name = email.split("@")[0].replace(/'/g, "''");
  const sql = `
    insert into grupos.users (id, email, name, role)
    values ('${userId}', '${email}', '${name}', 'owner')
    on conflict (id) do update set role = 'owner', email = excluded.email, updated_at = now();
  `;
  return { userId, sql };
}

// Resolve o projeto Vercel pelo repositório Git conectado, usando as envs que a
// Vercel injeta no runtime da function. Mais robusto que casar pelo domínio quando
// a URL é um alias de produção gerado (ex.: app-lemon-alpha.vercel.app), em que a
// busca por nome do projeto não retorna nada.
async function findVercelProjectIdByGitRepo(token: string): Promise<string | null> {
  const repoId = process.env.VERCEL_GIT_REPO_ID;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  if (!repoId && !(owner && slug)) return null;
  const res = await fetch("https://api.vercel.com/v9/projects?limit=100", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = JSON.parse(await res.text()) as {
    projects?: Array<{ id: string; link?: { repoId?: number | string; repo?: string } }>;
  };
  const ownerSlug = owner && slug ? `${owner}/${slug}` : "";
  for (const project of data.projects ?? []) {
    const link = project.link;
    if (!link) continue;
    if (repoId && link.repoId != null && String(link.repoId) === String(repoId)) return project.id;
    if (link.repo && (link.repo === ownerSlug || link.repo === slug)) return project.id;
  }
  return null;
}

async function findVercelProjectId(token: string, req: VercelRequest, explicit?: string) {
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_ID) return process.env.VERCEL_PROJECT_ID;
  const byRepo = await findVercelProjectIdByGitRepo(token);
  if (byRepo) return byRepo;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(":")[0];
  if (!host) throw new Error("Não foi possível identificar o projeto Vercel atual");
  const res = await fetch(`https://api.vercel.com/v9/projects?search=${encodeURIComponent(host)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao buscar projeto Vercel (${res.status}): ${text}`);
  const data = JSON.parse(text) as { projects?: Array<{ id: string }> };
  const projectId = data.projects?.[0]?.id;
  if (!projectId) throw new Error("Projeto Vercel não encontrado pelo domínio atual");
  return projectId;
}

async function upsertVercelEnv(projectId: string, token: string, key: string, value: string) {
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?upsert=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao configurar env ${key} na Vercel (${res.status}): ${text}`);
}

async function triggerRedeploy(projectId: string, token: string) {
  const latest = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const latestText = await latest.text();
  if (!latest.ok) throw new Error(`Falha ao buscar deployment atual (${latest.status}): ${latestText}`);
  const deployment = (JSON.parse(latestText) as { deployments?: Array<{ uid: string; url: string }> }).deployments?.[0];
  if (!deployment) throw new Error("Nenhum deployment Vercel encontrado para redeploy");
  const res = await fetch(`https://api.vercel.com/v13/deployments/${deployment.uid}/redeploy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Falha ao disparar redeploy (${res.status}): ${text}`);
  const data = JSON.parse(text) as { id?: string; uid?: string; url?: string };
  return {
    deployment_id: data.id ?? data.uid ?? deployment.uid,
    deployment_url: data.url ?? deployment.url,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return json(res, 405, { success: false, message: "Método não permitido" });
  }

  const body = req.body as BootstrapBody;
  const required = [
    "supabase_url",
    "supabase_anon_key",
    "supabase_service_role_key",
    "supabase_pat",
    "vercel_token",
    "owner_email",
    "owner_password",
  ] as const;
  for (const key of required) {
    if (!body[key]) {
      return json(res, 400, { success: false, step_failed: "validate_payload", message: `${key} é obrigatório` });
    }
  }

  const ref = projectRefFromUrl(body.supabase_url!);
  const stepsCompleted: string[] = [];
  let ownerUserId = "";

  try {
    await supabaseQuery(ref, body.supabase_pat!, CORE_STATE_SQL);
    const cryptoKey = await getOrCreateCryptoKey(ref, body.supabase_pat!);
    await markStep(ref, body.supabase_pat!, "connection_ok", { project_ref: ref });
    stepsCompleted.push("connection_ok");

    for (const migration of listMigrationFiles()) {
      const step = `migration:${migration.file}`;
      if (await hasStep(ref, body.supabase_pat!, step)) continue;
      await supabaseQuery(ref, body.supabase_pat!, migration.sql);
      await markStep(ref, body.supabase_pat!, step, { file: migration.file });
      stepsCompleted.push(step);
    }

    if (!(await hasStep(ref, body.supabase_pat!, "postgrest_configured"))) {
      await configurePostgrest(ref, body.supabase_pat!);
      await markStep(ref, body.supabase_pat!, "postgrest_configured", { schemas: ["public", "graphql_public", "grupos"] });
      stepsCompleted.push("postgrest_configured");
    }

    // Fix 8: sempre re-deploya as Edge Functions (upsert idempotente por slug) para
    // propagar mudanças de código no re-run — sem pular pelo step já marcado.
    // SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL são injetadas automaticamente nas
    // Edge Functions pelo Supabase (e a Management API rejeita o prefixo SUPABASE_),
    // então só precisamos setar a CRYPTO_KEY.
    await setSupabaseSecrets(ref, body.supabase_pat!, {
      CRYPTO_KEY: cryptoKey,
    });
    const slugs = listFunctionSlugs();
    const functionFailures: string[] = [];
    for (const slug of slugs) {
      try {
        await deployFunction(ref, body.supabase_pat!, slug);
      } catch (err) {
        functionFailures.push(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Fix 7: reporta todas as funções que falharam de uma vez. Como o deploy é
    // idempotente, o retry recomeça e re-deploya tudo de onde parou.
    if (functionFailures.length > 0) {
      throw new Error(`Falha ao deployar Edge Functions: ${functionFailures.join("; ")}`);
    }
    await markStep(ref, body.supabase_pat!, "edge_functions_deployed", { count: slugs.length });
    stepsCompleted.push("edge_functions_deployed");

    if (!(await hasStep(ref, body.supabase_pat!, "owner_created"))) {
      const owner = await createOwner({
        supabase_url: body.supabase_url!,
        supabase_service_role_key: body.supabase_service_role_key!,
        owner_email: body.owner_email!,
        owner_password: body.owner_password!,
      });
      ownerUserId = owner.userId;
      await supabaseQuery(ref, body.supabase_pat!, owner.sql);
      await markStep(ref, body.supabase_pat!, "owner_created", {
        user_id: owner.userId,
        email: body.owner_email!.toLowerCase().trim(),
      });
      stepsCompleted.push("owner_created");
    }

    if (!(await hasStep(ref, body.supabase_pat!, "vercel_envs_set"))) {
      const projectId = await findVercelProjectId(body.vercel_token!, req, body.vercel_project_id);
      // Backend (api/** lê process.env.SUPABASE_*)
      await upsertVercelEnv(projectId, body.vercel_token!, "SUPABASE_URL", body.supabase_url!);
      await upsertVercelEnv(projectId, body.vercel_token!, "SUPABASE_ANON_KEY", body.supabase_anon_key!);
      await upsertVercelEnv(projectId, body.vercel_token!, "SUPABASE_SERVICE_ROLE_KEY", body.supabase_service_role_key!);
      await upsertVercelEnv(projectId, body.vercel_token!, "CRYPTO_KEY", cryptoKey);
      // Frontend (Vite só expõe VITE_*; src/lib/supabase.ts lê estas no build)
      await upsertVercelEnv(projectId, body.vercel_token!, "VITE_SUPABASE_URL", body.supabase_url!);
      await upsertVercelEnv(projectId, body.vercel_token!, "VITE_SUPABASE_ANON_KEY", body.supabase_anon_key!);
      await markStep(ref, body.supabase_pat!, "vercel_envs_set", { project_id: projectId });
      stepsCompleted.push("vercel_envs_set");
    }

    let deployment = { deployment_id: "", deployment_url: "" };
    if (!(await hasStep(ref, body.supabase_pat!, "redeploy_triggered"))) {
      const projectId = await findVercelProjectId(body.vercel_token!, req, body.vercel_project_id);
      deployment = await triggerRedeploy(projectId, body.vercel_token!);
      await markStep(ref, body.supabase_pat!, "redeploy_triggered", deployment);
      stepsCompleted.push("redeploy_triggered");
    }

    return json(res, 200, {
      success: true,
      steps_completed: stepsCompleted,
      deployment_id: deployment.deployment_id,
      deployment_url: deployment.deployment_url,
      owner_user_id: ownerUserId,
    });
  } catch (err) {
    return json(res, 500, {
      success: false,
      step_failed: stepsCompleted.at(-1) ?? "bootstrap",
      error_code: "BOOTSTRAP_FAILED",
      message: err instanceof Error ? err.message : "Falha no bootstrap",
    });
  }
}
