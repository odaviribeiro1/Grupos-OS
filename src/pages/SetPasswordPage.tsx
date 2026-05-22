import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { toast } from "@/components/ui/Toast";

type FlowType = "invite" | "recovery";

export function SetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawType = params.get("type");
  const type: FlowType = rawType === "recovery" ? "recovery" : "invite";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-400">
        Carregando…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const title = type === "invite" ? "Defina sua senha" : "Recuperar senha";
  const subtitle =
    type === "invite"
      ? "Crie uma senha para acessar sua conta no GrupOS."
      : "Escolha uma nova senha para sua conta.";
  const cta = type === "invite" ? "Definir senha" : "Atualizar senha";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      toast(
        type === "invite"
          ? "Senha definida com sucesso!"
          : "Senha atualizada com sucesso!",
        "success"
      );
      navigate("/grupos", { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao atualizar a senha"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient shadow-glow-md">
            <KeyRound className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink-50">{title}</h1>
            <p className="text-sm text-ink-400">{subtitle}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input
              id="confirm"
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Aguarde…" : cta}
          </Button>
        </form>
      </Card>
    </div>
  );
}
