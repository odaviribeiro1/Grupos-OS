// api/validate-token.ts
// Valida tokens core (Supabase + Vercel) server-side, sem expor os valores no browser.
// Esta function não depende de envs configuradas — funciona durante o Step 2 do wizard,
// antes do bootstrap. Nunca loga o `value`, apenas `type` + outcome.
import type { VercelRequest, VercelResponse } from "@vercel/node";

type TokenType =
  | "supabase_url"
  | "supabase_anon_key"
  | "supabase_service_role_key"
  | "supabase_pat"
  | "vercel_token";

type ValidateBody = {
  type: TokenType;
  value: string;
  // supabase_anon_key/service_role_key precisam da URL para o ping; supabase_pat
  // a usa (quando disponível) para validar scope via /database/query no projeto.
  supabase_url?: string;
};

const SUPABASE_URL_RE = /^https:\/\/[a-z0-9]+\.supabase\.co$/i;
const EXTERNAL_FETCH_TIMEOUT_MS = 8000;

// Decodifica o claim `role` de um JWT do Supabase sem verificar assinatura.
// Suficiente para distinguir anon vs service_role no UX do wizard (rejeitar
// service_role colada no campo anon antes que ela vá pro localStorage).
// A validação real de assinatura acontece no probe ao endpoint do GoTrue.
function decodeSupabaseJwtRole(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: unknown;
    };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function projectRefFromUrl(url: string): string | null {
  const match = url.trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return match ? match[1] : null;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = EXTERNAL_FETCH_TIMEOUT_MS) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body as ValidateBody | undefined;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ valid: false, message: "Corpo inválido" });
  }

  const { type, value, supabase_url } = body;

  if (typeof value !== "string" || value.length === 0) {
    return res.status(400).json({ valid: false, message: "Valor ausente" });
  }
  if (typeof type !== "string") {
    return res.status(400).json({ valid: false, message: "Tipo ausente" });
  }

  // ⚠️ Não logar `value` em nenhuma circunstância. Log apenas `type` + outcome.
  const logCtx = { type, value_length: value.length };

  try {
    let valid = false;
    let message: string | undefined;

    switch (type) {
      case "supabase_url":
        valid = SUPABASE_URL_RE.test(value.trim());
        if (!valid) message = "URL do Supabase inválida";
        break;

      case "supabase_anon_key":
      case "supabase_service_role_key": {
        if (!supabase_url || !SUPABASE_URL_RE.test(supabase_url.trim())) {
          return res.status(400).json({ valid: false, message: "URL Supabase válida necessária" });
        }
        const isServiceRole = type === "supabase_service_role_key";
        const expectedRole = isServiceRole ? "service_role" : "anon";

        // 1. Checa o claim `role` do JWT antes de qualquer ping. Bloqueia o caso
        //    perigoso de service_role colada no campo anon — ela passaria no probe
        //    GoTrue (qualquer apikey válida do projeto retorna 200) e vazaria para
        //    localStorage como anon, indo parar como VITE_SUPABASE_ANON_KEY no bundle.
        const role = decodeSupabaseJwtRole(value);
        if (role && role !== expectedRole) {
          return res.status(200).json({
            valid: false,
            message: role === "service_role" && !isServiceRole
              ? "Esta é a service role key, não a anon. Cole no campo SERVICE_ROLE."
              : role === "anon" && isServiceRole
                ? "Esta é a anon key, não a service role. Cole no campo SERVICE_ROLE_KEY."
                : `Role esperada: ${expectedRole} (encontrada: ${role})`,
          });
        }

        const baseUrl = supabase_url.trim();
        // 2. Endpoint por tipo: /rest/v1/ é service_role-only (anon → 401);
        //    /auth/v1/settings aceita qualquer apikey válida do projeto (200).
        const probe = isServiceRole
          ? `${baseUrl}/rest/v1/`
          : `${baseUrl}/auth/v1/settings`;

        let r: Response;
        try {
          r = await fetchWithTimeout(probe, {
            headers: { apikey: value, accept: "application/json" },
          });
          if (!r.ok && !isServiceRole) {
            r = await fetchWithTimeout(probe, {
              headers: {
                apikey: value,
                authorization: `Bearer ${value}`,
                accept: "application/json",
              },
            });
          }
        } catch (err) {
          if (err instanceof Error && err.name === "TimeoutError") {
            return res.status(200).json({ valid: false, message: "Supabase demorou para responder. Tente novamente." });
          }
          throw err;
        }

        valid = r.ok;
        if (!valid) {
          message = "Chave Supabase inválida ou sem permissão";
          console.warn("[validate-token] probe falhou", {
            ...logCtx,
            status: r.status,
            probe,
          });
        }
        break;
      }

      case "supabase_pat": {
        // Sem URL: smoke test em /v1/projects. Aceita PATs read-only.
        // Com URL: probe que efetivamente exercita o scope `database` que o bootstrap
        //          vai precisar — rejeita PATs sem permissão antes do Step 3.
        const ref = supabase_url ? projectRefFromUrl(supabase_url) : null;
        let r: Response;
        try {
          if (ref) {
            r = await fetchWithTimeout(
              `https://api.supabase.com/v1/projects/${ref}/database/query`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
                body: JSON.stringify({ query: "select 1 as ok;" }),
              }
            );
          } else {
            r = await fetchWithTimeout("https://api.supabase.com/v1/projects", {
              headers: { Authorization: `Bearer ${value}` },
            });
          }
        } catch (err) {
          if (err instanceof Error && err.name === "TimeoutError") {
            return res.status(200).json({ valid: false, message: "Supabase Management API demorou para responder." });
          }
          throw err;
        }
        valid = r.ok;
        if (!valid) {
          if (r.status === 401) message = "Personal Access Token Supabase inválido";
          else if (r.status === 403) message = "PAT sem permissão para este projeto (precisa de scope database)";
          else if (r.status === 404 && ref) message = "Projeto não encontrado para esta PAT";
          else message = `Falha ao validar PAT (HTTP ${r.status})`;
        }
        break;
      }

      case "vercel_token": {
        let r: Response;
        try {
          r = await fetchWithTimeout("https://api.vercel.com/v2/user", {
            headers: { Authorization: `Bearer ${value}` },
          });
        } catch (err) {
          if (err instanceof Error && err.name === "TimeoutError") {
            return res.status(200).json({ valid: false, message: "Vercel API demorou para responder." });
          }
          throw err;
        }
        valid = r.ok;
        if (!valid) message = "Token Vercel inválido";
        break;
      }

      default:
        return res.status(400).json({ valid: false, message: "Tipo de token desconhecido" });
    }

    console.log("[validate-token]", { ...logCtx, valid });
    return res.status(200).json({ valid, message });
  } catch (err) {
    console.error("[validate-token] erro:", { ...logCtx, error: (err as Error).message });
    return res.status(502).json({ valid: false, message: "Falha ao validar token" });
  }
}
