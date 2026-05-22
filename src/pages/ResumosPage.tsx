import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Users2,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Crown,
  Flame,
  Link as LinkIcon,
  Lightbulb,
  BarChart3,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/pages/placeholder";

type Group = { id: string; name: string };

type Summary = {
  id: string;
  group_id: string;
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
  created_at: string;
};

type Discussion = {
  id: string;
  title: string;
  description: string;
  status: "resolved" | "pending";
  message_count: number;
};

type PendingItem = {
  id: string;
  description: string;
  assigned_participant_name: string | null;
};

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDateBR(date: Date): string {
  const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${days[date.getDay()]}, ${d}/${m}/${date.getFullYear()}`;
}

function useGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("groups")
      .select("id, name")
      .order("name")
      .then(({ data }) => setGroups(data ?? []));
  }, [user]);

  return groups;
}

function useSummaryForDate(groupId: string | null, date: string) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) {
      setSummary(null);
      return;
    }
    setLoading(true);

    const dayStart = `${date}T00:00:00-03:00`;
    const dayEnd = `${date}T23:59:59-03:00`;

    const { data } = await supabase
      .from("summaries")
      .select("*")
      .eq("group_id", groupId)
      .gte("period_start", dayStart)
      .lte("period_start", dayEnd)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setSummary(data as Summary);
      const { data: discs } = await supabase
        .from("discussions")
        .select("id, title, description, status, message_count")
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
  }, [groupId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  return { summary, discussions, pendingItems, loading };
}

function useActivityByHour(groupId: string | null, date: string) {
  const [activity, setActivity] = useState<number[]>(new Array(24).fill(0));

  useEffect(() => {
    if (!groupId) return;
    const dayStart = `${date}T00:00:00-03:00`;
    const dayEnd = `${date}T23:59:59-03:00`;

    supabase
      .from("messages")
      .select("message_timestamp")
      .eq("group_id", groupId)
      .gte("message_timestamp", dayStart)
      .lte("message_timestamp", dayEnd)
      .then(({ data }) => {
        const counts = new Array(24).fill(0);
        for (const m of data ?? []) {
          const h = new Date(m.message_timestamp).getHours();
          counts[h]++;
        }
        setActivity(counts);
      });
  }, [groupId, date]);

  return activity;
}

function MetricCard({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-1 py-3 text-center">
      <Icon className="h-4 w-4 text-brand-400" />
      <span className="text-lg font-bold text-ink-50">{value}</span>
      <span className="text-[10px] text-ink-400">{label}</span>
    </Card>
  );
}

function SentimentBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-ink-400">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-black/30">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs text-ink-300">{value}%</span>
    </div>
  );
}

function ActivityChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-ink-50">
          Atividade por hora
        </h3>
      </div>
      <div className="flex items-end gap-[3px] h-32">
        {data.map((count, h) => (
          <div
            key={h}
            className="group relative flex-1 flex flex-col items-center justify-end"
          >
            <div
              className="w-full rounded-t bg-brand-500/60 transition-all hover:bg-brand-400/80"
              style={{
                height: `${Math.max((count / max) * 100, count > 0 ? 4 : 0)}%`,
                minHeight: count > 0 ? "3px" : "0",
              }}
            />
            <div className="absolute -top-6 hidden rounded bg-black/80 px-1.5 py-0.5 text-[9px] text-ink-200 group-hover:block">
              {count}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex">
        {[0, 6, 12, 18, 23].map((h) => (
          <span
            key={h}
            className="text-[9px] text-ink-400"
            style={{
              position: "relative",
              left: `${(h / 23) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            {h}h
          </span>
        ))}
      </div>
    </Card>
  );
}

function BadgeIcon({ badge }: { badge: string }) {
  if (badge === "mentor")
    return <Crown className="h-3 w-3 text-yellow-400" />;
  if (badge === "super_engajado")
    return <Flame className="h-3 w-3 text-orange-400" />;
  if (badge === "engajado")
    return <Flame className="h-3 w-3 text-brand-400" />;
  return null;
}

function badgeLabel(badge: string): string {
  if (badge === "mentor") return "Mentor";
  if (badge === "super_engajado") return "Super Engajado";
  if (badge === "engajado") return "Engajado";
  return "";
}

function badgeClasses(badge: string): string {
  if (badge === "mentor")
    return "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30";
  if (badge === "super_engajado")
    return "bg-orange-500/15 text-orange-400 border border-orange-500/30";
  if (badge === "engajado")
    return "bg-brand-500/15 text-brand-400 border border-brand-500/30";
  return "";
}

export function ResumosPage() {
  const groups = useGroups();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [date, setDate] = useState(() => formatDate(new Date()));

  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0].id);
    }
  }, [groups, selectedGroup]);

  const { summary, discussions, pendingItems, loading } = useSummaryForDate(
    selectedGroup,
    date
  );
  const activity = useActivityByHour(selectedGroup, date);

  const summaryJson = summary?.summary_json ?? {};
  const participantesAtivos =
    (summaryJson.participantes_ativos as Array<Record<string, unknown>>) ?? [];
  const destaques = (summaryJson.destaques as string[]) ?? [];
  const recursos =
    (summaryJson.recursos_compartilhados as Array<Record<string, unknown>>) ??
    [];
  const insight = (summaryJson.insight_do_dia as string) ?? "";

  const resolvedCount = discussions.filter((d) => d.status === "resolved").length;
  const totalDiscussions = discussions.length;
  const resolutionPct =
    totalDiscussions > 0 ? Math.round((resolvedCount / totalDiscussions) * 100) : 0;

  function shiftDate(days: number) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    setDate(formatDate(d));
  }

  const displayDate = useMemo(() => {
    const d = new Date(date + "T12:00:00");
    return formatDateBR(d);
  }, [date]);

  return (
    <>
      <PageHeader
        title="Resumos"
        subtitle="Resumos diários dos grupos com análise de IA."
      />

      {/* Controls: group selector + date nav */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <select
          value={selectedGroup ?? ""}
          onChange={(e) => setSelectedGroup(e.target.value || null)}
          className="input-base h-10 rounded-xl px-3 text-sm"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-brand-500/10 hover:text-ink-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-ink-200">
            <Calendar className="h-4 w-4 text-brand-400" />
            {displayDate}
          </div>
          <button
            onClick={() => shiftDate(1)}
            className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-brand-500/10 hover:text-ink-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-ink-400">Carregando resumo...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !summary && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <MessageSquare className="h-10 w-10 text-ink-400" />
          <p className="text-sm text-ink-300">
            Nenhum resumo disponível para esta data.
          </p>
          <p className="text-xs text-ink-400">
            Gere uma análise na página do grupo ou aguarde o resumo automático.
          </p>
        </Card>
      )}

      {/* Summary content */}
      {!loading && summary && (
        <div className="flex flex-col gap-4">
          {/* Summary text */}
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-ink-50">
              Resumo geral
            </h3>
            <p className="text-sm leading-relaxed text-ink-200">
              {summary.summary_text}
            </p>
          </Card>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              icon={MessageSquare}
              value={summary.message_count}
              label="Mensagens"
            />
            <MetricCard
              icon={Users2}
              value={summary.participant_count}
              label="Participantes"
            />
            <MetricCard
              icon={TrendingUp}
              value={summary.peak_hour}
              label="Pico"
            />
            <MetricCard
              icon={Clock}
              value={`${summary.avg_response_time_minutes}min`}
              label="Resp. média"
            />
          </div>

          {/* Resolution rate */}
          {totalDiscussions > 0 && (
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-50">
                  Resolução de dúvidas
                </h3>
                <span className="text-xs text-ink-400">
                  {resolvedCount}/{totalDiscussions} resolvidas
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${resolutionPct}%` }}
                />
              </div>
              <p className="mt-1 text-right text-xs text-ink-400">
                {resolutionPct}%
              </p>
            </Card>
          )}

          {/* Sentiment */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-ink-50">
              Sentimento
            </h3>
            <div className="flex flex-col gap-2">
              <SentimentBar
                label="Positivo"
                value={summary.sentiment.positive}
                color="bg-success"
              />
              <SentimentBar
                label="Neutro"
                value={summary.sentiment.neutral}
                color="bg-ink-400"
              />
              <SentimentBar
                label="Negativo"
                value={summary.sentiment.negative}
                color="bg-danger"
              />
            </div>
          </Card>

          {/* Activity chart */}
          <ActivityChart data={activity} />

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
                        {String(p.nome || p.jid || "")}
                      </span>
                      {!!p.badge && (
                        <span
                          className={cn(
                            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                            badgeClasses(String(p.badge))
                          )}
                        >
                          <BadgeIcon badge={String(p.badge)} />
                          {badgeLabel(String(p.badge))}
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

          {/* Topics / Discussions */}
          {discussions.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink-50">
                Tópicos discutidos
              </h3>
              <ul className="flex flex-col gap-2">
                {discussions.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start gap-2 rounded-xl border border-brand-500/10 bg-black/20 px-3 py-2"
                  >
                    {d.status === "resolved" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-100">
                        {d.title}
                      </p>
                      <p className="text-xs text-ink-400">{d.description}</p>
                      <span className="text-[10px] text-ink-400">
                        {d.message_count} mensagens
                      </span>
                    </div>
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
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-brand-400" />
                <h3 className="text-sm font-semibold text-ink-50">
                  Destaques
                </h3>
              </div>
              <ul className="flex flex-col gap-1">
                {destaques.map((d, i) => (
                  <li key={i} className="text-sm text-ink-200">
                    • {d}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Shared resources */}
          {recursos.length > 0 && (
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-brand-400" />
                <h3 className="text-sm font-semibold text-ink-50">
                  Recursos compartilhados
                </h3>
              </div>
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

          {/* Insight */}
          {insight && (
            <Card>
              <div className="mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-400" />
                <h3 className="text-sm font-semibold text-ink-50">
                  Insight do dia
                </h3>
              </div>
              <p className="text-sm italic text-ink-200">{insight}</p>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
