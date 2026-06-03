import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Save } from "lucide-react";
import { setupConfig } from "../../../setup.config";
import { CredentialField } from "@/components/credentials/CredentialField";
import { toast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";

type ExistsResponse = Record<string, { exists: boolean }>;

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
