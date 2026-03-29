"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/apiFetch";
import {
  Activity,
  UserCheck,
  DollarSign,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ─── types ────────────────────────────────────────────────────────────────────

interface Summary {
  totalActivities:     number;
  kycConversions:      number;
  transferConversions: number;
}

interface AgentRow {
  agentId:             number;
  agentName:           string;
  totalActivities:     number;
  kycConversions:      number;
  transferConversions: number;
}

// ─── date-range helpers ───────────────────────────────────────────────────────

type Preset = "today" | "7d" | "month";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset: Preset): { startDate: string; endDate: string } {
  const now   = new Date();
  const today = isoDate(now);

  if (preset === "today") return { startDate: today, endDate: today };

  if (preset === "7d") {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return { startDate: isoDate(start), endDate: today };
  }

  // "month" - current calendar month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: isoDate(start), endDate: today };
}

// ─── metric card ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  label:     string;
  value:     number | undefined;
  loading:   boolean;
  icon:      React.ReactNode;
  colorClass: string;   // Tailwind bg colour for icon wrapper
  textClass:  string;   // Tailwind text colour for value
}

function MetricCard({ label, value, loading, icon, colorClass, textClass }: MetricCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${colorClass}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        {loading ? (
          <div className="mt-1 h-7 w-16 animate-pulse rounded bg-slate-100" />
        ) : (
          <p className={`text-2xl font-bold tabular-nums ${textClass}`}>
            {value?.toLocaleString() ?? "-"}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── custom recharts tooltip ──────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-sm">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { user } = useAuth();

  // Wait for auth to resolve before rendering anything
  if (!user) return null;

  // Admin-only guard
  if (user.role !== "Admin") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="text-lg font-bold text-slate-800">Access Restricted</p>
        <p className="text-sm text-slate-500">This page is available to Admins only.</p>
      </div>
    );
  }

  return <AnalyticsDashboard />;
}

function AnalyticsDashboard() {
  const [preset,       setPreset      ] = useState<Preset>("7d");
  const [summary,      setSummary     ] = useState<Summary | null>(null);
  const [agents,       setAgents      ] = useState<AgentRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingAgents,  setLoadingAgents ] = useState(true);
  const [error,        setError       ] = useState<string | null>(null);

  const fetchAll = useCallback((p: Preset) => {
    const { startDate, endDate } = rangeForPreset(p);
    const qs = `?startDate=${startDate}&endDate=${endDate}`;

    setLoadingSummary(true);
    setLoadingAgents(true);
    setError(null);

    apiFetch(`/api/analytics/summary${qs}`)
      .then((r) => r.json())
      .then((d: Summary & { error?: string }) => {
        if (d.error) throw new Error(d.error);
        setSummary(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingSummary(false));

    apiFetch(`/api/analytics/agents${qs}`)
      .then((r) => r.json())
      .then((d: AgentRow[] | { error: string }) => {
        if (!Array.isArray(d)) throw new Error((d as { error: string }).error);
        setAgents(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingAgents(false));
  }, []);

  useEffect(() => { fetchAll(preset); }, [preset, fetchAll]);

  const loading = loadingSummary || loadingAgents;

  // Sort for table: descending by transferConversions
  const sortedAgents = [...agents].sort(
    (a, b) => b.transferConversions - a.transferConversions
  );

  const PRESET_OPTIONS: { value: Preset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7d",    label: "Last 7 Days" },
    { value: "month", label: "This Month" },
  ];

  return (
    <div className="space-y-5">

      {/* ── heading + filter ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Performance Analytics
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Agent activity and conversion attribution
          </p>
        </div>
        <div className="relative shrink-0">
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {PRESET_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* ── error banner ── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── metric cards ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Total Interactions"
          value={summary?.totalActivities}
          loading={loadingSummary}
          icon={<Activity className="h-5 w-5 text-blue-600" />}
          colorClass="bg-blue-50"
          textClass="text-blue-700"
        />
        <MetricCard
          label="KYC Completions"
          value={summary?.kycConversions}
          loading={loadingSummary}
          icon={<UserCheck className="h-5 w-5 text-emerald-600" />}
          colorClass="bg-emerald-50"
          textClass="text-emerald-700"
        />
        <MetricCard
          label="Active Transactors"
          value={summary?.transferConversions}
          loading={loadingSummary}
          icon={<DollarSign className="h-5 w-5 text-purple-600" />}
          colorClass="bg-purple-50"
          textClass="text-purple-700"
        />
      </div>

      {/* ── chart + leaderboard ── */}
      {loadingAgents ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading agent data...</span>
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          No agent activity recorded for this period.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* ── bar chart ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">
              Effort vs. Results
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={agents}
                margin={{ top: 4, right: 8, left: -16, bottom: 40 }}
                barCategoryGap="25%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="agentName"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  formatter={(value) =>
                    value === "totalActivities"
                      ? "Total Activities"
                      : value === "kycConversions"
                      ? "KYC Completions"
                      : "Transfer Conv."
                  }
                />
                <Bar dataKey="totalActivities"     fill="#94a3b8" radius={[4, 4, 0, 0]} name="totalActivities" />
                <Bar dataKey="kycConversions"       fill="#34d399" radius={[4, 4, 0, 0]} name="kycConversions" />
                <Bar dataKey="transferConversions"  fill="#8b5cf6" radius={[4, 4, 0, 0]} name="transferConversions" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── leaderboard table ── */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Agent Leaderboard
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3">#</th>
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3 text-right">Activities</th>
                    <th className="px-5 py-3 text-right">KYC</th>
                    <th className="px-5 py-3 text-right">Transfers</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map((agent, idx) => (
                    <tr
                      key={agent.agentId}
                      className={`border-b border-slate-50 transition hover:bg-slate-50 ${
                        idx === 0 ? "bg-amber-50/40" : ""
                      }`}
                    >
                      <td className="px-5 py-3 font-medium text-slate-400">
                        {idx === 0 ? "🏆" : idx + 1}
                      </td>
                      <td className="px-5 py-3 font-semibold text-slate-800">
                        {agent.agentName}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                        {agent.totalActivities.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {agent.kycConversions}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          {agent.transferConversions}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
