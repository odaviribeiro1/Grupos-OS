// src/lib/setup-persistence.ts
// Persistência segura do estado do wizard de setup.
// NUNCA persiste credenciais sensíveis (senha do owner, tokens core).

const STORAGE_KEY = "agentise.setup.step2";

// Chaves que NUNCA podem ir pra localStorage.
const SENSITIVE_KEYS = [
  "owner_password",
  "supabase_service_role_key",
  "supabase_pat",
  "vercel_token",
] as const;

type SensitiveKey = (typeof SENSITIVE_KEYS)[number];

export type Step2State = {
  supabase_url?: string;
  supabase_anon_key?: string;
  supabase_service_role_key?: string;
  supabase_pat?: string;
  vercel_token?: string;
  owner_email?: string;
  owner_password?: string;
};

// Tipo do que de fato persiste em localStorage (sem sensitive keys).
export type PersistedStep2 = Omit<Step2State, SensitiveKey>;

function stripSensitive(state: Step2State): PersistedStep2 {
  const safe: Record<string, unknown> = { ...state };
  for (const k of SENSITIVE_KEYS) delete safe[k];

  // Guard de runtime: em dev, fail loud se alguma sensitive key sobreviveu.
  if (import.meta.env.DEV) {
    for (const k of SENSITIVE_KEYS) {
      if (k in safe) {
        throw new Error(
          `[SECURITY] Tentativa de persistir credencial sensível "${k}" em localStorage. ` +
            `Isso indica bug em setup-persistence.ts. Não commitar.`
        );
      }
    }
  }

  return safe as PersistedStep2;
}

export function persistStep2(state: Step2State): void {
  const safe = stripSensitive(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // localStorage cheio ou desabilitado — silenciar, wizard continua funcional sem persistência.
  }
}

export function loadStep2(): PersistedStep2 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Sanitização defensiva: se um localStorage de versão antiga tem sensitive key, remover.
    let dirty = false;
    for (const k of SENSITIVE_KEYS) {
      if (k in parsed) {
        delete parsed[k];
        dirty = true;
      }
    }
    if (dirty) {
      console.warn("[SECURITY] localStorage legado continha credencial sensível. Limpando.");
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      } catch {
        /* noop */
      }
    }

    return parsed as PersistedStep2;
  } catch {
    return null;
  }
}

export function clearStep2(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
