import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { toast } from "@/components/ui/Toast";

type Mode = "signin" | "signup";

export function LoginPage() {
  const { session, signIn, signUp, loading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotError(null);
    if (!forgotEmail.trim()) return;
    setForgotBusy(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        forgotEmail.trim(),
        {
          redirectTo: `${window.location.origin}/set-password?type=recovery`,
        }
      );
      if (resetErr) throw resetErr;
      toast(
        "Se o email existir, enviaremos um link de recuperação.",
        "success"
      );
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err) {
      setForgotError(
        err instanceof Error ? err.message : "Falha ao enviar o email"
      );
    } finally {
      setForgotBusy(false);
    }
  }

  if (!loading && session) {
    const to =
      (location.state as { from?: { pathname: string } } | null)?.from
        ?.pathname ?? "/grupos";
    return <Navigate to={to} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password, name || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient shadow-glow-md">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink-50">GrupOS</h1>
            <p className="text-sm text-ink-400">
              {mode === "signin"
                ? "Entre para continuar"
                : "Crie sua conta Agentise"}
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@agentise.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
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

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={busy}>
            {busy
              ? "Aguarde…"
              : mode === "signin"
                ? "Entrar"
                : "Criar conta"}
          </Button>

          {mode === "signin" && (
            <button
              type="button"
              onClick={() => {
                setForgotOpen(true);
                setForgotEmail(email);
                setForgotError(null);
              }}
              className="text-xs text-ink-400 transition-colors hover:text-brand-400"
            >
              Esqueci minha senha
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            className="text-xs text-ink-400 transition-colors hover:text-brand-400"
          >
            {mode === "signin"
              ? "Não tem conta? Criar agora"
              : "Já tem conta? Entrar"}
          </button>
        </form>
      </Card>

      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setForgotOpen(false)}
        >
          <Card
            className="w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink-50">
                  Recuperar senha
                </h2>
                <p className="text-xs text-ink-400">
                  Informe seu email e enviaremos um link para redefinir a senha.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="rounded-lg p-1 text-ink-400 transition-colors hover:text-ink-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="forgot-email">E-mail</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="voce@agentise.com"
                  autoFocus
                />
              </div>

              {forgotError && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {forgotError}
                </p>
              )}

              <Button type="submit" size="lg" disabled={forgotBusy}>
                {forgotBusy ? "Enviando…" : "Enviar link de recuperação"}
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
