import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Plus,
  Search,
  Trash2,
  Users2,
  MessageSquare,
  Power,
  PowerOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/pages/placeholder";
import { toast } from "@/components/ui/Toast";

type Group = {
  id: string;
  whatsapp_group_id: string;
  name: string;
  participant_count: number;
  is_active: boolean;
  message_count?: number;
};

type UazapiGroup = {
  id: string;
  name: string;
  participantsCount?: number;
};

function useGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("groups")
      .select("id, whatsapp_group_id, name, participant_count, is_active")
      .order("name");

    if (error) {
      console.error("Failed to load groups:", error);
      setLoading(false);
      return;
    }

    const groupsWithCount: Group[] = [];
    for (const g of data ?? []) {
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("group_id", g.id);
      groupsWithCount.push({ ...g, message_count: count ?? 0 });
    }

    setGroups(groupsWithCount);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { groups, loading, reload: load };
}

function AddGroupModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { user } = useAuth();
  const [availableGroups, setAvailableGroups] = useState<UazapiGroup[]>([]);
  const [existingIds, setExistingIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setSelected([]);
    setFilter("");
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const res = await fetch("/api/uazapi", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? "Falha ao listar grupos");
        setAvailableGroups(data.groups ?? []);
        setExistingIds(data.existing_ids ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao listar grupos");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, user]);

  const filtered = useMemo(() => {
    const notAdded = availableGroups.filter(
      (g) => !existingIds.includes(g.id)
    );
    const q = filter.trim().toLowerCase();
    if (!q) return notAdded;
    return notAdded.filter((g) => g.name.toLowerCase().includes(q));
  }, [availableGroups, existingIds, filter]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function onSave() {
    if (!user || selected.length === 0) return;
    setSaving(true);
    const groups = selected.map((gId) => {
      const g = availableGroups.find((x) => x.id === gId);
      return {
        id: gId,
        name: g?.name ?? "(sem nome)",
        participantsCount: g?.participantsCount ?? 0,
      };
    });

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch("/api/uazapi", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ groups }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      setError(data?.message ?? "Falha ao salvar grupos");
      setSaving(false);
      return;
    }

    setSaving(false);
    onAdded();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-50">
            Adicionar grupos
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-brand-500/10 hover:text-ink-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-3 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Buscar grupo..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-brand-500/15 bg-black/30">
          {loading && (
            <p className="p-4 text-xs text-ink-400">Carregando grupos...</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="p-4 text-xs text-ink-400">
              {error ?? "Nenhum grupo novo disponível."}
            </p>
          )}
          <ul className="divide-y divide-brand-500/10">
            {filtered.map((g) => {
              const sel = selected.includes(g.id);
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => toggle(g.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-all",
                      sel ? "bg-brand-500/10" : "hover:bg-brand-500/5"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        sel
                          ? "border-brand-400 bg-brand-500/30"
                          : "border-brand-500/30"
                      )}
                    >
                      {sel && (
                        <span className="h-2 w-2 rounded-sm bg-brand-400" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink-50">{g.name}</p>
                      <p className="text-[11px] text-ink-400">
                        {g.participantsCount ?? "?"} participantes
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {error && !loading && (
          <p className="mt-2 text-xs text-danger">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-ink-400">
            {selected.length} selecionado(s)
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={selected.length === 0 || saving}
            >
              <Plus className="h-4 w-4" />
              {saving ? "Adicionando..." : "Adicionar"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function DeleteGroupDialog({
  group,
  onClose,
  onDeleted,
}: {
  group: Group | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!group) return;
    setBusy(true);
    // ON DELETE CASCADE em groups → messages/group_rules/group_participants/
    // summaries/etc são apagados junto. RLS `groups_owner_all` cobre o DELETE.
    const { error } = await supabase.from("groups").delete().eq("id", group.id);
    setBusy(false);
    if (error) {
      toast(`Falha ao excluir: ${error.message}`, "error");
      return;
    }
    toast(`Grupo "${group.name}" removido.`, "success");
    onDeleted();
    onClose();
  }

  if (!group) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-50">
              Excluir grupo monitorado
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-ink-400">
              Você vai remover <span className="font-semibold text-ink-50">{group.name}</span> da
              ferramenta. Mensagens armazenadas, resumos, regras e knowledge base
              vinculados a esse grupo serão apagados — isso não pode ser desfeito.
              O grupo no WhatsApp não é afetado.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-danger/50 bg-danger/15 px-4 text-sm font-medium text-danger transition-all hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? "Excluindo..." : "Excluir grupo"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export function GruposPage() {
  const { groups, loading, reload } = useGroups();
  const [filter, setFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, filter]);

  return (
    <>
      <PageHeader
        title="Grupos"
        subtitle="Gestão dos grupos de WhatsApp monitorados."
      />

      <div className="mb-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Buscar grupo por nome..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-ink-400">Carregando grupos...</p>
        </div>
      )}

      {!loading && groups.length === 0 && (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <Users2 className="h-10 w-10 text-ink-400" />
          <p className="text-sm text-ink-400">
            Nenhum grupo monitorado ainda.
          </p>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Adicionar grupo
          </Button>
        </Card>
      )}

      {!loading && groups.length > 0 && filtered.length === 0 && (
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <Search className="h-8 w-8 text-ink-400" />
          <p className="text-sm text-ink-400">
            Nenhum grupo encontrado para "{filter}".
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((g) => (
          <Link key={g.id} to={`/grupos/${g.id}`}>
            <Card hover className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="truncate text-sm font-semibold text-ink-50">
                  {g.name}
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium uppercase tracking-wider",
                      g.is_active
                        ? "bg-success/10 text-success border border-success/30"
                        : "bg-ink-400/10 text-ink-400 border border-ink-400/20"
                    )}
                  >
                    {g.is_active ? (
                      <>
                        <Power className="h-3 w-3" /> Ativo
                      </>
                    ) : (
                      <>
                        <PowerOff className="h-3 w-3" /> Inativo
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`Excluir grupo ${g.name}`}
                    title="Excluir grupo"
                    onClick={(event) => {
                      // O Card está dentro de <Link>; sem isso o click navega
                      // pra tela do grupo e o modal nem chega a abrir.
                      event.preventDefault();
                      event.stopPropagation();
                      setPendingDelete(g);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-ink-400">
                <span className="flex items-center gap-1">
                  <Users2 className="h-3.5 w-3.5" />
                  {g.participant_count} participantes
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {g.message_count ?? 0} mensagens
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <AddGroupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={reload}
      />

      <DeleteGroupDialog
        group={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={reload}
      />
    </>
  );
}
