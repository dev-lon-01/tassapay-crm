"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CreditCard, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

interface PaymentRow {
  id: number;
  provider: string;
  provider_payment_id: string;
  transfer_ref: string | null;
  transfer_id: number | null;
  payment_type: string;
  payment_method: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  provider_status: string | null;
  payment_date: string | null;
  is_reconciled: number | boolean;
  reconciliation_note: string | null;
}

interface PaymentsResponse {
  data: PaymentRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

function formatAmount(amount: number | null, currency: string | null) {
  if (amount == null) return "-";
  if (!currency) return amount.toFixed(2);

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const styles =
    normalized === "success"
      ? "bg-emerald-100 text-emerald-700"
      : normalized === "refunded"
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-700";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles}`}>
      {value}
    </span>
  );
}

const LIMIT = 50;

export default function AdminPaymentsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (user && user.role !== "Admin") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (user?.role !== "Admin") return;

    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (search.trim()) params.set("search", search.trim());

      apiFetch(`/api/payments?${params.toString()}`)
        .then((response) => response.json())
        .then((data: PaymentsResponse) => {
          setPayments(Array.isArray(data.data) ? data.data : []);
          setTotal(data.total ?? 0);
          setPages(data.pages ?? 1);
        })
        .finally(() => setLoading(false));
    }, search ? 250 : 0);

    return () => window.clearTimeout(timer);
  }, [page, search, user]);

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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? "Loading..." : `${total.toLocaleString()} reconciliation row${total === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by transfer ref or payment id..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading payments...</span>
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <CreditCard className="h-10 w-10 text-slate-200" />
            <div>
              <p className="text-sm font-semibold text-slate-700">No payment rows found</p>
              <p className="mt-1 text-xs text-slate-500">Import gateway CSV files to populate reconciliation data.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1250px] w-full table-auto text-left">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 pl-5 pr-3">Transfer Ref</th>
                  <th className="px-3 py-3">Provider</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Currency</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Reconciled</th>
                  <th className="px-3 py-3">Provider Status</th>
                  <th className="px-3 py-3">Payment ID</th>
                  <th className="px-3 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-slate-100 text-sm text-slate-700">
                    <td className="py-3 pl-5 pr-3 font-mono text-xs">
                      {payment.transfer_id ? (
                        <button
                          onClick={() => router.push(`/transfers/${payment.transfer_id}`)}
                          className="text-emerald-700 hover:text-emerald-800 hover:underline"
                        >
                          {payment.transfer_ref ?? "-"}
                        </button>
                      ) : (
                        payment.transfer_ref ?? "-"
                      )}
                    </td>
                    <td className="px-3 py-3 capitalize">{payment.provider}</td>
                    <td className="px-3 py-3">{payment.payment_method ?? "-"}</td>
                    <td className="px-3 py-3 capitalize">{payment.payment_type}</td>
                    <td className="px-3 py-3 font-semibold">{formatAmount(payment.amount, payment.currency)}</td>
                    <td className="px-3 py-3">{payment.currency ?? "-"}</td>
                    <td className="px-3 py-3"><StatusBadge value={payment.status} /></td>
                    <td className="px-3 py-3">
                      {payment.is_reconciled ? (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Matched</span>
                      ) : (
                        <div>
                          <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">Unreconciled</span>
                          {payment.reconciliation_note && (
                            <p className="mt-1 text-xs text-rose-600">{payment.reconciliation_note}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">{payment.provider_status ?? "-"}</td>
                    <td className="px-3 py-3 font-mono text-xs">{payment.provider_payment_id}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDate(payment.payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">Page {page} of {pages}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((current) => Math.min(pages, current + 1))}
              disabled={page === pages}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
