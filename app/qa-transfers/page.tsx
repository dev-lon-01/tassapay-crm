"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  ExternalLink,
  Clock,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

// ─── types ────────────────────────────────────────────────────────────────────

interface LateTransfer {
  id: number;
  customer_id: string;
  transaction_ref: string;
  created_at: string;
  send_amount: number | null;
  send_currency: string | null;
  destination_country: string | null;
  status: string | null;
  hold_reason: string | null;
  full_name: string | null;
  sender_country: string | null;
}

interface QAData {
  somaliaUrgent: LateTransfer[];
  oneDayLate: LateTransfer[];
  twoDaysLate: LateTransfer[];
}

type SortDir = "asc" | "desc";

// ─── helpers ──────────────────────────────────────────────────────────────────

function timeElapsed(created_at: string): string {
  const diff = Math.max(0, Date.now() - new Date(created_at).getTime());
  const totalMins = Math.floor(diff / 60_000);
  const hours = Math.floor(totalMins / 60);
  const days = Math.floor(hours / 24);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours % 24}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${totalMins}m`;
}

function daysLate(created_at: string): string {
  const days = Math.floor(
    Math.max(0, Date.now() - new Date(created_at).getTime()) / 86_400_000
  );
  return days >= 2 ? `${days} days` : "1 day";
}

function fmtAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "-";
  return `${currency ?? ""} ${Number(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function sorted(arr: LateTransfer[], dir: SortDir): LateTransfer[] {
  return [...arr].sort((a, b) => {
    const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return dir === "asc" ? d : -d;
  });
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SortBtn({ dir, onToggle }: { dir: SortDir; onToggle: () => void }) {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
    >
      <Icon className="h-3 w-3" />
      {dir === "asc" ? "Oldest first" : "Newest first"}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/60 px-4 py-5">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
      <p className="text-sm font-medium text-slate-700">{message}</p>
    </div>
  );
}

function ViewBtn({ customerId }: { customerId: string }) {
  return (
    <Link
      href={`/customer/${customerId}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
    >
      View <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

// ─── somalia urgent section ───────────────────────────────────────────────────

function SomaliaTable({
  transfers,
  sort,
  onSortToggle,
}: {
  transfers: LateTransfer[];
  sort: SortDir;
  onSortToggle: () => void;
}) {
  const rows = sorted(transfers, sort);
  return (
    <section className="rounded-2xl border-2 border-red-500 bg-red-50 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <h2 className="text-base font-bold text-red-900">
            🚨 URGENT: Delayed Somalia Transfers (SLA Breach)
          </h2>
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
            {transfers.length}
          </span>
        </div>
        <SortBtn dir={sort} onToggle={onSortToggle} />
      </div>

      {transfers.length === 0 ? (
        <div className="p-5">
          <EmptyState message="✅ Zero delayed transfers to Somalia right now. Excellent work!" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-red-100/70">
                {["Time Elapsed", "Ref", "Sender", "From", "Amount", "Status", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-red-800 first:pl-5 last:pr-5"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-red-200/70 transition hover:bg-red-100/40"
                >
                  <td className="whitespace-nowrap py-3 pl-5 pr-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">
                      <Clock className="h-3 w-3" />
                      {timeElapsed(t.created_at)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                    {t.transaction_ref}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {t.full_name ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {t.sender_country ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-800">
                    {fmtAmount(t.send_amount, t.send_currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      {t.status ?? "-"}
                    </span>
                  </td>
                  <td className="py-3 pl-4 pr-5">
                    <ViewBtn customerId={t.customer_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── standard late section ────────────────────────────────────────────────────

interface StandardColors {
  border: string;
  bg: string;
  headerBorder: string;
  headerBg: string;
  headingText: string;
  rowBorder: string;
  rowHover: string;
  countBadge: string;
  lateBadge: string;
  statusBadgeBg: string;
  statusBadgeText: string;
}

const AMBER_COLORS: StandardColors = {
  border: "border-amber-400",
  bg: "bg-amber-50",
  headerBorder: "border-amber-200",
  headerBg: "bg-amber-100/70",
  headingText: "text-amber-900",
  rowBorder: "border-amber-200/70",
  rowHover: "hover:bg-amber-50/60",
  countBadge: "bg-amber-500 text-white",
  lateBadge: "bg-amber-500 text-white",
  statusBadgeBg: "bg-amber-100",
  statusBadgeText: "text-amber-800",
};

const ORANGE_COLORS: StandardColors = {
  border: "border-orange-500",
  bg: "bg-orange-50",
  headerBorder: "border-orange-200",
  headerBg: "bg-orange-100/70",
  headingText: "text-orange-900",
  rowBorder: "border-orange-200/70",
  rowHover: "hover:bg-orange-50/60",
  countBadge: "bg-orange-600 text-white",
  lateBadge: "bg-orange-600 text-white",
  statusBadgeBg: "bg-orange-100",
  statusBadgeText: "text-orange-800",
};

function StandardTable({
  title,
  transfers,
  sort,
  onSortToggle,
  colors,
  emptyMessage,
}: {
  title: string;
  transfers: LateTransfer[];
  sort: SortDir;
  onSortToggle: () => void;
  colors: StandardColors;
  emptyMessage: string;
}) {
  const rows = sorted(transfers, sort);
  return (
    <section className={`rounded-2xl border-2 ${colors.border} ${colors.bg} shadow-md`}>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b ${colors.headerBorder} px-5 py-4`}
      >
        <div className="flex items-center gap-3">
          <h2 className={`text-sm font-bold ${colors.headingText}`}>{title}</h2>
          <span className={`rounded-full ${colors.countBadge} px-2 py-0.5 text-xs font-bold`}>
            {transfers.length}
          </span>
        </div>
        <SortBtn dir={sort} onToggle={onSortToggle} />
      </div>

      {transfers.length === 0 ? (
        <div className="p-5">
          <EmptyState message={emptyMessage} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className={colors.headerBg}>
                {["Days Late", "Ref", "Destination", "Sender", "From", "Amount", "Status", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide ${colors.headingText} first:pl-5 last:pr-5`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className={`border-t ${colors.rowBorder} transition ${colors.rowHover}`}
                >
                  <td className="whitespace-nowrap py-3 pl-5 pr-4">
                    <span
                      className={`inline-block rounded-full ${colors.lateBadge} px-2.5 py-0.5 text-xs font-bold`}
                    >
                      {daysLate(t.created_at)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                    {t.transaction_ref}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {t.destination_country ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {t.full_name ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {t.sender_country ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-800">
                    {fmtAmount(t.send_amount, t.send_currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full ${colors.statusBadgeBg} ${colors.statusBadgeText} px-2 py-0.5 text-xs font-semibold`}
                    >
                      {t.status ?? "-"}
                    </span>
                  </td>
                  <td className="py-3 pl-4 pr-5">
                    <ViewBtn customerId={t.customer_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function QATransfersPage() {
  const [data, setData] = useState<QAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sorts, setSorts] = useState<Record<"somalia" | "oneDay" | "twoDay", SortDir>>({
    somalia: "asc",
    oneDay: "asc",
    twoDay: "asc",
  });

  const fetchData = useCallback(() => {
    setLoading(true);
    apiFetch("/api/qa/late-transfers")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<QAData>;
      })
      .then((d) => {
        setData(d);
        setLastUpdated(new Date());
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Initial load + auto-refresh every 60 s
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  function toggleSort(key: "somalia" | "oneDay" | "twoDay") {
    setSorts((prev) => ({ ...prev, [key]: prev[key] === "asc" ? "desc" : "asc" }));
  }

  const total = data
    ? data.somaliaUrgent.length + data.oneDayLate.length + data.twoDaysLate.length
    : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            QA - Transfer Monitor
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {loading && !data
              ? "Loading..."
              : `${total} late transfer${total === 1 ? "" : "s"} detected · refreshes every 60 s`}
            {lastUpdated && (
              <span className="ml-2 text-slate-400">
                · last updated{" "}
                {lastUpdated.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load QA data: {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading transfer data...</span>
        </div>
      )}

      {/* Content */}
      {data && (
        <>
          {/* Somalia – red zone */}
          <SomaliaTable
            transfers={data.somaliaUrgent}
            sort={sorts.somalia}
            onSortToggle={() => toggleSort("somalia")}
          />

          {/* Standard late queues – side by side on xl */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <StandardTable
              title="⚠️ 1 Day Late (24–48 hours)"
              transfers={data.oneDayLate}
              sort={sorts.oneDay}
              onSortToggle={() => toggleSort("oneDay")}
              colors={AMBER_COLORS}
              emptyMessage="✅ No transfers are 1 day late right now. Keep it up!"
            />
            <StandardTable
              title="🔴 2+ Days Late (Critical)"
              transfers={data.twoDaysLate}
              sort={sorts.twoDay}
              onSortToggle={() => toggleSort("twoDay")}
              colors={ORANGE_COLORS}
              emptyMessage="✅ No transfers are 2+ days late. Outstanding performance!"
            />
          </div>
        </>
      )}
    </div>
  );
}
