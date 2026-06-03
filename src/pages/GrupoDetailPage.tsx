import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Users2,
  MessagesSquare,
  Send,
  X as XIcon,
  MessageSquare,
  Power,
  PowerOff,
  Plus,
  Trash2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Zap,
  RefreshCw,
  Clock,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/auth/AuthContext";

type ChatMsg = { role: string; content: string };

type GroupDetail = {
  id: string;
  name: string;
  participant_count: number;
  is_active: boolean;
  whatsapp_group_id: string;
};

type Rule = {
  id: string;
  rule_text: string;
  created_at: string;
};

type Summary = {
  id: string;
  period_type: string;
  period_start: string;
  period_end: string;
  summary_text: string;
  summary_json: Record<string, unknown>;
  message_count: number;
  participant_count: number;
  peak_hour: string;
  avg_response_time_minutes: number;
  sentiment: { positive: number; neutral: number; negative: number };
  sent_to_group: boolean;
  created_at: string;
};

type Discussion = {
  id: string;
  title: string;
  description: string;
  status: "resolved" | "pending";
  message_count: number;
  related_message_ids: string[];
};

type ChatMessage = {
  id: string;
  uazapi_message_id: string | null;
  sender_name: string;
  sender_jid: string;
  text: string | null;
  message_type: string;
  message_timestamp: string;
  quoted_message_id: string | null;
};

type PendingItem = {
  id: string;
  description: string;
  assigned_participant_name: string | null;
};

const SUGGESTED_RULES = [
  "Foque em decisões e encaminhamentos importantes",
  "Destaque perguntas que ficaram sem resposta",
  "Identifique menções a prazos e datas",
  "Priorize tópicos relacionados a vendas",
  "Resuma links e recursos compartilhados",
  "Identifique feedbacks de clientes",
  "Destaque problemas técnicos reportados",
  "Foque em ações que precisam de follow-up",
];

const PERIOD_OPTIONS = [
  { label: "Últimas 6h", value: "6h" },
  { label: "Últimas 12h", value: "12h" },
  { label: "Hoje", value: "today" },
  { label: "Ontem", value: "yesterday" },
];

function useGroupDetail(groupId: string | undefined) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!groupId) return;
    setLoading(true);
    const { data } = await supabase
      .from("groups")
      .select("id, name, participant_count, is_active, whatsapp_group_id")
      .eq("id", groupId)
      .single();
    if (data) {
      setGroup(data);
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("group_id", data.id);
      setMessageCount(count ?? 0);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return { group, messageCount, loading, reload: load };
}

function useRules(groupId: string | undefined) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!groupId) return;
    const { data } = await supabase
      .from("group_rules")
      .select("id, rule_text, created_at")
      .eq("group_id", groupId)
      .order("created_at");
    setRules(data ?? []);
    setLoading(false);
  }

  async function addRule(text: string) {
    if (!groupId) return;
    const { error } = await supabase
      .from("group_rules")
      .insert({ group_id: groupId, rule_text: text });
    if (error) throw error;
    await load();
  }

  async function deleteRule(ruleId: string) {
    const { error } = await supabase
      .from("group_rules")
      .delete()
      .eq("id", ruleId);
    if (error) throw error;
    await load();
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return { rules, loading, addRule, deleteRule };
}

function useSummary(groupId: string | undefined, period: string) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);

    const { data } = await supabase
      .from("summaries")
      .select("*")
      .eq("group_id", groupId)
      .eq("period_type", period)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setSummary(data as Summary);
      const { data: discs } = await supabase
        .from("discussions")
        .select("id, title, description, status, message_count, related_message_ids")
        .eq("summary_id", data.id);
      setDiscussions((discs ?? []) as Discussion[]);

      const { data: pends } = await supabase
        .from("pending_items")
        .select("id, description, assigned_participant_name")
        .eq("summary_id", data.id);
      setPendingItems((pends ?? []) as PendingItem[]);
    } else {
      setSummary(null);
      setDiscussions([]);
      setPendingItems([]);
    }
    setLoading(false);
  }, [groupId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return { summary, discussions, pendingItems, loading, reload: load };
}

function RulesSection({ groupId }: { groupId: string }) {
  const { rules, loading, addRule, deleteRule } = useRules(groupId);
  const [expanded, setExpanded] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(text?: string) {
    const ruleText = (text ?? newRule).trim();
    if (!ruleText) return;
    setSaving(true);
    setError(null);
    try {
      await addRule(ruleText);
      setNewRule("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar regra");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ruleId: string) {
    try {
      await deleteRule(ruleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao deletar regra");
    }
  }

  return (
    <Card>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-ink-50">
            Regras de análise
          </h3>
          <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] text-brand-400">
            {rules.length}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-ink-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-ink-400" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-4">
          {loading && (
            <p className="text-xs text-ink-400">Carregando regras...</p>
          )}
          {!loading && rules.length === 0 && (
            <p className="text-xs text-ink-400">
              Nenhuma regra definida. Adicione regras para personalizar a
              análise deste grupo.
            </p>
          )}
          {rules.length > 0 && (
            <ul className="flex flex-col gap-2">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-brand-500/15 bg-black/20 px-3 py-2"
                >
                  <span className="text-sm text-ink-200">{r.rule_text}</span>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="ml-2 shrink-0 rounded-lg p-1 text-ink-400 hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Nova regra de análise..."
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => handleAdd()}
              disabled={!newRule.trim() || saving}
            >
              <Plus className="h-4 w-4" />
              {saving ? "Salvando..." : "Adicionar"}
            </Button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
              Sugestões
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_RULES.filter(
                (s) => !rules.some((r) => r.rule_text === s)
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => handleAdd(s)}
                  className="rounded-lg border border-brand-500/20 bg-brand-500/5 px-2.5 py-1 text-xs text-ink-300 transition-all hover:border-brand-400/40 hover:bg-brand-500/10 hover:text-ink-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase();
}

function DiscussionCard({
  discussion,
  groupId,
}: {
  discussion: Discussion;
  groupId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  async function loadMessages() {
    if (messages.length > 0 || !discussion.related_message_ids?.length) return;
    setLoadingMsgs(true);
    const { data } = await supabase
      .from("messages")
      .select(
        "id, uazapi_message_id, sender_name, sender_jid, text, message_type, message_timestamp, quoted_message_id"
      )
      .eq("group_id", groupId)
      .in("uazapi_message_id", discussion.related_message_ids)
      .order("message_timestamp", { ascending: true });
    setMessages((data ?? []) as ChatMessage[]);
    setLoadingMsgs(false);
  }

  function toggle() {
    if (!expanded) void loadMessages();
    setExpanded((e) => !e);
  }

  const quotedTextMap = new Map<string, string>();
  for (const m of messages) {
    if (m.uazapi_message_id) {
      quotedTextMap.set(
        m.uazapi_message_id,
        m.text?.slice(0, 80) || "[mídia]"
      );
    }
  }

  return (
    <div className="rounded-xl border border-brand-500/10 bg-black/20 overflow-hidden">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-brand-500/5"
      >
        {discussion.status === "resolved" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 shrink-0 text-yellow-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-100">
            {discussion.title}
          </p>
          <p className="text-xs text-ink-400">{discussion.description}</p>
        </div>
        <span className="shrink-0 text-[10px] text-ink-400">
          {discussion.message_count} msgs
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-ink-400" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-brand-500/10 px-3 py-2">
          {loadingMsgs && (
            <p className="py-2 text-xs text-ink-400">
              Carregando mensagens...
            </p>
          )}
          {!loadingMsgs && messages.length === 0 && (
            <p className="py-2 text-xs text-ink-400">
              Mensagens não encontradas.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {messages.map((m) => {
              const name = m.sender_name || m.sender_jid.split("@")[0];
              const time = new Date(m.message_timestamp).toLocaleTimeString(
                "pt-BR",
                { hour: "2-digit", minute: "2-digit" }
              );
              const quotedText = m.quoted_message_id
                ? quotedTextMap.get(m.quoted_message_id)
                : null;

              return (
                <li key={m.id} className="flex items-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-bold text-brand-400">
                    {getInitials(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-ink-100">
                        {name}
                      </span>
                      <span className="text-[10px] text-ink-400">{time}</span>
                    </div>
                    {quotedText && (
                      <div className="mt-0.5 rounded border-l-2 border-brand-500/40 bg-brand-500/5 px-2 py-0.5 text-[11px] text-ink-400 italic">
                        {quotedText}
                      </div>
                    )}
                    <p className="text-xs text-ink-200">
                      {m.text || `[${m.message_type}]`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function DiscussionsSection({
  discussions,
  groupId,
}: {
  discussions: Discussion[];
  groupId: string;
}) {
  const pendingCount = discussions.filter((d) => d.status === "pending").length;

  if (discussions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-50">
          {discussions.length} discussões · {pendingCount} pendente(s)
        </h3>
      </div>
      {discussions.map((d) => (
        <DiscussionCard key={d.id} discussion={d} groupId={groupId} />
      ))}
    </div>
  );
}

type Schedule = {
  id?: string;
  group_id: string;
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  hour: number;
  day_of_week: number | null;
  day_of_month: number | null;
  send_to_group: boolean;
};

const DAYS_OF_WEEK = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
  { value: 6, label: "Sábado" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function emptySchedule(groupId: string): Schedule {
  return {
    group_id: groupId,
    enabled: true,
    frequency: "daily",
    hour: 9,
    day_of_week: 1,
    day_of_month: 1,
    send_to_group: false,
  };
}

function AutomationModal({
  open,
  onClose,
  groupId,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
}) {
  const [schedule, setSchedule] = useState<Schedule>(() => emptySchedule(groupId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    void supabase
      .from("group_summary_schedules")
      .select("id, group_id, enabled, frequency, hour, day_of_week, day_of_month, send_to_group")
      .eq("group_id", groupId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        if (data) setSchedule(data as Schedule);
        else setSchedule(emptySchedule(groupId));
        setLoading(false);
      });
  }, [open, groupId]);

  async function save() {
    setSaving(true);
    setError(null);
    // Normaliza dados auxiliares: zera os campos da frequência que NÃO é a
    // escolhida (não vão ser usados pelo cron).
    const payload: Schedule = {
      ...schedule,
      day_of_week: schedule.frequency === "weekly" ? (schedule.day_of_week ?? 1) : null,
      day_of_month: schedule.frequency === "monthly" ? (schedule.day_of_month ?? 1) : null,
    };
    const { error: e } = await supabase
      .from("group_summary_schedules")
      .upsert(payload, { onConflict: "group_id" });
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    onClose();
  }

  async function disable() {
    if (!schedule.id) {
      onClose();
      return;
    }
    setSaving(true);
    const { error: e } = await supabase
      .from("group_summary_schedules")
      .delete()
      .eq("id", schedule.id);
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-500/40 bg-brand-500/10 text-brand-400">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-50">
              Automatizar resumo
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-ink-400">
              Gera resumo automático e, opcionalmente, envia no próprio grupo
              do WhatsApp. Horário em Brasília (UTC-3).
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Frequência */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink-400">
                Frequência
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSchedule((s) => ({ ...s, frequency: f }))}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                      schedule.frequency === f
                        ? "border-brand-500/50 bg-brand-500/15 text-brand-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                        : "border-brand-500/15 text-ink-400 hover:border-brand-500/30 hover:text-ink-200"
                    )}
                  >
                    {f === "daily" ? "Diário" : f === "weekly" ? "Semanal" : "Mensal"}
                  </button>
                ))}
              </div>
            </div>

            {/* Dia da semana (weekly) */}
            {schedule.frequency === "weekly" && (
              <div>
                <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink-400">
                  Dia da semana
                </label>
                <select
                  value={schedule.day_of_week ?? 1}
                  onChange={(e) => setSchedule((s) => ({ ...s, day_of_week: Number(e.target.value) }))}
                  className="min-h-11 w-full rounded-lg border border-brand-500/20 bg-black/30 px-3 text-sm text-ink-50 focus:border-brand-500 focus:outline-none"
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Dia do mês (monthly) */}
            {schedule.frequency === "monthly" && (
              <div>
                <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink-400">
                  Dia do mês
                </label>
                <select
                  value={schedule.day_of_month ?? 1}
                  onChange={(e) => setSchedule((s) => ({ ...s, day_of_month: Number(e.target.value) }))}
                  className="min-h-11 w-full rounded-lg border border-brand-500/20 bg-black/30 px-3 text-sm text-ink-50 focus:border-brand-500 focus:outline-none"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>Dia {d}</option>
                  ))}
                </select>
                {schedule.day_of_month && schedule.day_of_month > 28 && (
                  <p className="mt-1 text-[11px] text-ink-400">
                    Em meses sem este dia (ex: 31 em fev), a execução é pulada.
                  </p>
                )}
              </div>
            )}

            {/* Horário */}
            <div>
              <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink-400">
                Horário (Brasília)
              </label>
              <select
                value={schedule.hour}
                onChange={(e) => setSchedule((s) => ({ ...s, hour: Number(e.target.value) }))}
                className="min-h-11 w-full rounded-lg border border-brand-500/20 bg-black/30 px-3 text-sm text-ink-50 focus:border-brand-500 focus:outline-none"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>

            {/* Enviar no grupo */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-brand-500/15 bg-black/20 p-3">
              <input
                type="checkbox"
                checked={schedule.send_to_group}
                onChange={(e) => setSchedule((s) => ({ ...s, send_to_group: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-brand-500"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-100">
                  Enviar resumo no grupo automaticamente
                </p>
                <p className="mt-0.5 text-[12px] text-ink-400">
                  Depois de gerar, envia o resumo formatado direto no WhatsApp
                  via UAZAPI.
                </p>
              </div>
            </label>

            {error && (
              <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2">
          {schedule.id ? (
            <Button variant="ghost" size="sm" onClick={disable} disabled={saving || loading}>
              <Trash2 className="h-4 w-4" />
              Desativar
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AutomationButton({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" />
        Automatizar
      </Button>
      <AutomationModal open={open} onClose={() => setOpen(false)} groupId={groupId} />
    </>
  );
}

function SummarySection({
  groupId,
  period,
}: {
  groupId: string;
  period: string;
}) {
  const { summary, discussions, pendingItems, loading, reload } = useSummary(
    groupId,
    period
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [sendingToGroup, setSendingToGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function sendToGroup(summaryId: string) {
    setSendingToGroup(true);
    setError(null);
    setToast(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-summary-to-group`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({ summary_id: summaryId }),
        }
      );
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
      if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);
      setToast("Resumo enviado para o grupo!");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setSendingToGroup(false);
    }
  }

  async function generateSummary(regenerateId?: string) {
    setAnalyzing(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-summary`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            group_id: groupId,
            period_type: period,
            regenerate_summary_id: regenerateId ?? undefined,
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
      if (!res.ok) {
        throw new Error((data.error as string) || (data.message as string) || `HTTP ${res.status}`);
      }

      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao analisar");
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <MessageSquare className="h-8 w-8 text-ink-400" />
        <p className="text-sm text-ink-400">
          Nenhuma análise disponível para este período.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => generateSummary()} disabled={analyzing}>
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                Analisar
              </>
            )}
          </Button>
          <AutomationButton groupId={groupId} />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </Card>
    );
  }

  const summaryJson = summary.summary_json as Record<string, unknown>;
  const participantesAtivos =
    (summaryJson.participantes_ativos as Array<Record<string, unknown>>) || [];
  const destaques = (summaryJson.destaques as string[]) || [];
  const recursos =
    (summaryJson.recursos_compartilhados as Array<Record<string, unknown>>) ||
    [];
  const insight = (summaryJson.insight_do_dia as string) || "";

  return (
    <div className="flex flex-col gap-4">
      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-400">
          Gerado em{" "}
          {new Date(summary.created_at).toLocaleString("pt-BR")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendToGroup(summary.id)}
            disabled={sendingToGroup || summary.sent_to_group}
          >
            {sendingToGroup ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {summary.sent_to_group ? "Enviado" : "Enviar para grupo"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateSummary(summary.id)}
            disabled={analyzing}
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Regerar
          </Button>
          <Button
            size="sm"
            onClick={() => generateSummary()}
            disabled={analyzing}
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Analisar
          </Button>
          <AutomationButton groupId={groupId} />
        </div>
      </div>

      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
      {toast && (
        <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-2 text-xs text-success">
          {toast}
        </div>
      )}

      {/* Summary text */}
      <Card>
        <h3 className="mb-2 text-sm font-semibold text-ink-50">Resumo</h3>
        <p className="text-sm text-ink-200 leading-relaxed">
          {summary.summary_text}
        </p>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="flex flex-col items-center gap-1 py-3 text-center">
          <MessageSquare className="h-4 w-4 text-brand-400" />
          <span className="text-lg font-bold text-ink-50">
            {summary.message_count}
          </span>
          <span className="text-[10px] text-ink-400">Mensagens</span>
        </Card>
        <Card className="flex flex-col items-center gap-1 py-3 text-center">
          <Users2 className="h-4 w-4 text-brand-400" />
          <span className="text-lg font-bold text-ink-50">
            {summary.participant_count}
          </span>
          <span className="text-[10px] text-ink-400">Participantes</span>
        </Card>
        <Card className="flex flex-col items-center gap-1 py-3 text-center">
          <TrendingUp className="h-4 w-4 text-brand-400" />
          <span className="text-lg font-bold text-ink-50">
            {summary.peak_hour}
          </span>
          <span className="text-[10px] text-ink-400">Pico</span>
        </Card>
        <Card className="flex flex-col items-center gap-1 py-3 text-center">
          <Clock className="h-4 w-4 text-brand-400" />
          <span className="text-lg font-bold text-ink-50">
            {summary.avg_response_time_minutes}min
          </span>
          <span className="text-[10px] text-ink-400">Resp. média</span>
        </Card>
      </div>

      {/* Sentiment */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-ink-50">Sentimento</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-400">Positivo</span>
            <div className="flex-1 h-3 rounded-full bg-black/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${summary.sentiment.positive}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs text-ink-300">
              {summary.sentiment.positive}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-400">Neutro</span>
            <div className="flex-1 h-3 rounded-full bg-black/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-ink-400"
                style={{ width: `${summary.sentiment.neutral}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs text-ink-300">
              {summary.sentiment.neutral}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-400">Negativo</span>
            <div className="flex-1 h-3 rounded-full bg-black/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-danger"
                style={{ width: `${summary.sentiment.negative}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs text-ink-300">
              {summary.sentiment.negative}%
            </span>
          </div>
        </div>
      </Card>

      {/* Discussions */}
      <DiscussionsSection
        discussions={discussions}
        groupId={groupId}
      />

      {/* Top contributors */}
      {participantesAtivos.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-ink-50">
            Top contribuidores
          </h3>
          <ul className="flex flex-col gap-2">
            {participantesAtivos.slice(0, 10).map((p, i) => (
              <li
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="text-ink-200">
                    {(p.nome as string) || (p.jid as string)}
                  </span>
                  {!!p.badge && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                        String(p.badge) === "mentor" &&
                          "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
                        String(p.badge) === "super_engajado" &&
                          "bg-orange-500/15 text-orange-400 border border-orange-500/30",
                        String(p.badge) === "engajado" &&
                          "bg-brand-500/15 text-brand-400 border border-brand-500/30"
                      )}
                    >
                      {String(p.badge) === "mentor"
                        ? "Mentor"
                        : String(p.badge) === "super_engajado"
                          ? "Super Engajado"
                          : "Engajado"}
                    </span>
                  )}
                </div>
                <span className="text-xs text-ink-400">
                  {Number(p.mensagens)} msgs
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pending items */}
      {pendingItems.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-ink-50">
            Pendências
          </h3>
          <ul className="flex flex-col gap-2">
            {pendingItems.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2 text-sm text-ink-200"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" />
                <div>
                  <span>{p.description}</span>
                  {p.assigned_participant_name && (
                    <span className="ml-1 text-xs text-ink-400">
                      — {p.assigned_participant_name}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Highlights */}
      {destaques.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-ink-50">
            Destaques
          </h3>
          <ul className="flex flex-col gap-1">
            {destaques.map((d, i) => (
              <li key={i} className="text-sm text-ink-200">
                • {d}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Insight */}
      {insight && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-ink-50">
            Insight do dia
          </h3>
          <p className="text-sm text-ink-200 italic">{insight}</p>
        </Card>
      )}

      {/* Shared resources */}
      {recursos.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-ink-50">
            Recursos compartilhados
          </h3>
          <ul className="flex flex-col gap-1">
            {recursos.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="text-ink-200">
                  {String(r.titulo || "")}
                </span>
                {!!r.url && (
                  <a
                    href={String(r.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-brand-400 hover:underline"
                  >
                    {String(r.url)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ChatDrawer({
  open,
  onClose,
  groupId,
  groupName,
  period,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  period: string;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadedSession, setLoadedSession] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !user || loadedSession) return;
    supabase
      .from("chat_sessions")
      .select("id, messages")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSessionId(data.id);
          setMessages((data.messages as ChatMsg[]) || []);
        }
        setLoadedSession(true);
      });
  }, [open, user, groupId, loadedSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || !user || sending) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setSending(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-with-context`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({
            group_id: groupId,
            user_id: user.id,
            message: userMsg,
            session_id: sessionId,
            period_type: period,
          }),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              assistantText += parsed.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantText,
                };
                return updated;
              });
            }
            if (parsed.session_id) {
              setSessionId(parsed.session_id);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Erro: ${e instanceof Error ? e.message : "Falha na requisição"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col border-l border-brand-500/20 bg-[#0c0c14]/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-brand-500/15 px-4 py-3">
          <div className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4 text-brand-400" />
            <span className="text-sm font-semibold text-ink-50">
              Chat — {groupName}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-brand-500/10 hover:text-ink-50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <p className="py-10 text-center text-xs text-ink-400">
              Pergunte algo sobre as conversas do grupo.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  m.role === "user"
                    ? "ml-auto bg-brand-500/20 text-ink-100"
                    : "mr-auto bg-black/40 text-ink-200 border border-brand-500/10"
                )}
              >
                <p className="whitespace-pre-wrap">{m.content || "..."}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-brand-500/15 px-4 py-3">
          <div className="flex gap-2">
            <Input
              placeholder="Pergunte sobre o grupo..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="flex-1"
              disabled={sending}
            />
            <Button
              size="icon"
              onClick={() => void send()}
              disabled={!input.trim() || sending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GrupoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { group, messageCount, loading, reload } = useGroupDetail(id);
  const [period, setPeriod] = useState("today");
  const [toggling, setToggling] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  async function toggleActive() {
    if (!group) return;
    setToggling(true);
    await supabase
      .from("groups")
      .update({
        is_active: !group.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", group.id);
    await reload();
    setToggling(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-ink-400">Carregando...</p>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-sm text-ink-400">Grupo não encontrado.</p>
        <Button variant="ghost" size="sm" onClick={() => navigate("/grupos")}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          onClick={() => navigate("/grupos")}
          className="mb-4 flex items-center gap-1 text-sm text-ink-400 transition-colors hover:text-ink-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para grupos
        </button>

        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-ink-50">{group.name}</h1>
            <div className="flex items-center gap-4 text-xs text-ink-400">
              <span className="flex items-center gap-1">
                <Users2 className="h-3.5 w-3.5" />
                {group.participant_count} participantes
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {messageCount} mensagens
              </span>
            </div>
          </div>
          <Button
            variant={group.is_active ? "outline" : "brand"}
            size="sm"
            onClick={toggleActive}
            disabled={toggling}
          >
            {group.is_active ? (
              <>
                <PowerOff className="h-4 w-4" />
                {toggling ? "Desativando..." : "Desativar"}
              </>
            ) : (
              <>
                <Power className="h-4 w-4" />
                {toggling ? "Ativando..." : "Ativar"}
              </>
            )}
          </Button>
        </Card>
      </div>

      {/* Period filters + Chat button */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPeriod(opt.value)}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-medium transition-all",
              period === opt.value
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/40 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                : "border border-brand-500/15 text-ink-400 hover:border-brand-500/30 hover:text-ink-200"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Chat button */}
      <div className="flex justify-end -mt-2">
        <Button variant="outline" size="sm" onClick={() => setChatOpen(true)}>
          <MessagesSquare className="h-4 w-4" />
          Chat com contexto
        </Button>
      </div>

      {/* Summary + Analysis */}
      <SummarySection groupId={group.id} period={period} />

      {/* Rules */}
      <RulesSection groupId={group.id} />

      {/* Chat Drawer */}
      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        groupId={group.id}
        groupName={group.name}
        period={period}
      />
    </div>
  );
}
