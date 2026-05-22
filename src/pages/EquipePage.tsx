import { useEffect, useState } from "react";
import {
  Shield,
  UserPlus,
  Trash2,
  Crown,
  Pencil,
  Loader2,
  Copy,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/pages/placeholder";

type UserRole = "owner" | "admin" | "editor" | "member";

type Member = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  created_at: string;
};

type Invite = {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  expires_at: string;
  created_at: string;
};

function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("users")
      .select("id, email, name, role, created_at")
      .order("created_at");
    setMembers((data ?? []) as Member[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return { members, loading, reload: load };
}

function usePendingInvites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("invites")
      .select("id, email, role, token, expires_at, created_at")
      .is("used_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    setInvites((data ?? []) as Invite[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return { invites, loading, reload: load };
}

export function EquipePage() {
  const { user } = useAuth();
  const { members, loading: membersLoading, reload: reloadMembers } = useMembers();
  const { invites, loading: invitesLoading, reload: reloadInvites } =
    usePendingInvites();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "editor">("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-invite`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            role: inviteRole,
          }),
        }
      );

      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);

      setSuccess(
        data.email_sent
          ? `Convite enviado para ${inviteEmail.trim()} por email.`
          : `Convite criado. Use "Copiar link" abaixo para enviar manualmente.`
      );
      setInviteEmail("");
      await reloadInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao convidar");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/revoke-invite`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({ invite_id: inviteId }),
        }
      );

      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);

      setSuccess("Convite revogado.");
      await reloadInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao revogar");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopyLink(token: string) {
    const url = `${window.location.origin}/invite?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      setError("Não foi possível copiar — copie manualmente: " + url);
    }
  }

  async function handleDelete(memberId: string) {
    if (memberId === user?.id) {
      setError("Você não pode remover a si mesmo.");
      return;
    }
    setDeletingId(memberId);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-member`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({
            member_id: memberId,
            requester_id: user?.id,
          }),
        }
      );

      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);

      setSuccess("Membro removido.");
      await reloadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setDeletingId(null);
    }
  }

  const loading = membersLoading || invitesLoading;

  return (
    <>
      <PageHeader title="Equipe" subtitle="Gerenciar membros e convites." />

      {/* Invite form */}
      <Card className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-ink-50">Convidar membro</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="email@exemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInvite();
              }}
            />
          </div>
          <div className="w-36">
            <Label htmlFor="invite-role">Papel</Label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "member" | "editor")
              }
              className="input-base h-10 w-full rounded-xl px-3 text-sm"
            >
              <option value="member">Member</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <Button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
          >
            {inviting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Convidar
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {success && <p className="mt-2 text-xs text-success">{success}</p>}
      </Card>

      {/* Pending invites */}
      {invites.length > 0 && (
        <>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
            Convites pendentes ({invites.length})
          </h3>
          <div className="mb-6 flex flex-col gap-2">
            {invites.map((inv) => (
              <Card
                key={inv.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-100">{inv.email}</p>
                  <p className="text-[11px] text-ink-400">
                    {inv.role} · expira em{" "}
                    {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyLink(inv.token)}
                  >
                    {copiedToken === inv.token ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copiedToken === inv.token ? "Copiado" : "Copiar link"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(inv.id)}
                    disabled={revokingId === inv.id}
                  >
                    {revokingId === inv.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4 text-ink-400 hover:text-danger" />
                    )}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Members list */}
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
        Membros
      </h3>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-300" />
        </div>
      )}

      {!loading && members.length === 0 && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <Shield className="h-10 w-10 text-ink-400" />
          <p className="text-sm text-ink-300">Nenhum membro encontrado.</p>
        </Card>
      )}

      {!loading && members.length > 0 && (
        <div className="flex flex-col gap-2">
          {members.map((m) => {
            const isPrivileged = m.role === "owner" || m.role === "admin";
            return (
              <Card
                key={m.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-400">
                    {(m.name || m.email)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink-100">
                        {m.name || m.email.split("@")[0]}
                      </p>
                      <span
                        className={cn(
                          "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                          isPrivileged
                            ? "border border-yellow-500/30 bg-yellow-500/15 text-yellow-400"
                            : "border border-brand-500/30 bg-brand-500/15 text-brand-400"
                        )}
                      >
                        {isPrivileged ? (
                          <Crown className="h-2.5 w-2.5" />
                        ) : (
                          <Pencil className="h-2.5 w-2.5" />
                        )}
                        {m.role}
                      </span>
                      {m.id === user?.id && (
                        <span className="text-[9px] text-ink-400">(você)</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-ink-400">{m.email}</p>
                  </div>
                </div>

                {m.id !== user?.id && m.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                  >
                    {deletingId === m.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-ink-400 hover:text-danger" />
                    )}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
