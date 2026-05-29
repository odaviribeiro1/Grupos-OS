// api/validate-token.ts
// Valida tokens core (Supabase + Vercel) server-side, sem expor os valores no browser.
// Esta função não depende de envs configuradas — funciona durante o Step 2 do wizard,
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
  // supabase_anon_key e supabase_service_role_key precisam da URL para o ping.
  supabase_url?: string;
};

const SUPABASE_URL_RE = /^https:\/\/[a-z0-9]+\.supabase\.co$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { type, value, supabase_url } = req.body as ValidateBody;

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
        const baseUrl = supabase_url.trim();
        // Só o header `apikey` (sem `Authorization: Bearer`, que quebraria chaves
        // novas não-JWT). Endpoint por tipo: o root do PostgREST (/rest/v1/) é
        // service_role-only — a anon recebe 401 ali ("Only the service_role API key
        // can be used for this endpoint"). Por isso validamos a anon em
        // /auth/v1/settings (qualquer chave válida → 200; inválida → 401) e mantemos
        // /rest/v1/ para a service_role (só ela passa → rejeita anon no campo errado).
        const probe =
          type === "supabase_service_role_key"
            ? `${baseUrl}/rest/v1/`
            : `${baseUrl}/auth/v1/settings`;
        const r = await fetch(probe, { headers: { apikey: value } });
        // Aceita só resposta de sucesso (consistente com supabase_pat/vercel_token).
        // `!== 401` aceitaria 5xx/429/403 como válido (falso positivo).
        valid = r.ok;
        if (!valid) message = "Chave Supabase inválida ou sem permissão";
        break;
      }

      case "supabase_pat": {
        const r = await fetch("https://api.supabase.com/v1/projects", {
          headers: { Authorization: `Bearer ${value}` },
        });
        valid = r.ok;
        if (!valid) message = "Personal Access Token Supabase inválido";
        break;
      }

      case "vercel_token": {
        const r = await fetch("https://api.vercel.com/v2/user", {
          headers: { Authorization: `Bearer ${value}` },
        });
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
