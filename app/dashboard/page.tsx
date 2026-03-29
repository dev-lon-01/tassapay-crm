"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveData {
  health: {
    somaliaBreached: number;
    standardBreached: number;
    lastIngestedAt: string | null;
  };
  pipeline: {
    pendingKyc: number;
    newZeroTransfer: number;
    dormantUsers: number;
  };
  velocity: {
    interactionsToday: number;
    conversionsToday: number;
  };
}

// ─── SLA Types ────────────────────────────────────────────────────────────────

interface SlaData {
  processedNotPaid: Array<{ destination_country: string; count: number }>;
  paymentReceivedNotProcessed: number;
  canceled: number;
}

// ─── Stats Types ──────────────────────────────────────────────────────────────

interface StatsRow {
  total_transfers: number;
  total_revenue: number;
}
interface StatsData {
  byCurrency:    Array<StatsRow & { currency: string | null }>;
  byDestination: Array<StatsRow & { destination: string | null }>;
  byOrigin:      Array<StatsRow & { origin: string | null }>;
}

const DAYS_OPTIONS = [
  { label: "Last 24 Hours", value: 1  },
  { label: "Last 48 Hours", value: 2  },
  { label: "Last 7 Days",   value: 7  },
  { label: "Last 14 Days",  value: 14 },
  { label: "Last 30 Days",  value: 30 },
  { label: "Last 60 Days",  value: 60 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const fmtRevenue = (amount: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount);

const fmtPeriod = (d: number) =>
  d === 1 ? "Last 24 hours" : d === 2 ? "Last 48 hours" : `Last ${d} days`;

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "amber" | "rose" | "slate" | "emerald" | "sky" | "violet";
}) {
  const colours = {
    amber:   { border: "border-amber-200/90",   bg: "from-amber-50",   blob: "bg-amber-200/35",   text: "text-amber-700",   icon: "bg-amber-100 text-amber-700"   },
    rose:    { border: "border-rose-200/90",     bg: "from-rose-50",    blob: "bg-rose-200/35",    text: "text-rose-700",    icon: "bg-rose-100 text-rose-700"     },
    slate:   { border: "border-slate-200/90",    bg: "from-slate-50",   blob: "bg-slate-200/35",   text: "text-slate-700",   icon: "bg-slate-100 text-slate-700"   },
    emerald: { border: "border-emerald-200/90",  bg: "from-emerald-50", blob: "bg-emerald-200/35", text: "text-emerald-700", icon: "bg-emerald-100 text-emerald-700"},
    sky:     { border: "border-sky-200/90",      bg: "from-sky-50",     blob: "bg-sky-200/35",     text: "text-sky-700",     icon: "bg-sky-100 text-sky-700"       },
    violet:  { border: "border-violet-200/90",   bg: "from-violet-50",  blob: "bg-violet-200/35",  text: "text-violet-700",  icon: "bg-violet-100 text-violet-700" },
  }[accent];

  return (
    <article className={`relative overflow-hidden rounded-3xl border ${colours.border} bg-gradient-to-br ${colours.bg} to-white p-5 shadow-md`}>
      <div className={`absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full ${colours.blob}`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${colours.text}`}>{label}</p>
          <p className={`mt-2 text-4xl font-black tracking-tight ${colours.text}`}>{value}</p>
          <p className="mt-1 text-xs text-slate-500">{sub}</p>
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${colours.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GlobalDashboard() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [data, setData]               = useState<LiveData | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [days, setDays]               = useState<number>(1);
  const [slaData, setSlaData]         = useState<SlaData | null>(null);
  const [slaLoading, setSlaLoading]   = useState(true);
  const [statsData,    setStatsData]    = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const daysRef = useRef<number>(3);
  daysRef.current = days;

  // Access guard - redirect agents without dashboard permission
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== "Admin" && !user.can_view_dashboard) {
      router.replace("/my-tasks");
    }
  }, [authLoading, user, router]);

  async function fetchLive(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const res = await apiFetch("/api/dashboard/live");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LiveData = await res.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function fetchSla(quiet = false) {
    if (!quiet) setSlaLoading(true);
    try {
      const res = await apiFetch(`/api/dashboard/sla?days=${daysRef.current}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SlaData = await res.json();
      setSlaData(json);
    } catch (e: unknown) {
      void e;
      if (!quiet) setSlaData(null);
    } finally {
      if (!quiet) setSlaLoading(false);
    }
  }

  async function fetchStats(quiet = false) {
    if (!quiet) setStatsLoading(true);
    try {
      const res = await apiFetch(`/api/dashboard/stats?days=${daysRef.current}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StatsData = await res.json();
      setStatsData(json);
    } catch {
      if (!quiet) setStatsData(null);
    } finally {
      if (!quiet) setStatsLoading(false);
    }
  }

  useEffect(() => {
    fetchLive();
    fetchSla();
    fetchStats();
    intervalRef.current = setInterval(() => { fetchLive(true); fetchSla(true); fetchStats(true); }, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchSla();
    fetchStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // ── Derived alert flags ──────────────────────────────────────────────────
  const minsAgo        = data ? minutesAgo(data.health.lastIngestedAt) : null;
  const ingestStale    = minsAgo !== null && minsAgo > 120;
  const somaliaAlert   = (data?.health.somaliaBreached ?? 0) > 0;
  const showAlert      = somaliaAlert || ingestStale;
  const internalUrgent = !slaLoading && (slaData?.paymentReceivedNotProcessed ?? 0) > 0;

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5 md:space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-900 px-5 py-6 text-white shadow-2xl shadow-emerald-950/15 md:px-7 md:py-7">
        <div className="absolute right-[-30px] top-[-30px] h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-[-70px] left-[-30px] h-40 w-40 rounded-full bg-emerald-300/20 blur-2xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-emerald-100 ring-1 ring-white/20">
              {data && !error ? (
                <><Wifi className="h-3 w-3" /> Live - refreshes every 60s</>
              ) : error ? (
                <><WifiOff className="h-3 w-3 text-rose-300" /> Connection error</>
              ) : (
                <><RefreshCw className="h-3 w-3 animate-spin" /> Loading...</>
              )}
            </p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{greeting}, {user?.name?.split(" ")[0] ?? "..."}.</h1>
            <p className="mt-1 text-sm text-slate-300">Live operational command centre.</p>
          </div>

          <div className="flex items-center gap-3">
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
            <button
              onClick={() => { fetchLive(); fetchSla(); }}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-sm text-right">
              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-300">Last updated</p>
              <p className="text-sm font-semibold">{lastRefresh ? lastRefresh.toLocaleTimeString("en-GB") : "-"}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SLA Health ────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">SLA Health</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard
            label="Somalia SLA Breaches"
            value={loading ? "..." : (data?.health.somaliaBreached ?? "-")}
            sub="Transfers pending > 15 minutes"
            icon={AlertTriangle}
            accent={somaliaAlert ? "rose" : "emerald"}
          />
          <StatCard
            label="Standard SLA Breaches"
            value={loading ? "..." : (data?.health.standardBreached ?? "-")}
            sub="Transfers pending > 24 hours"
            icon={CheckCircle2}
            accent={(data?.health.standardBreached ?? 0) > 0 ? "amber" : "emerald"}
          />
        </div>
      </div>

      {/* ── Volume Widgets ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">

        {/* Widget 1: Volume by Currency */}
        <div>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Volume by Currency</h2>
          <article className="rounded-3xl border border-sky-200/90 bg-gradient-to-br from-sky-50 to-white p-5 shadow-md">
            {statsLoading ? (
              <p className="text-sm text-sky-400">Loading...</p>
            ) : !statsData || statsData.byCurrency.length === 0 ? (
              <p className="text-sm text-slate-400">No data for this period.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {statsData.byCurrency.map((row) => (
                  <li key={row.currency ?? "unknown"} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700">
                        <span className="text-[10px] font-black">{(row.currency ?? "?").slice(0, 3)}</span>
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-sky-700">{row.currency ?? "Unknown"}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-800">{fmtRevenue(row.total_revenue)}</p>
                      <p className="text-xs text-slate-400">{row.total_transfers.toLocaleString("en-GB")} transfers</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>

        {/* Widget 2: Volume by Destination */}
        <div>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Volume by Destination</h2>
          <article className="rounded-3xl border border-violet-200/90 bg-gradient-to-br from-violet-50 to-white p-5 shadow-md">
            {statsLoading ? (
              <p className="text-sm text-violet-400">Loading...</p>
            ) : !statsData || statsData.byDestination.length === 0 ? (
              <p className="text-sm text-slate-400">No data for this period.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {statsData.byDestination.map((row) => (
                  <li key={row.destination ?? "unknown"} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700">
                        <Globe className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-violet-700">{row.destination ?? "Unknown"}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-800">{fmtRevenue(row.total_revenue)}</p>
                      <p className="text-xs text-slate-400">{row.total_transfers.toLocaleString("en-GB")} transfers</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>

        {/* Widget 3: Volume by Origin */}
        <div>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Volume by Origin</h2>
          <article className="rounded-3xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-md">
            {statsLoading ? (
              <p className="text-sm text-emerald-400">Loading...</p>
            ) : !statsData || statsData.byOrigin.length === 0 ? (
              <p className="text-sm text-slate-400">No data for this period.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {statsData.byOrigin.map((row) => (
                  <li key={row.origin ?? "unknown"} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                        <Users className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-emerald-700">{row.origin ?? "Unknown"}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-800">{fmtRevenue(row.total_revenue)}</p>
                      <p className="text-xs text-slate-400">{row.total_transfers.toLocaleString("en-GB")} transfers</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>

      </div>

      {/* ── SLA Bottleneck Monitor ──────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">SLA Bottleneck Monitor</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            {fmtPeriod(days)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">

          {/* Col 1: Provider Bottleneck - Processed / Unpaid */}
          <article className="relative overflow-hidden rounded-3xl border border-amber-200/90 bg-gradient-to-br from-amber-50 to-white p-5 shadow-md shadow-amber-100/40">
            <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-amber-200/35" />
            <div className="relative">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">Provider Bottleneck</p>
                  <p className="mt-0.5 text-xs text-amber-600/80">Processed - Awaiting Provider Payout</p>
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </div>
              {slaLoading ? (
                <p className="mt-4 text-2xl font-black text-amber-400">...</p>
              ) : !slaData || slaData.processedNotPaid.length === 0 ? (
                <p className="mt-4 text-sm font-semibold text-emerald-600">✓ All clear - no unpaid transfers</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {slaData.processedNotPaid.map((row) => (
                    <li key={row.destination_country} className="flex items-center justify-between rounded-xl bg-amber-100/70 px-3 py-1.5">
                      <span className="text-xs font-semibold text-amber-800">{row.destination_country}</span>
                      <span className="min-w-[1.5rem] text-center text-sm font-black text-amber-800">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>

          {/* Col 2: Internal Bottleneck - Payment Received / Unprocessed */}
          <article className={`relative overflow-hidden rounded-3xl border p-5 shadow-md ${
            internalUrgent
              ? "border-rose-300 bg-gradient-to-br from-rose-50 to-white shadow-rose-100/60"
              : "border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white shadow-emerald-100/40"
          }`}>
            <div className={`absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full ${
              internalUrgent ? "bg-rose-200/35" : "bg-emerald-200/35"
            }`} />
            <div className="relative flex items-start justify-between">
              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${
                  internalUrgent ? "text-rose-700" : "text-emerald-700"
                }`}>Internal Bottleneck</p>
                <p className={`mt-0.5 text-xs ${
                  internalUrgent ? "text-rose-600/80" : "text-emerald-600/80"
                }`}>Awaiting Internal Processing</p>
                <p className={`mt-3 text-5xl font-black tracking-tight ${
                  internalUrgent ? "text-rose-700" : "text-emerald-700"
                }`}>
                  {slaLoading ? "..." : (slaData?.paymentReceivedNotProcessed ?? "-")}
                </p>
                <p className="mt-1 text-xs text-slate-500">Payment received, not yet processed</p>
              </div>
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                internalUrgent ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
              }`}>
                <ShieldAlert className="h-5 w-5" />
              </div>
            </div>
          </article>

          {/* Col 3: Lost Revenue - Canceled */}
          <article className="relative overflow-hidden rounded-3xl border border-slate-200/90 bg-gradient-to-br from-slate-50 to-white p-5 shadow-md shadow-slate-100/40">
            <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-slate-200/35" />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Lost Revenue</p>
                <p className="mt-0.5 text-xs text-slate-500">Canceled transfers in period</p>
                <p className="mt-3 text-5xl font-black tracking-tight text-slate-700">
                  {slaLoading ? "..." : (slaData?.canceled ?? "-")}
                </p>
                <p className="mt-1 text-xs text-slate-400">Transactions not completed</p>
              </div>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                <TrendingUp className="h-5 w-5 rotate-180" />
              </div>
            </div>
          </article>

        </div>
      </div>

      {/* ── Row 1: Alert Banner (conditional) ───────────────────────────── */}
      {showAlert && (
        <section className="overflow-hidden rounded-[24px] border-2 border-red-400 bg-red-50 px-5 py-4 shadow-lg shadow-red-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500 text-white shadow-md shadow-red-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-bold text-red-800">Operational Alert - Immediate Attention Required</p>
              {somaliaAlert && (
                <p className="text-sm text-red-700">
                  <span className="font-bold">{data!.health.somaliaBreached}</span> Somalia transfer{data!.health.somaliaBreached !== 1 ? "s" : ""} have been pending for over 15 minutes without delivery confirmation.
                </p>
              )}
              {ingestStale && (
                <p className="text-sm text-red-700">
                  No new transfers ingested for <span className="font-bold">{minsAgo} minutes</span>. Last seen at{" "}
                  <span className="font-bold">{fmtTime(data!.health.lastIngestedAt)}</span>. Check the sync worker.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Row 2: Pipeline Grid ─────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Pipeline</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Pending KYC"
            value={loading ? "..." : (data?.pipeline.pendingKyc ?? "-")}
            sub="Customers awaiting verification"
            icon={ShieldAlert}
            accent="amber"
          />
          <StatCard
            label="Zero Transfers (New)"
            value={loading ? "..." : (data?.pipeline.newZeroTransfer ?? "-")}
            sub="Registered last 7 days, no send"
            icon={Users}
            accent="rose"
          />
          <StatCard
            label="Dormant Users"
            value={loading ? "..." : (data?.pipeline.dormantUsers ?? "-")}
            sub="Last transfer over 40 days ago"
            icon={Clock}
            accent="slate"
          />
        </div>
      </div>

      {/* ── Row 3: Velocity Grid ─────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Today&apos;s Velocity</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Activities Today"
            value={loading ? "..." : (data?.velocity.interactionsToday ?? "-")}
            sub="Agent interactions logged"
            icon={Activity}
            accent="sky"
          />
          <StatCard
            label="Conversions Today"
            value={loading ? "..." : (data?.velocity.conversionsToday ?? "-")}
            sub="Attributed transfers sent"
            icon={TrendingUp}
            accent="emerald"
          />
          <StatCard
            label="Last Transfer Ingested"
            value={loading ? "..." : fmtTime(data?.health.lastIngestedAt ?? null)}
            sub={
              minsAgo !== null
                ? minsAgo < 2
                  ? "Just now"
                  : `${minsAgo} minute${minsAgo !== 1 ? "s" : ""} ago`
                : "No data yet"
            }
            icon={Zap}
            accent={ingestStale ? "rose" : "violet"}
          />
        </div>
      </div>

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {error && (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load live data: {error}
        </p>
      )}
    </div>
  );
}

