"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, Filter, Loader2, Phone, MessageSquare, FileText, Globe, ChevronDown } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { IndependentDialer } from "@/src/components/IndependentDialer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEntry {
  id:                    number;
  type:                  string;
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
}

type TypeFilter = "all" | "Call" | "SMS" | "Note";

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

const TYPE_COLORS: Record<string, string> = {
  Call:   "bg-indigo-500",
  SMS:    "bg-cyan-500",
  Email:  "bg-cyan-500",
  Note:   "bg-amber-400",
  System: "bg-slate-300",
};

const TYPE_TABS: { key: TypeFilter; label: string; icon: React.ReactNode }[] = [
  { key: "all",  label: "All",   icon: <Activity   size={13} /> },
  { key: "Call", label: "Calls", icon: <Phone       size={13} /> },
  { key: "SMS",  label: "SMS",   icon: <MessageSquare size={13} /> },
  { key: "Note", label: "Notes", icon: <FileText    size={13} /> },
];

const PAGE_SIZE = 50;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const { user } = useAuth();

  const [region, setRegion]         = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [entries, setEntries]       = useState<ActivityEntry[]>([]);
  const [page, setPage]             = useState(1);
  const [hasMore, setHasMore]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [dialerOpen, setDialerOpen] = useState(false);
  const dialerRef = useRef<HTMLDivElement>(null);

  // Derive region options
  const availableRegions = user?.role === "Admin"
    ? ["UK", "EU"]
    : (user?.allowed_regions ?? ["UK", "EU"]);

  function buildUrl(p: number) {
    const params = new URLSearchParams();
    if (region !== "all") params.set("region", region);
    if (typeFilter !== "all") params.set("type", typeFilter);
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(p));
    return `/api/activity/agents?${params.toString()}`;
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
  }, [region, typeFilter]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Activity Feed</h1>
          <p className="mt-1 text-sm text-slate-500">Recent agent interactions across your regions</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Independent Dialer */}
          <div className="relative" ref={dialerRef}>
            <IndependentDialer />
          </div>

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

      {/* Type filter tabs */}
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

      {/* Timeline */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading activity…</span>
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
              {entries.map((entry) => (
                <li key={entry.id} className="mb-6 ml-4 last:mb-0">
                  {/* Timeline dot */}
                  <span
                    className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white ${TYPE_COLORS[entry.type] ?? "bg-slate-300"}`}
                  />

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
                          <span className="font-semibold text-slate-900">{entry.customer_name}</span>
                        </>
                      ) : entry.direction === "inbound" && entry.customer_id === null ? (
                        <>
                          {" "}from{" "}
                          <span className="font-semibold text-slate-500">
                            Unknown Number: {(() => { try { return (JSON.parse(entry.metadata ?? "{}") as { from?: string }).from ?? "—"; } catch { return "—"; } })()}
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

                    {/* Call duration + phone number */}
                    <div className="flex items-center gap-3">
                      {entry.call_duration_seconds != null && entry.call_duration_seconds > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Phone size={10} />
                          {formatDuration(entry.call_duration_seconds)}
                        </span>
                      )}
                      {entry.phone_number && (
                        <span className="text-[11px] text-slate-400">{entry.phone_number}</span>
                      )}
                    </div>

                    <time className="text-[11px] text-slate-400">
                      {timeAgo(entry.created_at)}
                    </time>
                  </div>
                </li>
              ))}
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
    </div>
  );
}

