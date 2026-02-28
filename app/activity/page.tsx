"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, Filter, Loader2, UserCircle2 } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEntry {
  id: number;
  type: string;
  outcome: string | null;
  note: string | null;
  created_at: string;
  agent_name: string | null;
  customer_name: string | null;
  customer_country: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const TYPE_COLORS: Record<string, string> = {
  Call:   "bg-indigo-500",
  Email:  "bg-cyan-500",
  Note:   "bg-amber-400",
  System: "bg-slate-300",
};

function typeDot(type: string) {
  return TYPE_COLORS[type] ?? "bg-slate-300";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const { user } = useAuth();

  const [region, setRegion]         = useState<string>("all");
  const [entries, setEntries]       = useState<ActivityEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Derive which region options to show based on user's allowed_regions
  const availableRegions = user?.role === "Admin"
    ? ["UK", "EU"]
    : (user?.allowed_regions ?? ["UK", "EU"]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = region !== "all" ? `?region=${region}` : "";
    apiFetch(`/api/activity/agents${params}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.error ?? "Failed"));
        return r.json();
      })
      .then((data: ActivityEntry[]) => {
        setEntries(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((msg: string) => {
        setError(msg);
        setLoading(false);
      });
  }, [region]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Activity Feed</h1>
          <p className="mt-1 text-sm text-slate-500">Recent agent interactions across your regions</p>
        </div>

        {/* Region filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
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
                  {/* Dot */}
                  <span
                    className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white ${typeDot(entry.type)}`}
                  />
                  {/* Content */}
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm text-slate-800">
                      <span className="font-semibold text-slate-900">
                        {entry.agent_name ?? "Unknown agent"}
                      </span>{" "}
                      logged a{" "}
                      <span className="font-semibold text-indigo-600">{entry.type}</span>
                      {entry.customer_name && (
                        <>
                          {" "}with{" "}
                          <span className="font-semibold text-slate-900">{entry.customer_name}</span>
                        </>
                      )}
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

                    <time className="text-[11px] text-slate-400">
                      {timeAgo(entry.created_at)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
