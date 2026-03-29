"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CreditCard,
  Loader2,
  ShieldAlert,
  Shuffle,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

/* ---------- types ---------- */

interface UnfundedRow {
  transfer_id: number;
  transaction_ref: string;
  send_amount: number | null;
  send_currency: string | null;
  transfer_status: string;
  created_at: string | null;
}

interface DoubleLossRow {
  transfer_id: number;
  transaction_ref: string;
  send_amount: number | null;
  send_currency: string | null;
  transfer_status: string;
  provider: string;
  refund_date: string | null;
}

interface MismatchRow {
  transfer_id: number;
  transaction_ref: string;
  expected_amount: number | null;
  send_currency: string | null;
  actual_collected: number | null;
  payment_currency: string | null;
  provider: string;
}

interface OrphanRow {
  payment_id: number;
  provider_payment_id: string;
  amount: number | null;
  currency: string | null;
  provider: string;
  payment_date: string | null;
  transfer_ref: string | null;
  reconciliation_note: string | null;
}

interface ExceptionsPayload {
  unfunded: UnfundedRow[];
  doubleLoss: DoubleLossRow[];
  mismatches: MismatchRow[];
  orphans: OrphanRow[];
  counts: { unfunded: number; doubleLoss: number; mismatches: number; orphans: number };
}

/* ---------- helpers ---------- */

function formatAmount(amount: number | null, currency: string | null) {
  if (amount == null) return "-";
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type TabKey = "unfunded" | "doubleLoss" | "mismatches" | "orphans";

const TAB_META: { key: TabKey; label: string; critical: boolean; icon: React.ReactNode }[] = [
  { key: "unfunded", label: "Unfunded Transfers", critical: true, icon: <ShieldAlert className="h-4 w-4" /> },
  { key: "doubleLoss", label: "Double Loss", critical: true, icon: <AlertTriangle className="h-4 w-4" /> },
  { key: "mismatches", label: "Amount Mismatches", critical: false, icon: <Shuffle className="h-4 w-4" /> },
  { key: "orphans", label: "Orphaned Payments", critical: false, icon: <CreditCard className="h-4 w-4" /> },
];

/* ---------- page ---------- */

export default function FinanceExceptionsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ExceptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("unfunded");

  useEffect(() => {
    if (user && user.role !== "Admin") router.replace("/dashboard");
  }, [user, router]);

  useEffect(() => {
    if (user?.role !== "Admin") return;
    setLoading(true);
    apiFetch("/api/finance/exceptions")
      .then((r) => r.json())
      .then((payload: ExceptionsPayload) => setData(payload))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;
  if (user.role !== "Admin") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="text-lg font-bold text-slate-800">Access Restricted</p>
        <p className="text-sm text-slate-500">This page is available to Admins only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reconciliation Exceptions</h1>
        <p className="mt-1 text-sm text-slate-500">
          Active discrepancies between transfers and payment gateway records.
        </p>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading exceptions...</span>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {TAB_META.map((tab) => {
              const count = data.counts[tab.key];
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-2xl border p-4 text-left shadow-sm transition ${
                    active
                      ? tab.critical
                        ? "border-rose-300 bg-rose-50 ring-2 ring-rose-200"
                        : "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={tab.critical ? "text-rose-600" : "text-slate-500"}>{tab.icon}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tab.label}</span>
                  </div>
                  <p className={`mt-2 text-3xl font-bold ${tab.critical && count > 0 ? "text-rose-700" : "text-slate-900"}`}>
                    {count}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Critical banner */}
          {(data.counts.unfunded > 0 || data.counts.doubleLoss > 0) && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <p className="text-sm font-bold text-rose-800">Critical Revenue Leakage Detected</p>
                <p className="mt-0.5 text-xs text-rose-700">
                  {data.counts.unfunded > 0 && `${data.counts.unfunded} unfunded transfer${data.counts.unfunded === 1 ? "" : "s"}. `}
                  {data.counts.doubleLoss > 0 && `${data.counts.doubleLoss} refunded-but-paid-out case${data.counts.doubleLoss === 1 ? "" : "s"}.`}
                </p>
              </div>
            </div>
          )}

          {/* Tab strip */}
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
            {TAB_META.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
                  activeTab === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
                <span
                  className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                    tab.critical && data.counts[tab.key] > 0
                      ? "bg-rose-100 text-rose-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {data.counts[tab.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Tables */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            {activeTab === "unfunded" && <UnfundedTable rows={data.unfunded} />}
            {activeTab === "doubleLoss" && <DoubleLossTable rows={data.doubleLoss} />}
            {activeTab === "mismatches" && <MismatchTable rows={data.mismatches} />}
            {activeTab === "orphans" && <OrphanTable rows={data.orphans} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- table components ---------- */

function ViewTransferButton({ transferId }: { transferId: number }) {
  return (
    <Link
      href={`/transfers/${transferId}`}
      target="_blank"
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50"
    >
      View Transfer <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <Banknote className="h-8 w-8 text-slate-200" />
      <p className="text-sm font-semibold text-slate-500">{message}</p>
    </div>
  );
}

function UnfundedTable({ rows }: { rows: UnfundedRow[] }) {
  if (rows.length === 0) return <EmptyState message="No unfunded transfers detected." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[800px] w-full table-auto text-left">
        <thead>
          <tr className="bg-rose-50/60 text-xs font-semibold uppercase tracking-wide text-rose-700">
            <th className="py-3 pl-5 pr-3">Transfer Ref</th>
            <th className="px-3 py-3">Amount</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Created</th>
            <th className="px-3 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.transfer_id} className="border-t border-slate-100 text-sm text-slate-700">
              <td className="py-3 pl-5 pr-3 font-mono text-xs">{r.transaction_ref}</td>
              <td className="px-3 py-3 font-semibold">{formatAmount(r.send_amount, r.send_currency)}</td>
              <td className="px-3 py-3">
                <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                  {r.transfer_status}
                </span>
              </td>
              <td className="px-3 py-3 text-xs text-slate-500">{formatDate(r.created_at)}</td>
              <td className="px-3 py-3 text-right"><ViewTransferButton transferId={r.transfer_id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DoubleLossTable({ rows }: { rows: DoubleLossRow[] }) {
  if (rows.length === 0) return <EmptyState message="No double-loss cases detected." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full table-auto text-left">
        <thead>
          <tr className="bg-rose-50/60 text-xs font-semibold uppercase tracking-wide text-rose-700">
            <th className="py-3 pl-5 pr-3">Transfer Ref</th>
            <th className="px-3 py-3">Amount</th>
            <th className="px-3 py-3">Transfer Status</th>
            <th className="px-3 py-3">Provider</th>
            <th className="px-3 py-3">Refund Date</th>
            <th className="px-3 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.transfer_id}-${r.refund_date}`} className="border-t border-slate-100 text-sm text-slate-700">
              <td className="py-3 pl-5 pr-3 font-mono text-xs">{r.transaction_ref}</td>
              <td className="px-3 py-3 font-semibold">{formatAmount(r.send_amount, r.send_currency)}</td>
              <td className="px-3 py-3">
                <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                  {r.transfer_status}
                </span>
              </td>
              <td className="px-3 py-3 capitalize">{r.provider}</td>
              <td className="px-3 py-3 text-xs text-slate-500">{formatDate(r.refund_date)}</td>
              <td className="px-3 py-3 text-right"><ViewTransferButton transferId={r.transfer_id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MismatchTable({ rows }: { rows: MismatchRow[] }) {
  if (rows.length === 0) return <EmptyState message="No amount mismatches detected." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full table-auto text-left">
        <thead>
          <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-3 pl-5 pr-3">Transfer Ref</th>
            <th className="px-3 py-3">Expected</th>
            <th className="px-3 py-3">Actual Collected</th>
            <th className="px-3 py-3">Difference</th>
            <th className="px-3 py-3">Provider</th>
            <th className="px-3 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = (r.actual_collected ?? 0) - (r.expected_amount ?? 0);
            return (
              <tr key={r.transfer_id} className="border-t border-slate-100 text-sm text-slate-700">
                <td className="py-3 pl-5 pr-3 font-mono text-xs">{r.transaction_ref}</td>
                <td className="px-3 py-3 font-semibold">{formatAmount(r.expected_amount, r.send_currency)}</td>
                <td className="px-3 py-3 font-semibold">{formatAmount(r.actual_collected, r.payment_currency)}</td>
                <td className="px-3 py-3">
                  <span className={`font-semibold ${diff < 0 ? "text-rose-600" : "text-amber-600"}`}>
                    {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                  </span>
                </td>
                <td className="px-3 py-3 capitalize">{r.provider}</td>
                <td className="px-3 py-3 text-right"><ViewTransferButton transferId={r.transfer_id} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrphanTable({ rows }: { rows: OrphanRow[] }) {
  if (rows.length === 0) return <EmptyState message="No orphaned payments detected." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full table-auto text-left">
        <thead>
          <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-3 pl-5 pr-3">Payment ID</th>
            <th className="px-3 py-3">Amount</th>
            <th className="px-3 py-3">Provider</th>
            <th className="px-3 py-3">Transfer Ref</th>
            <th className="px-3 py-3">Note</th>
            <th className="px-3 py-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.payment_id} className="border-t border-slate-100 text-sm text-slate-700">
              <td className="py-3 pl-5 pr-3 font-mono text-xs">{r.provider_payment_id}</td>
              <td className="px-3 py-3 font-semibold">{formatAmount(r.amount, r.currency)}</td>
              <td className="px-3 py-3 capitalize">{r.provider}</td>
              <td className="px-3 py-3 font-mono text-xs">{r.transfer_ref ?? "-"}</td>
              <td className="px-3 py-3 text-xs text-slate-500">{r.reconciliation_note ?? "-"}</td>
              <td className="px-3 py-3 text-xs text-slate-500">{formatDate(r.payment_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
