import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Loader2, RefreshCw, Save, Webhook } from "lucide-react";
import { setupConfig } from "../../../setup.config";
import { CredentialField } from "@/components/credentials/CredentialField";
import { toast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";

type ExistsResponse = Record<string, { exists: boolean }>;

// URL completa do webhook que a UAZAPI precisa chamar pra entregar mensagens
// pra Edge Function `webhook-uazapi`. Construída a partir de VITE_SUPABASE_URL
// (assada no bundle pelo bootstrap do wizard), então já vem com o project ref
// do aluno embutido — basta copiar e colar na configuração da instância.
function buildWebhookUrl(): string | null {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/webhook-uazapi`;
}

// Re-deploy de Edge Functions sem precisar refazer o wizard. O PAT NÃO é
// armazenado em lugar nenhum — só usado no momento da requisição.
function RedeployFunctionsCard() {
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ deployed: string[]; failures?: Array<{ slug: string; error: string }> } | null>(null);

  async function redeploy() {
    if (!pat.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada. Recarregue a página.");
      const res = await fetch("/api/redeploy-functions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ supabase_pat: pat.trim() }),
      });
      const data = await res.json();
      setResult({ deployed: data.deployed ?? [], failures: data.failures });
      if (data.success) {
        toast(`${data.deployed.length} Edge Functions deployadas.`, "success");
        setPat("");
      } else {
        toast(data.message ?? "Falha parcial no re-deploy.", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha ao re-deployar", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-[rgba(59,130,246,0.2)] bg-[rgba(30,58,138,0.18)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(30,58,138,0.4)] text-[#60A5FA]">
          <RefreshCw className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[#F8FAFC]">
            Re-deployar Edge Functions
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">
            Use quando código de uma Edge Function mudou (webhook, geração de
            resumo, etc). Sua PAT do Supabase é usada uma vez e descartada — não
            ficamos com ela.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="sbp_... (Supabase Personal Access Token)"
          className="min-h-11 flex-1 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[rgba(0,0,0,0.35)] px-4 font-mono text-[13px] text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
        />
        <button
          type="button"
          onClick={redeploy}
          disabled={busy || !pat.trim()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[rgba(59,130,246,0.35)] bg-[rgba(30,58,138,0.4)] px-4 text-sm font-medium text-[#F8FAFC] transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,130,246,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Deployando...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Re-deployar tudo
            </>
          )}
        </button>
      </div>
      {result && (
        <div className="mt-3 space-y-1 text-[12px] leading-5 text-[#CBD5E1]">
          {result.deployed.length > 0 && (
            <p>
              <span className="text-[#10B981]">✓</span> Deployadas: {result.deployed.join(", ")}
            </p>
          )}
          {result.failures && result.failures.length > 0 && (
            <div className="text-[#EF4444]">
              <p>✗ Falharam:</p>
              <ul className="ml-4 list-disc">
                {result.failures.map((f) => (
                  <li key={f.slug} className="break-all">
                    <span className="font-mono">{f.slug}</span>: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WebhookCard() {
  const url = useMemo(buildWebhookUrl, []);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; body: string } | null>(null);

  if (!url) return null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("URL do webhook copiada.", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Não foi possível copiar. Selecione o texto manualmente.", "error");
    }
  }

  // Manda um POST pra própria URL do webhook simulando UAZAPI. Se chegar até a
  // Edge Function, a resposta vai indicar (ex: 400 "Missing chatId", ou 200
  // "ignored: not a group message" pra payload mínimo). Qualquer resposta
  // exceto 401/403/404 prova que a função está reachable sem auth — então o
  // problema está na config da UAZAPI (URL errada no painel, evento errado,
  // webhook desabilitado).
  async function testEndpoint() {
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat: { wa_chatid: "test@g.us", wa_isGroup: true },
          message: { messageType: "text", text: "ping de teste", messageid: "test-" + Date.now() },
        }),
      });
      const body = await res.text();
      setTestResult({ status: res.status, body: body.slice(0, 400) });
    } catch (err) {
      setTestResult({ status: 0, body: err instanceof Error ? err.message : "Falha de rede" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-[rgba(59,130,246,0.2)] bg-[rgba(30,58,138,0.18)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(30,58,138,0.4)] text-[#60A5FA]">
          <Webhook className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[#F8FAFC]">
            URL do webhook (UAZAPI → ferramenta)
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">
            Cole essa URL no campo de webhook da sua instância UAZAPI e habilite
            o evento <span className="font-mono text-[#CBD5E1]">messages</span>.
            Sem isso, as mensagens dos grupos não chegam aqui.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="flex min-h-11 flex-1 items-center overflow-x-auto rounded-lg border border-[rgba(59,130,246,0.25)] bg-[rgba(0,0,0,0.35)] px-4 font-mono text-[13px] text-[#F8FAFC]">
          <span className="whitespace-nowrap">{url}</span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[rgba(59,130,246,0.35)] bg-[rgba(30,58,138,0.4)] px-4 text-sm font-medium text-[#F8FAFC] transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,130,246,0.35)]"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-[#10B981]" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copiar
            </>
          )}
        </button>
        <button
          type="button"
          onClick={testEndpoint}
          disabled={testing}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[rgba(59,130,246,0.35)] bg-[rgba(30,58,138,0.25)] px-4 text-sm font-medium text-[#CBD5E1] transition-all duration-300 hover:bg-[rgba(30,58,138,0.4)] hover:text-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Testando...
            </>
          ) : (
            "Testar URL"
          )}
        </button>
      </div>
      {testResult && (
        <div className="mt-3 rounded-lg border border-[rgba(59,130,246,0.15)] bg-[rgba(0,0,0,0.25)] p-3 text-[12px] leading-5">
          <p className="mb-1 font-medium text-[#CBD5E1]">
            Resposta:{" "}
            <span
              className={
                testResult.status >= 200 && testResult.status < 400
                  ? "text-[#10B981]"
                  : testResult.status === 0
                    ? "text-[#EF4444]"
                    : "text-[#F59E0B]"
              }
            >
              HTTP {testResult.status || "ERRO"}
            </span>
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[#94A3B8]">
            {testResult.body}
          </pre>
          <p className="mt-2 text-[11px] text-[#94A3B8]">
            {testResult.status >= 200 && testResult.status < 400 ? (
              <>
                <span className="text-[#10B981]">✓</span> Endpoint reachable. Se mensagens
                reais não chegam, o problema é a config do webhook na UAZAPI (URL,
                evento ou habilitação).
              </>
            ) : testResult.status === 401 || testResult.status === 403 ? (
              <>
                <span className="text-[#EF4444]">✗</span> Auth bloqueada. Re-deploy a função
                acima ou verifique se <span className="font-mono">verify_jwt: false</span> está aplicado.
              </>
            ) : testResult.status === 404 ? (
              <>
                <span className="text-[#EF4444]">✗</span> Função não encontrada — re-deploya
                no card acima.
              </>
            ) : (
              <>O endpoint respondeu; payload acima. A UAZAPI precisa estar configurada pra esta mesma URL.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export function CredentialsPage() {
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [changed, setChanged] = useState<Record<string, string | null>>({});
  const [validity, setValidity] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const keys = useMemo(
    () => setupConfig.appCredentials.map((field) => field.key),
    []
  );
  const dirtyKeys = Object.entries(changed).filter(([, value]) => typeof value === "string" && value.trim());
  const canSave = dirtyKeys.length > 0 && dirtyKeys.every(([key]) => validity[key]);

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`/api/credentials?keys=${encodeURIComponent(keys.join(","))}`, {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const data = (await res.json()) as ExistsResponse;
      if (!active) return;
      setExists(Object.fromEntries(keys.map((key) => [key, data[key]?.exists === true])));
    })()
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : "Falha ao carregar credenciais", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [keys]);

  async function save() {
    setSaving(true);
    try {
      const credentials = Object.fromEntries(dirtyKeys);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ credentials }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message ?? "Falha ao salvar credenciais");
      setExists((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(credentials).map((key) => [key, true])),
      }));
      setChanged({});
      toast("Credenciais atualizadas.", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha ao salvar credenciais", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-ink-400">Carregando...</div>;
  }

  return (
    <div className="pb-24">
      <div className="mb-8">
        <Link to="/grupos" className="text-sm text-[#60A5FA] transition-colors hover:text-[#85B7EB]">
          ← Voltar
        </Link>
        <h1 className="mt-3 text-[28px] font-semibold text-[#F8FAFC]">
          Credenciais de aplicação
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-[1.6] text-[#94A3B8]">
          Edite as chaves de API usadas pela ferramenta. Alterações entram em
          vigor imediatamente, sem redeploy.
        </p>
      </div>

      <WebhookCard />

      <RedeployFunctionsCard />

      <div className={setupConfig.appCredentials.length > 6 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
        {setupConfig.appCredentials.map((field) => (
          <CredentialField
            key={`${field.key}:${exists[field.key]}`}
            field={field}
            initialHasValue={exists[field.key] === true}
            onChange={(key, value) => {
              setChanged((current) => ({ ...current, [key]: value }));
              if (!value) setValidity((current) => ({ ...current, [key]: exists[key] === true }));
            }}
            onValidationChange={(key, ok) => setValidity((current) => ({ ...current, [key]: ok }))}
          />
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[rgba(59,130,246,0.15)] bg-[#0A0A0F]/90 px-4 py-4 backdrop-blur-xl md:left-64">
        <div className="mx-auto flex max-w-6xl justify-end">
          <button
            type="button"
            onClick={save}
            disabled={!canSave || saving}
            style={{ transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)" }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#1E3A8A_0%,#3B82F6_100%)] px-8 py-4 font-medium text-white shadow-[0_8px_40px_rgba(59,130,246,0.4),0_0_60px_rgba(59,130,246,0.2)] hover:shadow-[0_8px_50px_rgba(59,130,246,0.6),0_0_80px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none max-sm:w-full"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
