import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Save, Webhook } from "lucide-react";
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

function WebhookCard() {
  const url = useMemo(buildWebhookUrl, []);
  const [copied, setCopied] = useState(false);

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
      </div>
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
