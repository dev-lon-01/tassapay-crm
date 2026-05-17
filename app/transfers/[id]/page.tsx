"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CreditCard, Loader2, Settings } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { AccountLookupPanel } from "@/src/components/AccountLookupPanel";
import { AccountVerificationsList } from "@/src/components/AccountVerificationsList";

interface TransferDetail {
  id: number;
  customer_id: string;
  transaction_ref: string | null;
  data_field_id: string | null;
  created_at: string | null;
  tayo_date_paid: string | null;
  sender_name: string | null;
  email_id: string | null;
  purpose: string | null;
  transfer_fees: number | null;
  amount_in_gbp: number | null;
  exchange_rate: number | null;
  branch: string | null;
  delivery_type: string | null;
  api_branch_details: string | null;
  beneficiary_id: string | null;
  beneficiary_mobile: string | null;
  benf_account_holder_name: string | null;
  benf_account_number: string | null;
  benf_bank_name: string | null;
  benf_street: string | null;
  send_amount: number | null;
  send_currency: string | null;
  receive_amount: number | null;
  receive_currency: string | null;
  destination_country: string | null;
  beneficiary_name: string | null;
  status: string | null;
  hold_reason: string | null;
  payment_method: string | null;
  delivery_method: string | null;
  reconciliation_status: string | null;
  accounting_category: string | null;
  manual_adjustment_note: string | null;
  full_name: string | null;
  customer_country: string | null;
}

interface PaymentRow {
  id: number;
  provider: string;
  provider_payment_id: string;
  transfer_ref: string | null;
  payment_type: string;
  payment_method: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  provider_status: string | null;
  payment_date: string | null;
}

interface PaymentDiscrepancy {
  type: string;
  severity: "warning" | "danger";
  label?: string;
  message: string;
}

interface TransferDetailResponse {
  transfer: TransferDetail;
  payments: PaymentRow[];
  discrepancies: PaymentDiscrepancy[];
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

function statusClasses(status: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  if (["paid", "completed", "deposited", "success"].includes(normalized)) {
    return "bg-emerald-100 text-emerald-700";
  }
  if (["refunded", "refund"].includes(normalized)) {
    return "bg-amber-100 text-amber-700";
  }
  if (["failed", "cancelled", "canceled", "rejected"].includes(normalized)) {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-slate-100 text-slate-700";
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === null || value === undefined || value === "" ? "-" : String(value);
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right break-words">{display}</span>
    </div>
  );
}

export default function TransferDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<TransferDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verificationsKey, setVerificationsKey] = useState(0);

  // Manual reconciliation form state
  const [recoCategory, setRecoCategory] = useState("");
  const [recoNote, setRecoNote] = useState("");
  const [recoSaving, setRecoSaving] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  const fetchTransfer = () => {
    setLoading(true);
    setError(null);

    apiFetch(`/api/transfers/details/${params.id}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? "Failed to load transfer");
        }
        return response.json();
      })
      .then((payload: TransferDetailResponse) => setData(payload))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load transfer"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTransfer();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading transfer...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/transfers")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Back to transfers
        </button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
          {error ?? "Transfer not found"}
        </div>
      </div>
    );
  }

  const { transfer, payments, discrepancies } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <button
            onClick={() => router.push("/transfers")}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Back to transfers
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {transfer.transaction_ref ?? `Transfer #${transfer.id}`}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Customer {transfer.full_name ?? "Unknown"} - {transfer.destination_country ?? "Unknown destination"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex rounded-full px-3 py-1.5 text-sm font-semibold ${statusClasses(transfer.status)}`}>
            {transfer.status ?? "Unknown"}
          </span>
          <button
            onClick={() => router.push(`/customer/${transfer.customer_id}`)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm"
          >
            View customer
          </button>
        </div>
      </div>

      {discrepancies.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-sm font-bold uppercase tracking-wide">Reconciliation warnings</h2>
          </div>
          <div className="space-y-2">
            {discrepancies.map((issue) => (
              <div
                key={`${issue.type}-${issue.message}`}
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${issue.severity === "danger" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-white text-amber-800"}`}
              >
                {issue.label && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${issue.severity === "danger" ? "bg-rose-200 text-rose-800" : "bg-amber-200 text-amber-900"}`}>
                    {issue.label}
                  </span>
                )}
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Send Amount" value={formatAmount(transfer.send_amount, transfer.send_currency)} />
        <StatCard label="Receive Amount" value={formatAmount(transfer.receive_amount, transfer.receive_currency)} />
        <StatCard label="Beneficiary" value={transfer.beneficiary_name ?? "-"} />
        <StatCard label="Created" value={formatDate(transfer.created_at)} />
        <StatCard label="Deposited" value={formatDate(transfer.tayo_date_paid)} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Sender */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sender</h3>
          <DetailRow label="Name" value={transfer.sender_name} />
          <DetailRow label="Email" value={transfer.email_id} />
        </div>

        {/* Beneficiary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Beneficiary</h3>
          <DetailRow label="Account holder" value={transfer.benf_account_holder_name} />
          <DetailRow label="Account number" value={transfer.benf_account_number} />
          <DetailRow label="Bank" value={transfer.benf_bank_name} />
          <DetailRow label="Mobile" value={transfer.beneficiary_mobile} />
          <DetailRow label="Street" value={transfer.benf_street} />
          <DetailRow label="Payout branch" value={transfer.api_branch_details} />
        </div>

        {/* Payment */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</h3>
          <DetailRow label="Amount (GBP)" value={transfer.amount_in_gbp} />
          <DetailRow label="Exchange rate" value={transfer.exchange_rate} />
          <DetailRow label="Fees" value={transfer.transfer_fees} />
          <DetailRow label="Delivery type" value={transfer.delivery_type} />
          <DetailRow label="Source branch" value={transfer.branch} />
          <DetailRow label="Purpose" value={transfer.purpose} />
        </div>
      </div>

      <AccountVerificationsList
        targetType="transfer"
        targetId={String(transfer.id)}
        refreshKey={verificationsKey}
      />

      <AccountLookupPanel
        attachContext={{
          targetType: "transfer",
          targetId: String(transfer.id),
          label: transfer.transaction_ref ?? `Transfer #${transfer.id}`,
        }}
        onAttached={() => setVerificationsKey((k) => k + 1)}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-900">Payment Gateway Details</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Imported gateway rows matched by transfer reference.
          </p>

          {payments.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Awaiting gateway reconciliation data.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {payments.map((payment) => (
                <article key={payment.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold capitalize text-slate-900">
                        {payment.provider} - {payment.payment_type}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">{payment.provider_payment_id}</p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(payment.status)}`}>
                      {payment.status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Amount</p>
                      <p className="mt-1 font-semibold text-slate-900">{formatAmount(payment.amount, payment.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Method</p>
                      <p className="mt-1">{payment.payment_method ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Provider Status</p>
                      <p className="mt-1">{payment.provider_status ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Transfer Ref</p>
                      <p className="mt-1 font-mono text-xs">{payment.transfer_ref ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Payment Date</p>
                      <p className="mt-1">{formatDate(payment.payment_date)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Transfer Details</h2>
          <div className="mt-4 space-y-4 text-sm text-slate-600">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">TassaPay Ref</p>
              <p className="mt-1 font-mono text-xs text-slate-800">{transfer.transaction_ref ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tayo Ref</p>
              <p className="mt-1 font-mono text-xs text-slate-800">{transfer.data_field_id ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Payment Method</p>
              <p className="mt-1">{transfer.payment_method ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Delivery Method</p>
              <p className="mt-1">{transfer.delivery_method ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hold Reason</p>
              <p className="mt-1 whitespace-pre-wrap">{transfer.hold_reason ?? "-"}</p>
            </div>
          </div>

          {/* Manual Reconciliation Form */}
          {user?.role === "Admin" &&
            (transfer.reconciliation_status === "mismatch" || transfer.reconciliation_status === "pending") && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-900">Manual Reconciliation</h3>
              </div>
              <p className="mt-1 text-xs text-slate-500">Override the reconciliation status for accounting purposes.</p>

              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Accounting Category</label>
                  <select
                    value={recoCategory}
                    onChange={(e) => setRecoCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Select category...</option>
                    <option value="operational_expense">Operational Expense</option>
                    <option value="rounding_difference">Rounding Difference</option>
                    <option value="suspense">Suspense</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Adjustment Note</label>
                  <textarea
                    value={recoNote}
                    onChange={(e) => setRecoNote(e.target.value)}
                    rows={2}
                    placeholder="Explain the adjustment..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                {recoError && <p className="text-xs text-rose-600">{recoError}</p>}

                <button
                  disabled={!recoCategory || recoSaving}
                  onClick={async () => {
                    setRecoSaving(true);
                    setRecoError(null);
                    try {
                      const res = await apiFetch(`/api/transfers/details/${params.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          accounting_category: recoCategory,
                          manual_adjustment_note: recoNote,
                        }),
                      });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.error ?? "Failed to save");
                      }
                      setRecoCategory("");
                      setRecoNote("");
                      fetchTransfer();
                    } catch (err) {
                      setRecoError(err instanceof Error ? err.message : "Failed to save");
                    } finally {
                      setRecoSaving(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {recoSaving ? "Saving..." : "Save Adjustment"}
                </button>
              </div>
            </div>
          )}

          {transfer.reconciliation_status === "manual_adjustment" && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-bold text-slate-900">Manual Adjustment Applied</h3>
              <div className="mt-2 space-y-1 text-sm text-slate-600">
                <p><span className="font-semibold text-slate-700">Category:</span> {transfer.accounting_category?.replace(/_/g, " ") ?? "-"}</p>
                {transfer.manual_adjustment_note && (
                  <p><span className="font-semibold text-slate-700">Note:</span> {transfer.manual_adjustment_note}</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
