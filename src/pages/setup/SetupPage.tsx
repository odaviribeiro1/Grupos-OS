import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, Loader2, X } from "lucide-react";
import { setupConfig } from "../../../setup.config";
import { CredentialField } from "@/components/credentials/CredentialField";
import { toast } from "@/components/ui/Toast";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { clearStep2, loadStep2, persistStep2 } from "@/lib/setup-persistence";

const STEP_LABELS = ["PREPARAR", "CREDENCIAIS", "BOOTSTRAP", "APIS"];

type Step2Values = {
  supabase_url: string;
  supabase_anon_key: string;
  supabase_service_role_key: string;
  supabase_pat: string;
  vercel_token: string;
  owner_email: string;
  owner_password: string;
};

type BootstrapPhase = "idle" | "bootstrapping" | "waiting-redeploy" | "ready";

const emptyStep2: Step2Values = {
  supabase_url: "",
  supabase_anon_key: "",
  supabase_service_role_key: "",
  supabase_pat: "",
  vercel_token: "",
  owner_email: "",
  owner_password: "",
};

// Carrega o estado persistido (sem credenciais sensíveis — elas sempre voltam vazias).
function readStep2(): Step2Values {
  return { ...emptyStep2, ...(loadStep2() ?? {}) };
}

function SetupShell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0A0F] px-4 py-8 text-[#F8FAFC]">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
        <ol className="flex w-full items-start justify-center">
          {STEP_LABELS.map((label, index) => {
            const n = index + 1;
            const active = n === step;
            const done = n < step;
            return (
              <li key={label} className="flex min-w-0 flex-1 items-start">
                <div className="flex min-w-[56px] flex-col items-center gap-2">
                  <div
                    className={[
                      "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold",
                      active
                        ? "bg-[#3B82F6] text-white shadow-[0_0_30px_rgba(59,130,246,0.5)]"
                        : done
                          ? "bg-[#1E3A8A] text-white"
                          : "border border-[rgba(59,130,246,0.3)] bg-transparent text-[#94A3B8]",
                    ].join(" ")}
                  >
                    {done ? <Check className="h-4 w-4" /> : n}
                  </div>
                  <span
                    className={[
                      "whitespace-nowrap text-[11px] font-medium uppercase leading-none tracking-[0.1em]",
                      active ? "text-[#F8FAFC]" : "text-[#94A3B8]",
                    ].join(" ")}
                  >
                    {label}
                  </span>
                </div>
                {n < STEP_LABELS.length && (
                  <div className="mt-5 flex-1 border-t border-[rgba(59,130,246,0.2)]" />
                )}
              </li>
            );
          })}
        </ol>

        <section className="rounded-2xl border border-[rgba(59,130,246,0.15)] bg-[rgba(255,255,255,0.02)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[40px] sm:p-12">
          {children}
        </section>
      </div>
    </div>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      style={{
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        ...props.style,
      }}
      className={[
        "min-h-11 rounded-xl bg-[linear-gradient(135deg,#1E3A8A_0%,#3B82F6_100%)] px-8 py-4 font-medium text-white shadow-[0_8px_40px_rgba(59,130,246,0.4),0_0_60px_rgba(59,130,246,0.2)] hover:shadow-[0_8px_50px_rgba(59,130,246,0.6),0_0_80px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none max-sm:w-full",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function PrepCard({
  n,
  title,
  text,
  href,
  pills,
}: {
  n: number;
  title: string;
  text: string;
  href: string;
  pills: string[];
}) {
  return (
    <div className="relative flex gap-4 rounded-xl border border-[rgba(59,130,246,0.12)] bg-[rgba(255,255,255,0.02)] p-5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(59,130,246,0.4)] text-sm font-medium text-[#60A5FA]">
        {n}
      </div>
      <div className="min-w-0 flex-1 pr-16">
        <h2 className="text-base font-semibold text-[#F8FAFC]">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">{text}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {pills.map((pill) => (
            <span
              key={pill}
              className="rounded-full border border-[rgba(59,130,246,0.3)] bg-[rgba(30,58,138,0.4)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.05em] text-[#60A5FA]"
            >
              {pill}
            </span>
          ))}
        </div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="absolute right-5 top-5 flex items-center gap-1 text-sm text-[#60A5FA] transition-colors hover:text-[#85B7EB]"
      >
        abrir
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

// Validação inline do Step 2.
// Tokens core (anon, service role, PAT Supabase, token Vercel) são validados
// SERVER-SIDE via /api/validate-token — o valor nunca sai do browser para as
// APIs de gerenciamento externas. URL/email/senha validam por regex local.
async function validateStep2Field(name: keyof Step2Values, values: Step2Values) {
  const value = values[name].trim();

  if (name === "supabase_url") {
    return /^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(value)
      ? { ok: true }
      : { ok: false, message: "URL Supabase inválida" };
  }
  if (name === "owner_email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? { ok: true }
      : { ok: false, message: "Email inválido" };
  }
  if (name === "owner_password") {
    return value.length >= 8 && /[a-z]/i.test(value) && /\d/.test(value)
      ? { ok: true }
      : { ok: false, message: "Use 8+ caracteres com letras e números" };
  }

  const payload: Record<string, string> = { type: name, value };
  if (name === "supabase_anon_key" || name === "supabase_service_role_key") {
    if (!values.supabase_url.trim()) {
      return { ok: false, message: "Informe a URL Supabase primeiro" };
    }
    payload.supabase_url = values.supabase_url.trim();
  }

  try {
    const res = await fetch("/api/validate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: Boolean(data.valid), message: data.message };
  } catch {
    return { ok: false, message: "Falha ao validar" };
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForHealth(timeoutMs = 300000, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${window.location.origin}/api/health`, {
        cache: "no-store",
      });
      if (res.ok) return;
    } catch {
      // O deployment pode estar trocando de versão. Tenta novamente até o timeout.
    }
    await wait(intervalMs);
  }
  throw new Error(
    "Aguardamos 5 minutos e a aplicação ainda não reiniciou com as novas envs. Verifique manualmente em vercel.com/dashboard e tente acessar /setup?step=4 novamente."
  );
}

export function SetupPage() {
  const initialStep = new URLSearchParams(window.location.search).get("step") === "4" ? 4 : 1;
  const [step, setStep] = useState(initialStep);
  const [step2, setStep2] = useState<Step2Values>(() => readStep2());
  // Se havia estado persistido, os campos sensíveis foram descartados de propósito.
  const [loadedPartial] = useState(() => loadStep2() !== null);
  const [validity, setValidity] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("idle");
  const [completedBootstrapSteps, setCompletedBootstrapSteps] = useState<string[]>([]);
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [appValues, setAppValues] = useState<Record<string, string | null>>({});
  const [appValidity, setAppValidity] = useState<Record<string, boolean>>({});
  const [savingApps, setSavingApps] = useState(false);

  // Sessão no Step 4: /api/credentials exige owner/admin autenticado.
  const [step4Session, setStep4Session] = useState<boolean | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const step2Fields = useMemo(
    () => [
      ["supabase_url", "SUPABASE_URL", "https://xxxx.supabase.co"],
      ["supabase_anon_key", "SUPABASE_ANON_KEY", "anon public key"],
      ["supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY", "service role key"],
      ["supabase_pat", "SUPABASE_PAT", "sbp_..."],
      ["vercel_token", "VERCEL_TOKEN", "Vercel token"],
      ["owner_email", "OWNER_EMAIL", "voce@email.com"],
      ["owner_password", "OWNER_PASSWORD", "mínimo 8 caracteres"],
    ] as const,
    []
  );
  const allStep2Valid = step2Fields.every(([key]) => validity[key]);
  const allAppValid = setupConfig.appCredentials.every((field) => appValidity[field.key]);

  useEffect(() => {
    persistStep2(step2);
  }, [step2]);

  useEffect(() => {
    if (step !== 2) return;
    const timers: number[] = [];
    for (const [key] of step2Fields) {
      const value = step2[key];
      if (!value.trim()) continue;
      const timer = window.setTimeout(() => {
        void validateStep2Field(key, step2).then((result) => {
          setValidity((current) => ({ ...current, [key]: result.ok }));
          setMessages((current) => ({ ...current, [key]: result.message ?? "" }));
        }).catch((err: unknown) => {
          setValidity((current) => ({ ...current, [key]: false }));
          setMessages((current) => ({
            ...current,
            [key]: err instanceof Error ? err.message : "Falha ao validar",
          }));
        });
      }, 800);
      timers.push(timer);
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [step, step2, step2Fields]);

  // Ao chegar no Step 4, verifica se há sessão (o login automático pode ter ocorrido
  // no fim do Step 3, ou a sessão foi persistida pelo client Supabase).
  useEffect(() => {
    if (step !== 4) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setStep4Session(Boolean(data.session));
      if (!data.session) {
        const persisted = loadStep2();
        if (persisted?.owner_email) setLoginEmail(persisted.owner_email);
      }
    });
    return () => {
      active = false;
    };
  }, [step]);

  async function runBootstrap() {
    setStep(3);
    setBootstrapBusy(true);
    setBootstrapError(null);
    setBootstrapPhase("bootstrapping");
    setDeploymentUrl("");
    try {
      const res = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(step2),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? "Falha no bootstrap");
      }
      setCompletedBootstrapSteps(data.steps_completed ?? []);
      if (data.deployment_url) {
        setDeploymentUrl(
          String(data.deployment_url).startsWith("http")
            ? String(data.deployment_url)
            : `https://${data.deployment_url}`
        );
      }
      setBootstrapPhase("waiting-redeploy");
      await waitForHealth();
      setBootstrapPhase("ready");

      // Tenta autenticar o owner recém-criado enquanto a senha ainda está em memória.
      // Só faz sentido se este build já tem as envs (re-execução / dev local). Na
      // primeira execução o client roda com envs placeholder — o login falha em
      // silêncio e o Step 4 pede login manual após o redeploy. A sessão, se criada,
      // é persistida pelo client Supabase e sobrevive ao reload abaixo.
      if (isSupabaseConfigured && step2.owner_email && step2.owner_password) {
        try {
          await supabase.auth.signInWithPassword({
            email: step2.owner_email.trim(),
            password: step2.owner_password,
          });
        } catch {
          /* Step 4 fará login manual */
        }
      }

      // Limpa a senha da memória imediatamente após a tentativa de login.
      setStep2((current) => ({ ...current, owner_password: "" }));
      window.location.href = "/setup?step=4";
    } catch (err) {
      setBootstrapError(err instanceof Error ? err.message : "Falha no bootstrap");
      setBootstrapPhase("idle");
    } finally {
      setBootstrapBusy(false);
    }
  }

  async function loginAtStep4() {
    setLoginBusy(true);
    setLoginError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (error) throw error;
      setStep4Session(true);
      setLoginPassword("");
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : "Não foi possível autenticar. Confira email e senha."
      );
    } finally {
      setLoginBusy(false);
    }
  }

  async function saveAppCredentials() {
    setSavingApps(true);
    try {
      const credentials = Object.fromEntries(
        Object.entries(appValues).filter(([, value]) => typeof value === "string" && value.trim())
      );
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setStep4Session(false);
        throw new Error("Sessão necessária. Faça login para finalizar.");
      }
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ credentials }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message ?? "Falha ao salvar");
      clearStep2();
      toast("Setup concluído.", "success");
      window.location.href = setupConfig.postBootstrapRedirect;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha ao salvar credenciais", "error");
    } finally {
      setSavingApps(false);
    }
  }

  if (step === 1) {
    return (
      <SetupShell step={1}>
        <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">Preparar setup do {setupConfig.toolName}</h1>
        <p className="mb-8 text-base font-normal leading-[1.6] text-[#94A3B8]">
          Separe os acessos abaixo. O wizard configura Supabase, Edge Functions,
          Vercel e as APIs da aplicação sem edição de arquivos.
        </p>
        <div className="grid gap-4">
          <PrepCard
            n={1}
            title="Criar projeto Supabase"
            text="Crie um projeto vazio e copie a URL, anon key e service role key."
            href="https://supabase.com/dashboard/new"
            pills={["SUPABASE_URL", "ANON_KEY", "SERVICE_ROLE"]}
          />
          <PrepCard
            n={2}
            title="Gerar PAT Supabase"
            text="Gere um token pessoal com permissão para migrations, functions e secrets."
            href="https://supabase.com/dashboard/account/tokens"
            pills={["SUPABASE_PAT"]}
          />
          <PrepCard
            n={3}
            title="Gerar Vercel Token"
            text="Gere um token para configurar envs e disparar o redeploy desta instância."
            href="https://vercel.com/account/tokens"
            pills={["VERCEL_TOKEN"]}
          />
        </div>
        <div className="mt-8 flex justify-end">
          <PrimaryButton onClick={() => setStep(2)}>Já tenho tudo isso → continuar</PrimaryButton>
        </div>
      </SetupShell>
    );
  }

  if (step === 2) {
    return (
      <SetupShell step={2}>
        <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">Credenciais core</h1>
        <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
          Estes dados são usados apenas durante o bootstrap. Tokens de bootstrap
          não são salvos como envs da aplicação.
        </p>
        {loadedPartial && (
          <div className="mb-6 rounded-xl border border-[rgba(59,130,246,0.3)] bg-[rgba(30,58,138,0.25)] p-4 text-[13px] leading-5 text-[#CBD5E1]">
            Suas credenciais sensíveis precisam ser digitadas novamente por segurança.
          </div>
        )}
        <div className="grid gap-4">
          {step2Fields.map(([key, label, placeholder]) => {
            const isPassword = key !== "supabase_url" && key !== "owner_email";
            const isOwnerPassword = key === "owner_password";
            return (
              <div key={key} className={key === "owner_email" ? "mt-4 rounded-xl border border-[rgba(59,130,246,0.12)] bg-[rgba(255,255,255,0.02)] p-5" : ""}>
                {key === "owner_email" && (
                  <div className="mb-4">
                    <h2 className="text-base font-semibold text-[#F8FAFC]">Conta de administrador</h2>
                    <p className="text-[13px] leading-5 text-[#94A3B8]">
                      Esta será sua conta principal de acesso à ferramenta.
                    </p>
                  </div>
                )}
                <label className="mb-1.5 block text-[13px] font-medium text-[#CBD5E1]">{label}</label>
                <div className="relative">
                  <input
                    type={isOwnerPassword ? (showOwnerPassword ? "text" : "password") : isPassword ? "password" : "text"}
                    value={step2[key]}
                    onChange={(event) => {
                      setStep2((current) => ({ ...current, [key]: event.target.value }));
                      setValidity((current) => ({ ...current, [key]: false }));
                    }}
                    placeholder={placeholder}
                    className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-4 py-3 pr-14 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                  />
                  <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                    {validity[key] && <Check className="h-4 w-4 text-[#10B981]" />}
                    {step2[key] && validity[key] === false && <X className="h-4 w-4 text-[#EF4444]" />}
                    {isOwnerPassword && (
                      <button type="button" onClick={() => setShowOwnerPassword((current) => !current)} className="text-[#94A3B8]">
                        {showOwnerPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </div>
                {messages[key] && !validity[key] && (
                  <p className="mt-1 text-xs text-[#EF4444]">{messages[key]}</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-8 flex justify-end">
          <PrimaryButton onClick={runBootstrap} disabled={!allStep2Valid}>Configurar</PrimaryButton>
        </div>
      </SetupShell>
    );
  }

  if (step === 3) {
    const timeline = [
      "Conectando ao Supabase",
      "Rodando migrations",
      "Deployando Edge Functions",
      "Criando conta de administrador",
      "Configurando Vercel",
      "Disparando redeploy",
      "Aguardando aplicação reiniciar",
    ];
    const vercelHref = deploymentUrl || "https://vercel.com/dashboard";
    return (
      <SetupShell step={3}>
        <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">Bootstrap em execução</h1>
        <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
          Esta etapa configura a instância isolada do aluno.
        </p>
        <div className="grid gap-3">
          {timeline.map((item, index) => {
            const isWaitingRestart = index === timeline.length - 1;
            const done = isWaitingRestart
              ? bootstrapPhase === "ready"
              : index < completedBootstrapSteps.length ||
                (bootstrapPhase !== "bootstrapping" && completedBootstrapSteps.length > 0);
            const active =
              !done &&
              bootstrapBusy &&
              ((isWaitingRestart && bootstrapPhase === "waiting-redeploy") ||
                (!isWaitingRestart && bootstrapPhase === "bootstrapping"));
            return (
              <div key={item} className="flex items-center gap-3 rounded-xl border border-[rgba(59,130,246,0.12)] bg-[rgba(255,255,255,0.02)] p-4">
                {done ? (
                  <Check className="h-5 w-5 text-[#10B981]" />
                ) : active ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#60A5FA]" />
                ) : (
                  <div className="h-5 w-5 rounded-full border border-[rgba(96,165,250,0.35)]" />
                )}
                <span className="text-sm text-[#CBD5E1]">
                  {isWaitingRestart && bootstrapPhase === "waiting-redeploy"
                    ? "Aguardando aplicação reiniciar..."
                    : item}
                </span>
              </div>
            );
          })}
        </div>
        {bootstrapPhase === "waiting-redeploy" && (
          <div className="mt-5 rounded-xl border border-[rgba(59,130,246,0.3)] bg-[rgba(30,58,138,0.25)] p-4 text-sm leading-6 text-[#CBD5E1]">
            O redeploy já foi disparado. O wizard vai avançar automaticamente quando
            a nova versão responder com as envs ativas.
          </div>
        )}
        {bootstrapError && (
          <div className="mt-5 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 p-4 text-sm text-[#EF4444]">
            {bootstrapError}
            {bootstrapError.includes("vercel.com/dashboard") && (
              <a
                href={vercelHref}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex w-fit items-center gap-1 text-[#60A5FA] transition-colors hover:text-[#85B7EB]"
              >
                Abrir Vercel
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
        <div className="mt-8 flex justify-end">
          <PrimaryButton onClick={runBootstrap} disabled={bootstrapBusy}>
            {bootstrapBusy ? "Configurando..." : bootstrapError ? "Tentar de novo" : "Continuar"}
          </PrimaryButton>
        </div>
      </SetupShell>
    );
  }

  // Step 4 exige sessão para salvar credenciais (POST /api/credentials é autenticado).
  if (step4Session === null) {
    return (
      <SetupShell step={4}>
        <div className="flex h-40 items-center justify-center gap-3 text-[#94A3B8]">
          <Loader2 className="h-5 w-5 animate-spin text-[#60A5FA]" />
          Verificando sessão...
        </div>
      </SetupShell>
    );
  }

  if (!step4Session) {
    return (
      <SetupShell step={4}>
        <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">Entrar para finalizar</h1>
        <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
          Faça login com a conta de administrador criada no bootstrap para salvar as
          credenciais da aplicação com segurança.
        </p>
        <div className="grid gap-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#CBD5E1]">Email</label>
            <input
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="voce@email.com"
              className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#CBD5E1]">Senha</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="senha do administrador"
              onKeyDown={(event) => {
                if (event.key === "Enter" && loginEmail.trim() && loginPassword) void loginAtStep4();
              }}
              className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
            />
          </div>
          {loginError && <p className="text-xs text-[#EF4444]">{loginError}</p>}
        </div>
        <div className="mt-8 flex justify-end">
          <PrimaryButton onClick={loginAtStep4} disabled={loginBusy || !loginEmail.trim() || !loginPassword}>
            {loginBusy ? "Entrando..." : "Entrar"}
          </PrimaryButton>
        </div>
      </SetupShell>
    );
  }

  return (
    <SetupShell step={4}>
      <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">APIs da aplicação</h1>
      <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
        Estas credenciais ficam criptografadas em app_settings no Supabase do aluno.
      </p>
      <div className="grid gap-4">
        {setupConfig.appCredentials.map((field) => (
          <CredentialField
            key={field.key}
            field={field}
            initialHasValue={false}
            onChange={(key, value) => setAppValues((current) => ({ ...current, [key]: value }))}
            onValidationChange={(key, ok) => setAppValidity((current) => ({ ...current, [key]: ok }))}
          />
        ))}
      </div>
      <div className="mt-8 flex justify-end">
        <PrimaryButton onClick={saveAppCredentials} disabled={!allAppValid || savingApps}>
          {savingApps ? "Salvando..." : "Salvar e finalizar"}
        </PrimaryButton>
      </div>
    </SetupShell>
  );
}
