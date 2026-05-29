/**
 * Dependency-free Supabase access for integration specs: owner sign-in (JWT),
 * PostgREST queries (service role), and Edge Function invocation. Uses global fetch.
 */
import { STEP2, APP_CREDS } from "../env";

const SUPABASE_URL = STEP2.supabase_url.replace(/\/+$/, "");
const ANON = STEP2.supabase_anon_key;
const SERVICE = STEP2.supabase_service_role_key;

export async function signInOwner(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: STEP2.owner_email, password: STEP2.owner_password }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Login owner falhou (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

export async function rest(
  path: string,
  init: RequestInit = {},
  schema = "grupos"
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (schema !== "public") {
    headers["Accept-Profile"] = schema;
    headers["Content-Profile"] = schema;
  }
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
}

export async function restJson<T = unknown>(path: string, init?: RequestInit, schema = "grupos"): Promise<T> {
  const res = await rest(path, init, schema);
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${path} (${res.status}): ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Invoke a Supabase Edge Function. Pass a user JWT for authed functions. */
export async function callEdge(
  name: string,
  body: unknown,
  token?: string
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text };
}

export const SEED_GROUP_ID = "a4cef90c-f394-416e-830e-4e2d313f11ea";
export const SEED_CHAT_ID = "test@g.us";

export { SUPABASE_URL, ANON, SERVICE, APP_CREDS };
