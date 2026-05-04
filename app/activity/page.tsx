"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, Loader2, Phone, MessageSquare, FileText, Globe, ChevronDown, PlayCircle, User, CalendarDays, BarChart3, Rows3, ClipboardList, CheckSquare, MessageCircle } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { IndependentDialer } from "@/src/components/IndependentDialer";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivitySource = "interaction" | "task_created" | "task_closed" | "task_comment";

interface ActivityEntry {
  id:                    number;
  source:                ActivitySource;
  type:                  string | null;
  outcome:               string | null;
  note:                  string | null;
  created_at:            string;
  call_duration_seconds: number | null;
  phone_number:          string | null;
  agent_name:            string | null;
  customer_name:         string | null;
  customer_country:      string | null;
  direction:             string | null;
  metadata:              string | null;
  customer_id:           string | null;
  recording_url:         string | null;
  task_id:               number | null;
  task_title:            string | null;
}

interface AgentOption {
  id: number;
  name: string;
}

interface ActivityReportRow {
  day: string;
  first_activity: string | null;
  last_activity: string | null;
  wall_clock_span: string | null;
  active_working_time: string | null;
  total_activities: number;
  calls: number;
  sms: number;
  notes: number;
  emails: number;
  tasks_created: number;
  tasks_closed: number;
  task_comments: number;
  unique_customers: number;
  total_call_time: string | null;
  connected_calls: number;
  no_answer_calls: number;
  session_breaks: number;
  agent_id: number;
  agent_name: string | null;
}

type TypeFilter = "all" | "Call" | "SMS" | "Note";
type ActivityView = "feed" | "report";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins} min ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDate(now),
  };
}

function formatReportDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateStr
    : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const TYPE_COLORS: Record<string, string> = {
  Call:   "bg-indigo-500",
  SMS:    "bg-cyan-500",
  Email:  "bg-cyan-500",
  Note:   "bg-amber-400",
  System: "bg-slate-300",
};

const SOURCE_DOT_COLOR: Record<ActivitySource, string> = {
  interaction:   "bg-slate-300",
  task_created:  "bg-sky-500",
  task_closed:   "bg-teal-500",
  task_comment:  "bg-amber-500",
};

const TYPE_TABS: { key: TypeFilter; label: string; icon: React.ReactNode }[] = [
  { key: "all",  label: "All",   icon: <Activity   size={13} /> },
  { key: "Call", label: "Calls", icon: <Phone       size={13} /> },
  { key: "SMS",  label: "SMS",   icon: <MessageSquare size={13} /> },
  { key: "Note", label: "Notes", icon: <FileText    size={13} /> },
];

const VIEW_TABS: { key: ActivityView; label: string; icon: React.ReactNode }[] = [
  { key: "feed", label: "Feed", icon: <Rows3 size={13} /> },
  { key: "report", label: "Daily Report", icon: <BarChart3 size={13} /> },
];

const PAGE_SIZE = 50;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();

  // Hydrate type filter from URL ?type= param (e.g. linked from dashboard pills)
  const initialType = (() => {
    const t = searchParams.get("type");
    if (t === "Call" || t === "SMS" || t === "Note") return t;
    return "all" as TypeFilter;
  })();

  const initialView = searchParams.get("view") === "report" ? "report" : "feed";

  const [region, setRegion]         = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(initialType);
  const [activeView, setActiveView] = useState<ActivityView>(initialView);
  const [agentId, setAgentId]       = useState<string>("");
  const [dateFrom, setDateFrom]     = useState<string>("");
  const [dateTo, setDateTo]         = useState<string>("");
  const [agents, setAgents]         = useState<AgentOption[]>([]);
  const [entries, setEntries]       = useState<ActivityEntry[]>([]);
  const [reportRows, setReportRows] = useState<ActivityReportRow[]>([]);
  const [page, setPage]             = useState(1);
  const [hasMore, setHasMore]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [dialerOpen, setDialerOpen] = useState(false);
  const dialerRef = useRef<HTMLDivElement>(null);
  const reportDefaultsAppliedRef = useRef(false);

  // Derive region options
  const availableRegions = user?.role === "Admin"
    ? ["UK", "EU"]
    : (user?.allowed_regions ?? ["UK", "EU"]);

  // Load agent list for filter (admin sees all, non-admin sees only themselves)
  useEffect(() => {
    if (user?.role === "Admin") {
      apiFetch("/api/users")
        .then((r) => r.json())
        .then((data: { id: number; name: string; is_active: number }[]) => {
          if (Array.isArray(data)) {
            setAgents(data.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name })));
          }
        })
        .catch(() => {});
    }
  }, [user?.role]);

  function buildUrl(p: number) {
    const params = new URLSearchParams();
    if (region !== "all") params.set("region", region);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (agentId) params.set("agentId", agentId);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(p));
    return `/api/activity/agents?${params.toString()}`;
  }

  const reportAgentId = user?.role === "Admin" ? agentId : String(user?.id ?? "");

  function buildReportUrl() {
    if (user?.role === "Admin" && !reportAgentId) return null;

    const params = new URLSearchParams();
    if (region !== "all") params.set("region", region);
    if (reportAgentId) params.set("agentId", reportAgentId);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    return `/api/activity/report?${params.toString()}`;
  }

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setPage(1);
    apiFetch(buildUrl(1))
      .then((r) => {
        if (!r.ok) return r.json().then((d: { error?: string }) => Promise.reject(d.error ?? "Failed"));
        return r.json();
      })
      .then((data: ActivityEntry[]) => {
        const rows = Array.isArray(data) ? data : [];
        setEntries(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setLoading(false);
      })
      .catch((msg: string) => {
        setError(msg);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, typeFilter, agentId, dateFrom, dateTo]);

  useEffect(() => {
    if (activeView !== "feed") return;
    load();
  }, [activeView, load]);

  const loadReport = useCallback(() => {
    const url = buildReportUrl();

    if (!url) {
      setReportRows([]);
      setReportError(null);
      setReportLoading(false);
      return;
    }

    setReportLoading(true);
    setReportError(null);

    apiFetch(url)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error((data as { error?: string }).error ?? "Failed to load report");
        }
        return data as ActivityReportRow[];
      })
      .then((data) => {
        setReportRows(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        setReportRows([]);
        setReportError(err.message);
      })
      .finally(() => setReportLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, reportAgentId, dateFrom, dateTo, user?.role]);

  useEffect(() => {
    if (activeView !== "report") return;

    if (!reportDefaultsAppliedRef.current && !dateFrom && !dateTo) {
      const range = currentMonthRange();
      reportDefaultsAppliedRef.current = true;
      setDateFrom(range.from);
      setDateTo(range.to);
      return;
    }

    loadReport();
  }, [activeView, dateFrom, dateTo, loadReport]);

  function loadMore() {
    const nextPage = page + 1;
    setLoadingMore(true);
    apiFetch(buildUrl(nextPage))
      .then((r) => r.json())
      .then((data: ActivityEntry[]) => {
        const rows = Array.isArray(data) ? data : [];
        setEntries((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
        setPage(nextPage);
      })
      .catch(() => {/* silently fail on load-more */})
      .finally(() => setLoadingMore(false));
  }

  function clearDates() {
    if (activeView === "report") {
      const range = currentMonthRange();
      setDateFrom(range.from);
      setDateTo(range.to);
      return;
    }

    setDateFrom("");
    setDateTo("");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {activeView === "report" ? "Activity Report" : "Activity Feed"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeView === "report"
              ? "Daily agent activity summary with gap-based active time"
              : "Recent agent interactions across your regions"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Independent Dialer */}
          <div className="relative" ref={dialerRef}>
            <IndependentDialer />
          </div>

          {/* Agent filter (admin only) */}
          {user?.role === "Admin" && agents.length > 0 && (
            <div className="flex items-center gap-1.5">
              <User className="h-4 w-4 text-slate-400" />
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">{activeView === "report" ? "Select Agent" : "All Agents"}</option>
                {agents.map((a) => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* My Activity toggle (non-admin) */}
          {user?.role !== "Admin" && activeView === "feed" && (
            <button
              onClick={() => setAgentId(agentId ? "" : String(user?.id ?? ""))}
              className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition ${
                agentId
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {agentId ? "My Activity" : "All Activity"}
            </button>
          )}

          {user?.role !== "Admin" && activeView === "report" && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 shadow-sm">
              Agent: {user?.name ?? "You"}
            </div>
          )}

          {/* Region filter */}
          <div className="flex items-center gap-1.5">
            <Globe className="h-4 w-4 text-slate-400" />
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">All Regions</option>
              {availableRegions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* View tabs + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm w-fit">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeView === tab.key
                  ? "bg-slate-900 text-white shadow"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeView === "feed" && (
        <div className="flex gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm w-fit">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTypeFilter(tab.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                typeFilter === tab.key
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        )}

        {/* Date range filters */}
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={clearDates}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {activeView === "feed" ? (
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading activity...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-semibold text-rose-500">{error}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Activity className="h-8 w-8 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">No activity yet</p>
            <p className="text-xs text-slate-400">Interactions logged by agents will appear here</p>
          </div>
        ) : (
          <div className="px-5 py-4">
            <ol className="relative border-l border-slate-100">
              {entries.map((entry) => {
                const dotColor =
                  entry.source && entry.source !== "interaction"
                    ? SOURCE_DOT_COLOR[entry.source]
                    : (TYPE_COLORS[entry.type ?? ""] ?? "bg-slate-300");
                const isTaskEvent = entry.source && entry.source !== "interaction";
                const taskKey = `${entry.source}-${entry.id}`;
                return (
                <li key={isTaskEvent ? taskKey : entry.id} className="mb-6 ml-4 last:mb-0">
                  {/* Timeline dot */}
                  <span
                    className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white ${dotColor}`}
                  />

                  {isTaskEvent ? (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm text-slate-800">
                        <span className="font-semibold text-slate-900">
                          {entry.agent_name ?? "Unknown agent"}
                        </span>{" "}
                        {entry.source === "task_created" && (
                          <>
                            <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                              <ClipboardList size={12} /> created a task
                            </span>
                          </>
                        )}
                        {entry.source === "task_closed" && (
                          <>
                            <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                              <CheckSquare size={12} /> closed a task
                            </span>
                          </>
                        )}
                        {entry.source === "task_comment" && (
                          <>
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                              <MessageCircle size={12} /> commented on a task
                            </span>
                          </>
                        )}
                        {entry.customer_name && (
                          <>
                            {" "}for{" "}
                            {entry.customer_id ? (
                              <Link href={`/customer/${entry.customer_id}`} className="font-semibold text-indigo-700 hover:underline">
                                {entry.customer_name}
                              </Link>
                            ) : (
                              <span className="font-semibold text-slate-900">{entry.customer_name}</span>
                            )}
                          </>
                        )}
                        {entry.customer_country && (
                          <span className="ml-1 text-xs text-slate-400">
                            ({entry.customer_country})
                          </span>
                        )}
                      </p>

                      {(entry.task_title || entry.note) && (
                        <p className="text-xs text-slate-500 line-clamp-2">
                          {entry.task_id && (
                            <Link href={`/to-do?taskId=${entry.task_id}`} className="font-medium text-slate-600 hover:underline">
                              #{entry.task_id}
                            </Link>
                          )}
                          {entry.task_title && (
                            <span className="font-medium text-slate-600"> {entry.task_title}</span>
                          )}
                          {entry.source === "task_comment" && entry.note && (
                            <span className="text-slate-500"> — {entry.note}</span>
                          )}
                        </p>
                      )}

                      <time className="text-[11px] text-slate-400">
                        {timeAgo(entry.created_at)}
                      </time>
                    </div>
                  ) : (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm text-slate-800">
                      <span className="font-semibold text-slate-900">
                        {entry.agent_name ?? (entry.direction === "inbound" ? "Customer" : "Unknown agent")}
                      </span>{" "}
                      {entry.direction === "inbound" && entry.type === "SMS" ? "sent an inbound " : "logged a "}
                      <span className="font-semibold text-indigo-600">{entry.type}</span>
                      {entry.customer_name ? (
                        <>
                          {" "}with{" "}
                          {entry.customer_id ? (
                            <Link href={`/customer/${entry.customer_id}`} className="font-semibold text-indigo-700 hover:underline">
                              {entry.customer_name}
                            </Link>
                          ) : (
                            <span className="font-semibold text-slate-900">{entry.customer_name}</span>
                          )}
                        </>
                      ) : entry.direction === "inbound" && entry.customer_id === null ? (
                        <>
                          {" "}from{" "}
                          <span className="font-semibold text-slate-500">
                            Unknown Number: {(() => { try { return (JSON.parse(entry.metadata ?? "{}") as { from?: string }).from ?? "-"; } catch { return "-"; } })()}
                          </span>
                        </>
                      ) : null}
                      {entry.customer_country && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({entry.customer_country})
                        </span>
                      )}
                    </p>

                    {/* Outcome / note excerpt */}
                    {(entry.outcome || entry.note) && (
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {entry.outcome && (
                          <span className="font-medium text-slate-600">{entry.outcome}: </span>
                        )}
                        {entry.note}
                      </p>
                    )}

                    {/* Call duration + phone + recording */}
                    <div className="flex flex-wrap items-center gap-3">
                      {entry.call_duration_seconds != null && entry.call_duration_seconds > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Phone size={10} />
                          {formatDuration(entry.call_duration_seconds)}
                        </span>
                      )}
                      {entry.phone_number && (
                        <span className="text-[11px] text-slate-400">{entry.phone_number}</span>
                      )}
                      {entry.recording_url && (
                        <a
                          href={entry.recording_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          <PlayCircle size={12} />
                          Play Recording
                        </a>
                      )}
                    </div>

                    <time className="text-[11px] text-slate-400">
                      {timeAgo(entry.created_at)}
                    </time>
                  </div>
                  )}
                </li>
                );
              })}
            </ol>

            {/* Load More */}
            {hasMore && (
              <div className="mt-4 flex justify-center border-t border-slate-100 pt-4">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          {user?.role === "Admin" && !reportAgentId ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <BarChart3 className="h-8 w-8 text-slate-200" />
              <p className="text-sm font-semibold text-slate-500">Select an agent to view the report</p>
              <p className="text-xs text-slate-400">The daily activity summary is generated for one agent at a time.</p>
            </div>
          ) : reportLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading report...</span>
            </div>
          ) : reportError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-semibold text-rose-500">{reportError}</p>
            </div>
          ) : reportRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <BarChart3 className="h-8 w-8 text-slate-200" />
              <p className="text-sm font-semibold text-slate-500">No activity report rows found</p>
              <p className="text-xs text-slate-400">Try a different date range or agent selection.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-left font-semibold">First</th>
                    <th className="px-4 py-3 text-left font-semibold">Last</th>
                    <th className="px-4 py-3 text-left font-semibold">Span</th>
                    <th className="px-4 py-3 text-left font-semibold">Active</th>
                    <th className="px-4 py-3 text-right font-semibold">Activities</th>
                    <th className="px-4 py-3 text-right font-semibold">Calls</th>
                    <th className="px-4 py-3 text-right font-semibold">SMS</th>
                    <th className="px-4 py-3 text-right font-semibold">Notes</th>
                    <th className="px-4 py-3 text-right font-semibold">Emails</th>
                    <th className="px-4 py-3 text-right font-semibold">Tasks +</th>
                    <th className="px-4 py-3 text-right font-semibold">Tasks ✓</th>
                    <th className="px-4 py-3 text-right font-semibold">Comments</th>
                    <th className="px-4 py-3 text-right font-semibold">Customers</th>
                    <th className="px-4 py-3 text-left font-semibold">Call Time</th>
                    <th className="px-4 py-3 text-right font-semibold">Connected</th>
                    <th className="px-4 py-3 text-right font-semibold">No Answer</th>
                    <th className="px-4 py-3 text-right font-semibold">Breaks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                  {reportRows.map((row) => (
                    <tr key={row.day} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{formatReportDate(row.day)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.first_activity ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.last_activity ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.wall_clock_span ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-indigo-700">{row.active_working_time ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{row.total_activities.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.calls.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.sms.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.notes.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.emails.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sky-700">{row.tasks_created.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-teal-700">{row.tasks_closed.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-amber-700">{row.task_comments.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.unique_customers.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.total_call_time ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.connected_calls.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.no_answer_calls.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{row.session_breaks.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

