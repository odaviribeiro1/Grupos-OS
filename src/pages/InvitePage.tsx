import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

type InviteState =
  | { status: "loading" }
  | { status: "valid"; email: string; role: string }
  | { status: "invalid"; reason: string };

export function InvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [invite, setInvite] = useState<InviteState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setInvite({ status: "invalid", reason: "Token ausente na URL." });
      return;
    }
    void (async () => {
      const { data, error: fetchErr } = await supabase
        .from("invites")
        .select("email, role, expires_at, used_at, revoked_at")
        .eq("token", token)
        .maybeSingle();

      if (fetchErr || !data) {
        setInvite({
          status: "invalid",
          reason: "Convite não encontrado.",
        });
        return;
      }
      if (data.used_at) {
        setInvite({ status: "invalid", reason: "Convite já foi utilizado." });
        return;
      }
      if (data.revoked_at) {
        setInvite({ status: "invalid", reason: "Convite revogado pelo owner." });
        return;
      }
      if (new Date(data.expires_at).getTime() < Date.now()) {
        setInvite({ status: "invalid", reason: "Convite expirado." });
        return;
      }
      setInvite({ status: "valid", email: data.email, role: data.role });
    })();
  }, [token]);

  async function handleSubmit() {
    if (invite.status !== "valid") return;
    if (password.length < 8) {
      setError("Senha precisa ter no mínimo 8 caracteres.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: signupErr } = await supabase.auth.signUp({
        email: invite.email,
        password,
        options: {
          data: {
            invite_token: token,
            ...(name.trim() ? { name: name.trim() } : {}),
          },
        },
      });
      if (signupErr) throw signupErr;
      navigate("/login", {
        replace: true,
        state: { message: "Conta criada. Faça login para entrar." },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao criar conta");
    } finally {
      setSubmitting(false);
    }
  }

  if (invite.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-300" />
      </div>
    );
  }

  if (invite.status === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-danger" />
          <h1 className="mb-2 text-lg font-semibold text-ink-50">
            Convite inválido
          </h1>
          <p className="text-sm text-ink-300">{invite.reason}</p>
          <Button
            className="mt-5"
            onClick={() => navigate("/login")}
            variant="ghost"
          >
            Voltar para login
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-success" />
          <h1 className="text-lg font-semibold text-ink-50">Aceitar convite</h1>
        </div>
        <p className="mb-5 text-sm text-ink-300">
          Você foi convidado como <strong>{invite.role}</strong>. Defina uma
          senha para criar sua conta.
        </p>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={invite.email} disabled />
          </div>
          <div>
            <Label htmlFor="invite-name">Nome (opcional)</Label>
            <Input
              id="invite-name"
              type="text"
              placeholder="Como te chamamos?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="invite-password">Senha (mínimo 8 caracteres)</Label>
            <Input
              id="invite-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <Button onClick={handleSubmit} disabled={submitting || password.length < 8}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar conta
          </Button>
        </div>
      </Card>
    </div>
  );
}
