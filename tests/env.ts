/**
 * Dependency-free loader for .env.test (no dotenv — repo policy blocks undeclared deps).
 * Parses KEY=VALUE lines and exposes the credentials the wizard/specs need, mapped to
 * the exact field keys the app uses (setup.config.ts + SetupPage Step 2).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Playwright runs from the repo root; avoid __dirname (undefined in ESM mode).
const ENV_PATH = resolve(process.cwd(), ".env.test");

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export const ENV = parseEnvFile(ENV_PATH);

// PW_BASE_URL lets the runner override the port (5173 is often taken by a sibling
// project's dev server); falls back to .env.test TEST_BASE_URL.
export const BASE_URL = process.env.PW_BASE_URL || ENV.TEST_BASE_URL || "http://localhost:5173";

/** Step 2 (core) fields the wizard collects, keyed exactly as SetupPage expects. */
export const STEP2 = {
  supabase_url: ENV.SUPABASE_URL || "",
  supabase_anon_key: ENV.SUPABASE_ANON_KEY || "",
  supabase_service_role_key: ENV.SUPABASE_SERVICE_ROLE_KEY || "",
  supabase_pat: ENV.SUPABASE_PAT || "",
  vercel_token: ENV.VERCEL_TOKEN || "",
  owner_email: ENV.TEST_OWNER_EMAIL || "",
  owner_password: ENV.TEST_OWNER_PASSWORD || "",
};

/** Step 4 (app) credentials, keyed exactly as setup.config.ts appCredentials. */
export const APP_CREDS = {
  openai_api_key: ENV.OPENAI_API_KEY || "",
  uazapi_api_url: ENV.UAZAPI_BASE_URL || "",
  uazapi_admin_token: ENV.UAZAPI_TOKEN || "",
  uazapi_instance_token: ENV.UAZAPI_INSTANCE || "",
  // app_url precisa ser https; localhost falha na validação. Usa APP_URL se fornecido.
  app_url: ENV.APP_URL || "https://grupos-whats-silk.vercel.app",
};

export const VERCEL_PROJECT_ID = ENV.VERCEL_PROJECT_ID || "";
export const VERCEL_ORG_ID = ENV.VERCEL_ORG_ID || "";
export const CRYPTO_KEY = ENV.CREDENTIALS_ENCRYPTION_KEY || ENV.CRYPTO_KEY || "";

/** Reports which required vars are missing, so specs can skip with a clear message. */
export function missingFor(kind: "wizard" | "bootstrap" | "integration"): string[] {
  const miss: string[] = [];
  const need = (obj: Record<string, string>, keys: string[], label: string) =>
    keys.forEach((k) => {
      if (!obj[k]) miss.push(`${label}.${k}`);
    });
  if (kind === "wizard" || kind === "bootstrap") {
    need(STEP2, Object.keys(STEP2), "STEP2");
  }
  if (kind === "integration") {
    need(STEP2, ["supabase_url", "supabase_anon_key", "supabase_service_role_key"], "STEP2");
    need(APP_CREDS, ["openai_api_key", "uazapi_api_url", "uazapi_instance_token"], "APP");
  }
  return miss;
}
