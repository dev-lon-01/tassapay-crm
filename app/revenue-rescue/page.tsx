"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  TimerReset,
  UserRound,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

type RiskKey =
  | "somalia_sla"
  | "standard_sla"
  | "payment_received_not_processed"
  | "processed_not_paid"
  | "cancelled_recent";

type BucketKey = "all" | RiskKey;
type SortKey = "severity" | "oldest" | "amount_desc" | "recent";

interface RescueSummary {
  totalRows: number;
  buckets: Record<RiskKey, number>;
  totalMoneyAtRisk: number;
  oldestStuckMinutes: number;
  noOpenTask: number;
  noContact24h: number;
}

interface RescueRow {
  transfer: {
    id: number;
    transactionRef: string | null;
    dataFieldId: string | null;
    customerId: string | null;
    createdAt: string | null;
    sendAmount: number | null;
    sendCurrency: string | null;
    destinationCountry: string | null;
    beneficiaryName: string | null;
    status: string | null;
    paymentStatus: string | null;
    holdReason: string | null;
  };
  customer: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
  };
  owner: { id: number; name: string | null } | null;
  openTask: {
    id: number;
    title: string | null;
    priority: string | null;
    status: string | null;
    assignedAgentId: number | null;
    assignedAgentName: string | null;
    updatedAt: string | null;
  } | null;
  latestInteraction: {
    id: number;
    type: string | null;
    outcome: string | null;
    direction: string | null;
    createdAt: string | null;
    agentName: string | null;
  } | null;
  riskFlags: Record<RiskKey, boolean>;
  primaryBucket: RiskKey;
  severityScore: number;
  ageMinutes: number;
}

interface RescuePayload {
  summary: RescueSummary;
  data: RescueRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

interface AgentOption {
  id: number;
  name: string;
  is_active: number;
}

const DAYS_OPTIONS = [
  { label: "24h", value: "1" },
  { label: "48h", value: "2" },
  { label: "7d", value: "7" },
  { label: "14d", value: "14" },
  { label: "30d", value: "30" },
  { label: "60d", value: "60" },
];

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "Severity", value: "severity" },
  { label: "Oldest", value: "oldest" },
  { label: "Highest Amount", value: "amount_desc" },
  { label: "Newest", value: "recent" },
];

const RISK_META: Record<
  RiskKey,
  { label: string; shortLabel: string; badge: string; dot: string }
> = {
  somalia_sla: {
    label: "Somalia SLA",
    shortLabel: "Somalia",
    badge: "bg-red-100 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
  standard_sla: {
    label: "24h SLA",
    shortLabel: "24h SLA",
    badge: "bg-amber-100 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  payment_received_not_processed: {
    label: "Payment Received",
    shortLabel: "Payment",
    badge: "bg-blue-100 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  processed_not_paid: {
    label: "Processed Not Paid",
    shortLabel: "Processed",
    badge: "bg-cyan-100 text-cyan-700 ring-cyan-200",
    dot: "bg-cyan-500",
  },
  cancelled_recent: {
    label: "Cancelled Recent",
    shortLabel: "Cancelled",
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
    dot: "bg-slate-500",
  },
};

const BUCKET_TABS: { key: BucketKey; label: string }[] = [
  { key: "all", label: "All Risk" },
  { key: "somalia_sla", label: "Somalia SLA" },
  { key: "standard_sla", label: "24h SLA" },
  { key: "payment_received_not_processed", label: "Payment Received" },
  { key: "processed_not_paid", label: "Processed" },
  { key: "cancelled_recent", label: "Cancelled" },
];

const STATUS_FINAL = new Set(["Completed", "Deposited", "Paid"]);
const STATUS_CANCELLED = new Set(["Cancel", "Cancelled", "Rejected", "Failed"]);

function formatAge(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.floor(minutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "-";
  if (!currency) return amount.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function formatRiskAmount(amount: number): string {
  return amount.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function isStaleContact(value: string | null | undefined): boolean {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() > 86_400_000;
}

function statusClasses(status: string | null): string {
  if (!status) return "bg-slate-100 text-slate-500";
  if (STATUS_FINAL.has(status)) return "bg-emerald-100 text-emerald-700";
  if (STATUS_CANCELLED.has(status)) return "bg-slate-100 text-slate-700";
  return "bg-amber-100 text-amber-700";
}

function bucketCount(summary: RescueSummary | null, bucket: BucketKey): number {
  if (!summary) return 0;
  return bucket === "all" ? summary.totalRows : summary.buckets[bucket];
}

function RiskBadge({ risk }: { risk: RiskKey }) {
  const meta = RISK_META[risk];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.shortLabel}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: ComponentType<{ className?: string }>;
  accent: "red" | "amber" | "blue" | "emerald" | "slate";
}) {
  const palette = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-white text-slate-700",
  }[accent];

  return (
    <article className={`rounded-2xl border p-4 shadow-sm ${palette}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide opacity-75">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
          <p className="mt-1 text-xs opacity-75">{sub}</p>
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/70">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <CheckSquare className="h-9 w-9 text-slate-200" />
      <p className="text-sm font-semibold text-slate-600">No transfers in this bucket.</p>
    </div>
  );
}

function RestrictedState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <AlertCircle className="h-10 w-10 text-rose-400" />
      <p className="text-lg font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">This report is available to managers and admins only.</p>
    </div>
  );
}

export default function RevenueRescuePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const canView = Boolean(user && (user.role === "Admin" || user.can_view_dashboard));

  const [payload, setPayload] = useState<RescuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [days, setDays] = useState("30");
  const [bucket, setBucket] = useState<BucketKey>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [country, setCountry] = useState("");
  const [agentId, setAgentId] = useState("");
  const [sort, setSort] = useState<SortKey>("severity");
  const [countries, setCountries] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (user && !canView) router.replace("/my-dashboard");
  }, [authLoading, canView, router, user]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canView) return;
    apiFetch("/api/transfers?distinct_countries=1")
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((rows: unknown) => {
        if (Array.isArray(rows)) {
          setCountries(rows.filter((c): c is string => typeof c === "string" && c.length > 0));
        }
      })
      .catch(() => {});
  }, [canView]);

  useEffect(() => {
    if (user?.role !== "Admin") return;
    apiFetch("/api/users")
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((rows: unknown) => {
        if (Array.isArray(rows)) {
          setAgents(
            (rows as AgentOption[])
              .filter((agent) => agent.is_active && agent.name)
              .map((agent) => ({ id: agent.id, name: agent.name, is_active: agent.is_active })),
          );
        }
      })
      .catch(() => {});
  }, [user?.role]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("days", days);
    params.set("bucket", bucket);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", "50");
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (country) params.set("country", country);
    if (agentId) params.set("agentId", agentId);
    return params.toString();
  }, [agentId, bucket, country, days, debouncedSearch, page, sort]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    apiFetch(`/api/revenue-rescue?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error((data as { error?: string }).error ?? "Failed to load report");
        }
        if (active) setPayload(data as RescuePayload);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [canView, query, refreshKey]);

  function resetPageAnd<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  const activeSlaCount =
    (payload?.summary.buckets.somalia_sla ?? 0) + (payload?.summary.buckets.standard_sla ?? 0);
  const rows = payload?.data ?? [];
  const pagination = payload?.pagination;

  if (authLoading || (!user && !authLoading)) return null;
  if (!canView) return <RestrictedState />;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 ring-1 ring-red-100">
            <ShieldAlert className="h-3.5 w-3.5" />
            Revenue Rescue
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            Transfer Risk Queue
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Stuck transfers, payment bottlenecks, ownership, and next actions.
          </p>
        </div>

        <button
          onClick={() => setRefreshKey((current) => current + 1)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Money at Risk"
          value={formatRiskAmount(payload?.summary.totalMoneyAtRisk ?? 0)}
          sub="Non-cancelled send amount"
          icon={Banknote}
          accent="emerald"
        />
        <KpiCard
          label="SLA Breached"
          value={activeSlaCount}
          sub="Somalia and 24h queues"
          icon={AlertTriangle}
          accent={activeSlaCount > 0 ? "red" : "slate"}
        />
        <KpiCard
          label="Payment Received"
          value={payload?.summary.buckets.payment_received_not_processed ?? 0}
          sub="Not completed or cancelled"
          icon={TimerReset}
          accent="blue"
        />
        <KpiCard
          label="No Open Task"
          value={payload?.summary.noOpenTask ?? 0}
          sub="Active risk with no task"
          icon={CheckSquare}
          accent={(payload?.summary.noOpenTask ?? 0) > 0 ? "amber" : "slate"}
        />
        <KpiCard
          label="Oldest Stuck"
          value={formatAge(payload?.summary.oldestStuckMinutes ?? 0)}
          sub={`${payload?.summary.noContact24h ?? 0} without 24h contact`}
          icon={Clock}
          accent="slate"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {BUCKET_TABS.map((tab) => {
            const active = bucket === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => resetPageAnd(setBucket, tab.key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-white text-slate-500"}`}>
                  {bucketCount(payload?.summary ?? null, tab.key).toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_170px_170px_170px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => resetPageAnd(setSearch, event.target.value)}
              placeholder="Search ref, customer, email, or phone"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <select
            value={days}
            onChange={(event) => resetPageAnd(setDays, event.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            {DAYS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Last {option.label}
              </option>
            ))}
          </select>

          <select
            value={country}
            onChange={(event) => resetPageAnd(setCountry, event.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            <option value="">All destinations</option>
            {countries.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          {user?.role === "Admin" ? (
            <select
              value={agentId}
              onChange={(event) => resetPageAnd(setAgentId, event.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">All owners</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="hidden lg:block" />
          )}

          <select
            value={sort}
            onChange={(event) => resetPageAnd(setSort, event.target.value as SortKey)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Rescue Queue
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {pagination ? `${pagination.total.toLocaleString()} matching transfer${pagination.total === 1 ? "" : "s"}` : "Loading transfers"}
            </p>
          </div>
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading
            </span>
          )}
        </div>

        {loading && !payload ? (
          <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading revenue queue...</span>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] table-auto text-left">
              <thead>
                <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Transfer</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Last Contact</th>
                  <th className="px-4 py-3">Open Task</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const flags = (Object.keys(row.riskFlags) as RiskKey[]).filter((key) => row.riskFlags[key]);
                  const staleContact = isStaleContact(row.latestInteraction?.createdAt);
                  return (
                    <tr key={row.transfer.id} className="border-t border-slate-100 text-sm text-slate-700 transition hover:bg-slate-50/70">
                      <td className="px-4 py-3 align-top">
                        <div className="flex max-w-[170px] flex-wrap gap-1.5">
                          <RiskBadge risk={row.primaryBucket} />
                          {flags
                            .filter((risk) => risk !== row.primaryBucket)
                            .slice(0, 2)
                            .map((risk) => <RiskBadge key={risk} risk={risk} />)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top font-semibold text-slate-800">
                        {formatAge(row.ageMinutes)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Link href={`/transfers/${row.transfer.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:text-emerald-800">
                          {row.transfer.transactionRef ?? `#${row.transfer.id}`}
                        </Link>
                        {row.transfer.dataFieldId && (
                          <p className="mt-1 font-mono text-[11px] text-slate-400">{row.transfer.dataFieldId}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.customer.id ? (
                          <Link href={`/customer/${row.customer.id}`} className="font-semibold text-slate-800 hover:text-emerald-700">
                            {row.customer.name ?? row.customer.id}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-400">Unknown customer</span>
                        )}
                        <p className="mt-1 text-xs text-slate-400">{row.customer.phone ?? row.customer.email ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-medium text-slate-800">{row.transfer.destinationCountry ?? "-"}</span>
                        <p className="mt-1 text-xs text-slate-400">From {row.customer.country ?? "-"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top font-semibold text-slate-800">
                        {formatAmount(row.transfer.sendAmount, row.transfer.sendCurrency)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(row.transfer.status)}`}>
                          {row.transfer.status ?? "-"}
                        </span>
                        {row.transfer.paymentStatus && (
                          <p className="mt-1 text-xs text-blue-600">Payment: {row.transfer.paymentStatus}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <UserRound className="h-3.5 w-3.5 text-slate-400" />
                          {row.owner?.name ?? "Unassigned"}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.latestInteraction ? (
                          <>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                              staleContact ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                            }`}>
                              <MessageSquare className="h-3 w-3" />
                              {formatDateTime(row.latestInteraction.createdAt)}
                            </span>
                            <p className="mt-1 text-xs text-slate-400">
                              {row.latestInteraction.type ?? "Activity"} by {row.latestInteraction.agentName ?? "Unknown"}
                            </p>
                          </>
                        ) : (
                          <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                            No contact
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.openTask ? (
                          <Link href={`/to-do?task=${row.openTask.id}`} className="group inline-flex max-w-[190px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                            <CheckSquare className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="truncate">{row.openTask.title ?? `Task #${row.openTask.id}`}</span>
                            <ExternalLink className="h-3 w-3 text-slate-300 group-hover:text-slate-500" />
                          </Link>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                            No task
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/transfers/${row.transfer.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            Transfer
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                          {row.customer.id && (
                            <Link
                              href={`/customer/${row.customer.id}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100"
                            >
                              Customer
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pagination && pagination.pages > 1 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:justify-between">
          <p className="text-xs text-slate-500">
            Page {pagination.page} of {pagination.pages}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>
            <button
              disabled={page >= pagination.pages}
              onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
