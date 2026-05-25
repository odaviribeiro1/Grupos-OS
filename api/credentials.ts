import type { VercelRequest, VercelResponse } from "@vercel/node";
import { setupConfig } from "../setup.config";
import {
  listExistingCredentials,
  pgRest,
  setCredential,
  verifyAccessToken,
} from "../src/lib/credentials";

type AuthResult = { userId: string } | { error: 401 | 403; message: string };

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

// Guard de acesso para edição/leitura de credenciais.
// Modelo de role desta ferramenta: grupos.users.role (NÃO public.profiles).
// Decisão de produto (Prompt 4): owner E admin podem gerenciar credenciais,
// alinhado ao guard <RequireAdmin> que protege /settings/credentials.
async function requireOwner(req: VercelRequest): Promise<AuthResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: 401, message: "Token de acesso ausente" };
  }
  const jwt = authHeader.slice("Bearer ".length);

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return { error: 401, message: "Supabase não configurado" };
  }

  // 1. Validar o JWT do usuário via GoTrue.
  const user = await verifyAccessToken(jwt);
  if (!user) {
    return { error: 401, message: "Sessão inválida ou expirada" };
  }

  // 2. Validar role no source of truth (grupos.users) via service role.
  const res = await pgRest(`/users?id=eq.${user.id}&select=role&limit=1`, {}, "grupos");
  const rows = res.ok ? ((await res.json()) as Array<{ role: string }>) : [];
  const role = rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return { error: 403, message: "Apenas administradores podem editar credenciais" };
  }

  return { userId: user.id };
}

async function validateCredential(key: string, value: string) {
  const field = setupConfig.appCredentials.find((item) => item.key === key);
  if (!field) return { ok: false, message: `Credencial desconhecida: ${key}` };
  return field.validate(value);
}

async function markCredentialsSaved() {
  await pgRest(`/_bootstrap_state`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      step: "app_credentials_saved",
      completed_at: new Date().toISOString(),
      metadata: { keys: setupConfig.appCredentials.map((item) => item.key) },
    }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireOwner(req);
  if ("error" in auth) {
    return json(res, auth.error, { success: false, message: auth.message });
  }

  try {
    if (req.method === "GET") {
      const rawKeys = req.query.keys;
      const keys = String(Array.isArray(rawKeys) ? rawKeys[0] : rawKeys ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      return json(res, 200, await listExistingCredentials(keys));
    }

    if (req.method !== "POST") {
      return json(res, 405, { success: false, message: "Método não permitido" });
    }

    const body = req.body as { credentials?: Record<string, string> } | Record<string, string>;
    const credentials =
      "credentials" in body && body.credentials ? body.credentials : (body as Record<string, string>);

    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const result = await validateCredential(key, value);
      if (!result.ok) {
        return json(res, 400, {
          success: false,
          key,
          message: result.message ?? "Credencial inválida",
        });
      }
    }

    const saved: string[] = [];
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      await setCredential(key, value.trim());
      saved.push(key);
    }

    await markCredentialsSaved();
    return json(res, 200, { success: true, saved });
  } catch (err) {
    return json(res, 500, {
      success: false,
      message: err instanceof Error ? err.message : "Falha ao salvar credenciais",
    });
  }
}
