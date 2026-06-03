export type CredentialValidationResult = {
  ok: boolean;
  message?: string;
};

export type CredentialField = {
  key: string;
  label: string;
  helpText?: string;
  docsUrl?: string;
  placeholder?: string;
  inputType?: "text" | "password";
  validate: (value: string) => Promise<CredentialValidationResult>;
};

export type SetupConfig = {
  toolName: string;
  toolSlug: string;
  appCredentials: CredentialField[];
  postBootstrapRedirect: string;
};

async function validateOpenAI(value: string): Promise<CredentialValidationResult> {
  if (!/^sk-/i.test(value.trim())) {
    return { ok: false, message: "A chave OpenAI deve começar com sk-" };
  }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${value.trim()}` },
      // Sem timeout, o "Salvar e finalizar" trava se a OpenAI estiver lenta.
      signal: AbortSignal.timeout(8000),
    });
    return res.ok
      ? { ok: true }
      : { ok: false, message: "Chave OpenAI inválida ou sem permissão" };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, message: "OpenAI demorou para responder. Tente novamente." };
    }
    return { ok: false, message: "Falha ao validar chave OpenAI" };
  }
}

export const setupConfig: SetupConfig = {
  toolName: "GrupOS",
  toolSlug: "grupos",
  postBootstrapRedirect: "/login",
  appCredentials: [
    {
      key: "openai_api_key",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      inputType: "password",
      docsUrl: "https://platform.openai.com/api-keys",
      helpText: "Usada para transcrição, embeddings, chat com contexto e resumos.",
      validate: validateOpenAI,
    },
    {
      key: "uazapi_api_url",
      label: "URL da UAZAPI",
      placeholder: "https://api.uazapi.com",
      inputType: "text",
      helpText: "URL base do servidor UAZAPI que vai hospedar a instância WhatsApp.",
      validate: async (value) => {
        const normalized = value.trim().replace(/\/+$/, "");
        if (!/^https?:\/\/\S+\.\S+/i.test(normalized)) {
          return { ok: false, message: "Informe uma URL válida começando com http:// ou https://" };
        }
        return { ok: true };
      },
    },
    {
      key: "uazapi_admin_token",
      label: "Token admin UAZAPI",
      placeholder: "admin token",
      inputType: "password",
      helpText: "Usado uma vez para criar e gerenciar a instância WhatsApp.",
      validate: async (value) => {
        if (value.trim().length < 8) {
          return { ok: false, message: "Token muito curto" };
        }
        return { ok: true };
      },
    },
    {
      key: "uazapi_instance_token",
      label: "Token da instância UAZAPI",
      placeholder: "instance token",
      inputType: "password",
      helpText: "Token da instância WhatsApp conectada que será usada para listar grupos e enviar mensagens.",
      validate: async (value) => {
        if (value.trim().length < 8) {
          return { ok: false, message: "Token muito curto" };
        }
        return { ok: true };
      },
    },
    {
      key: "app_url",
      label: "URL pública do app",
      placeholder: "https://seu-app.vercel.app",
      inputType: "text",
      helpText: "Usada para gerar links de convite.",
      validate: async (value) => {
        if (!/^https:\/\/\S+\.\S+/i.test(value.trim().replace(/\/+$/, ""))) {
          return { ok: false, message: "Informe uma URL https válida" };
        }
        return { ok: true };
      },
    },
  ],
};
