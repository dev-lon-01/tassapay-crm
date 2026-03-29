"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  Award,
  DollarSign,
  Loader2,
  Phone,
  PhoneCall,
  Star,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

// ─── types ────────────────────────────────────────────────────────────────────

interface FrontlineData {
  myActivities: number;
  activityBreakdown: Record<string, number>;
  totalTalkTimeSeconds: number;
  meaningfulCalls: number;
  myKycConversions: number;
  myTransferConversions: number;
  myPortfolioSize: number;
  myCommissions: {
    pending: number;
    approved: number;
    paid: number;
    totalEarned: number;
  };
  leaderboardRank: number;
  leaderboardTotal: number;
  days: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAYS_OPTIONS = [
  { label: "Today", value: 1 },
  { label: "Last 7 Days", value: 7 },
  { label: "Last 14 Days", value: 14 },
  { label: "Last 30 Days", value: 30 },
];

function rankSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function formatTalkTime(seconds: number): string {
  if (seconds < 60) return "< 1m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const TYPE_PILL_COLORS: Record<string, string> = {
  Call:  "bg-indigo-100 text-indigo-700 hover:bg-indigo-200",
  SMS:   "bg-cyan-100 text-cyan-700 hover:bg-cyan-200",
  Email: "bg-purple-100 text-purple-700 hover:bg-purple-200",
  Note:  "bg-amber-100 text-amber-700 hover:bg-amber-200",
};

// ─── stat card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "emerald" | "sky" | "violet" | "amber" | "rose" | "slate";
}) {
  const c = {
    emerald: { border: "border-emerald-200/90", bg: "from-emerald-50", text: "text-emerald-700", icon: "bg-emerald-100 text-emerald-700" },
    sky:     { border: "border-sky-200/90",     bg: "from-sky-50",     text: "text-sky-700",     icon: "bg-sky-100 text-sky-700"         },
    violet:  { border: "border-violet-200/90",  bg: "from-violet-50",  text: "text-violet-700",  icon: "bg-violet-100 text-violet-700"   },
    amber:   { border: "border-amber-200/90",   bg: "from-amber-50",   text: "text-amber-700",   icon: "bg-amber-100 text-amber-700"     },
    rose:    { border: "border-rose-200/90",     bg: "from-rose-50",    text: "text-rose-700",    icon: "bg-rose-100 text-rose-700"       },
    slate:   { border: "border-slate-200/90",   bg: "from-slate-50",   text: "text-slate-700",   icon: "bg-slate-100 text-slate-700"     },
  }[accent];

  return (
    <article className={`relative overflow-hidden rounded-3xl border ${c.border} bg-gradient-to-br ${c.bg} to-white p-5 shadow-md`}>
      <div className="relative flex items-start justify-between">
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${c.text}`}>{label}</p>
          <p className={`mt-2 text-3xl font-black tracking-tight ${c.text}`}>{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${c.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function FrontlineDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<FrontlineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/dashboard/frontline?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FrontlineData = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(days);
  }, [days, fetchData]);

  const firstName = user?.name?.split(" ")[0] ?? "Agent";

  return (
    <div className="space-y-5 md:space-y-6">

      {/* ── Header ── */}
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-900 px-5 py-6 text-white shadow-2xl shadow-emerald-950/15 md:px-7 md:py-7">
        <div className="absolute right-[-30px] top-[-30px] h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-[-70px] left-[-30px] h-40 w-40 rounded-full bg-emerald-300/20 blur-2xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-white/20">
              <Star className="h-3 w-3" /> My Performance
            </p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Hey {firstName}!</h1>
            <p className="mt-1 text-sm text-slate-300">Your personal sales scorecard.</p>
          </div>

          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-white/40"
          >
            {DAYS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-slate-900 text-white">
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* ── Loading Skeleton ── */}
      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading your stats...</span>
        </div>
      )}

      {/* ── KPI Grid ── */}
      {data && (
        <>
          {/* Row 1: Core KPIs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* My Activities — expanded with type breakdown pills */}
            <article className="relative overflow-hidden rounded-3xl border border-sky-200/90 bg-gradient-to-br from-sky-50 to-white p-5 shadow-md">
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">My Activities</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-sky-700">{data.myActivities}</p>
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
                  <Activity className="h-5 w-5" />
                </div>
              </div>
              {Object.keys(data.activityBreakdown).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(data.activityBreakdown).map(([type, count]) => (
                    <Link
                      key={type}
                      href={`/activity?type=${type}`}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${TYPE_PILL_COLORS[type] ?? "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      {type} {count}
                    </Link>
                  ))}
                </div>
              )}
            </article>

            <KpiCard
              label="Talk Time"
              value={formatTalkTime(data.totalTalkTimeSeconds)}
              sub="Total call duration"
              icon={Phone}
              accent="violet"
            />
            <KpiCard
              label="Quality Calls"
              value={data.meaningfulCalls}
              sub="Calls over 2 minutes"
              icon={PhoneCall}
              accent="emerald"
            />
          </div>

          {/* Row 2: Conversion KPIs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="KYC Conversions"
              value={data.myKycConversions}
              sub="Customers onboarded"
              icon={UserCheck}
              accent="emerald"
            />
            <KpiCard
              label="Transfer Conversions"
              value={data.myTransferConversions}
              sub="First transfers driven"
              icon={TrendingUp}
              accent="violet"
            />
            <KpiCard
              label="My Portfolio"
              value={data.myPortfolioSize}
              sub="Assigned customers"
              icon={Users}
              accent="slate"
            />
            <KpiCard
              label="Leaderboard Rank"
              value={data.leaderboardRank > 0 ? rankSuffix(data.leaderboardRank) : "-"}
              sub={data.leaderboardTotal > 0 ? `of ${data.leaderboardTotal} agents` : ""}
              icon={Star}
              accent={data.leaderboardRank <= 3 ? "amber" : "slate"}
            />
          </div>

          {/* Row 3: Commissions */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard
              label="Total Earned"
              value={`£${data.myCommissions.totalEarned.toFixed(0)}`}
              sub={`${data.myCommissions.paid} paid · ${data.myCommissions.approved} approved`}
              icon={DollarSign}
              accent="emerald"
            />
            <KpiCard
              label="Pending Approval"
              value={data.myCommissions.pending}
              sub="Commissions awaiting review"
              icon={Award}
              accent="amber"
            />
          </div>
        </>
      )}
    </div>
  );
}
