import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Autossuficiente de propósito (sem import local) — ver nota em api/credentials.ts.
// Re-deploya TODAS as Edge Functions via Supabase Management API. Idempotente:
// upsert por slug. Usa o mesmo formato multipart + _shared bundle do bootstrap.

type Body = { supabase_pat?: string };

const ROOT = process.cwd();

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

function projectRefFromUrl(url: string): string {
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!match) throw new Error("SUPABASE_URL inválida");
  return match[1];
}

async function pgRest(
  path: string,
  init: RequestInit = {},
  schema = "public"
): Promise<Response> {
  const base = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (schema !== "public") {
    headers["Accept-Profile"] = schema;
    headers["Content-Profile"] = schema;
  }
  return fetch(`${base}/rest/v1${path}`, { ...init, headers });
}

async function verifyAccessToken(jwt: string): Promise<{ id: string } | null> {
  const base = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ? { id: user.id } : null;
}

async function requireOwner(req: VercelRequest): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 500; message: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Token de acesso ausente" };
  }
  const jwt = authHeader.slice("Bearer ".length);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, message: "Supabase não configurado" };
  }
  const user = await verifyAccessToken(jwt);
  if (!user) return { ok: false, status: 401, message: "Sessão inválida" };
  const res = await pgRest(`/users?id=eq.${user.id}&select=role&limit=1`, {}, "grupos");
  if (!res.ok) return { ok: false, status: 500, message: `Falha ao verificar permissões (${res.status})` };
  const rows = (await res.json()) as Array<{ role: string }>;
  const role = rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return { ok: false, status: 403, message: "Apenas administradores podem re-deployar funções" };
  }
  return { ok: true };
}

function listFunctionSlugs(): string[] {
  const dir = join(ROOT, "supabase", "functions");
  return readdirSync(dir)
    .filter((name) => name !== "_shared")
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function readFunctionSource(slug: string): string {
  return readFileSync(join(ROOT, "supabase", "functions", slug, "index.ts"), "utf8");
}

function listSharedFiles(): Array<{ path: string; source: string }> {
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

async function deployFunction(ref: string, pat: string, slug: string): Promise<void> {
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
  if (!res.ok) throw new Error(`${slug}: ${res.status} ${text}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return json(res, 405, { success: false, message: "Método não permitido" });
  }
  const auth = await requireOwner(req);
  if (!auth.ok) return json(res, auth.status, { success: false, message: auth.message });

  if (!req.body || typeof req.body !== "object") {
    return json(res, 400, { success: false, message: "Corpo inválido" });
  }
  const body = req.body as Body;
  if (!body.supabase_pat || typeof body.supabase_pat !== "string") {
    return json(res, 400, { success: false, message: "supabase_pat é obrigatório" });
  }

  let ref: string;
  try {
    ref = projectRefFromUrl(requireEnv("SUPABASE_URL"));
  } catch (err) {
    return json(res, 500, { success: false, message: err instanceof Error ? err.message : "URL inválida" });
  }

  const slugs = listFunctionSlugs();
  const deployed: string[] = [];
  const failures: Array<{ slug: string; error: string }> = [];
  for (const slug of slugs) {
    try {
      await deployFunction(ref, body.supabase_pat, slug);
      deployed.push(slug);
    } catch (err) {
      failures.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (failures.length > 0) {
    return json(res, 207, {
      success: false,
      deployed,
      failures,
      message: `${deployed.length}/${slugs.length} funções deployadas; ${failures.length} falharam`,
    });
  }

  return json(res, 200, { success: true, deployed, total: slugs.length });
}
