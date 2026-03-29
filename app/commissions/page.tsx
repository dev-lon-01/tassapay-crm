"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  Check,
  DollarSign,
  Loader2,
  X,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { useRouter } from "next/navigation";

// ─── types ────────────────────────────────────────────────────────────────────

interface Commission {
  id: number;
  agent_id: number;
  agent_name: string;
  customer_id: string;
  customer_name: string | null;
  transfer_id: number;
  transaction_ref: string | null;
  send_amount: number | null;
  send_currency: string | null;
  commission_amount: number;
  currency: string;
  status: "pending_approval" | "approved" | "rejected" | "paid";
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  paid_by: number | null;
  paid_by_name: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

type StatusTab = "all" | "pending_approval" | "approved" | "paid" | "rejected";

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending_approval", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

const STATUS_BADGE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  paid: "bg-sky-100 text-sky-700",
};

// ─── main ─────────────────────────────────────────────────────────────────────

export default function CommissionsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<StatusTab>("all");
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [rejectModalId, setRejectModalId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Access guard
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== "Admin") {
      router.replace("/my-dashboard");
    }
  }, [authLoading, user, router]);

  const fetchCommissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = tab !== "all" ? `&status=${tab}` : "";
      const res = await apiFetch(`/api/commissions?page=${page}${statusParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCommissions(json.data);
      setTotal(json.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    fetchCommissions();
  }, [fetchCommissions]);

  // Reset page when tab changes
  useEffect(() => {
    setPage(1);
  }, [tab]);

  async function handleAction(action: string, commissionId: number, reason?: string) {
    setActionLoading(commissionId);
    try {
      const res = await apiFetch("/api/commissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, commissionId, reason }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      await fetchCommissions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
      setRejectModalId(null);
      setRejectReason("");
    }
  }

  if (authLoading || !user) return null;
  if (user.role !== "Admin") return null;

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Commission Management</h1>
        <p className="mt-0.5 text-sm text-slate-500">Approve, reject, and track agent commission payouts.</p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition ${
              tab === t.value
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading commissions...</span>
        </div>
      ) : commissions.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          No commissions found{tab !== "all" ? ` with status "${tab.replace("_", " ")}"` : ""}.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Transfer</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Commission</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-slate-50 transition hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{c.agent_name}</td>
                      <td className="px-4 py-3 text-slate-600">{c.customer_name ?? c.customer_id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.transaction_ref ?? `-`}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {c.send_amount != null ? `${c.send_currency ?? ""} ${Number(c.send_amount).toFixed(2)}` : "-"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                        {c.currency} {Number(c.commission_amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {c.status.replace("_", " ")}
                        </span>
                        {c.rejection_reason && (
                          <p className="mt-1 text-xs text-rose-500">{c.rejection_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {new Date(c.created_at).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {c.status === "pending_approval" && (
                            <>
                              <button
                                onClick={() => handleAction("approve", c.id)}
                                disabled={actionLoading === c.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                {actionLoading === c.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-3 w-3" />
                                )}
                                Approve
                              </button>
                              <button
                                onClick={() => setRejectModalId(c.id)}
                                disabled={actionLoading === c.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                              >
                                <X className="h-3 w-3" />
                                Reject
                              </button>
                            </>
                          )}
                          {c.status === "approved" && (
                            <button
                              onClick={() => handleAction("pay", c.id)}
                              disabled={actionLoading === c.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50"
                            >
                              {actionLoading === c.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CreditCard className="h-3 w-3" />
                              )}
                              Mark Paid
                            </button>
                          )}
                          {(c.status === "paid" || c.status === "rejected") && (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 text-xs">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-slate-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Reject Modal */}
      {rejectModalId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Reject Commission</h3>
            <p className="mt-1 text-sm text-slate-500">Provide a reason for rejecting this commission.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Customer was not acquired by this agent..."
              className="mt-4 w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              rows={3}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setRejectModalId(null); setRejectReason(""); }}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction("reject", rejectModalId, rejectReason)}
                disabled={!rejectReason.trim() || actionLoading === rejectModalId}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {actionLoading === rejectModalId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
