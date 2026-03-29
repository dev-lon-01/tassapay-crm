export type NormalizedPaymentStatus = "success" | "failed" | "refunded";

export interface PaymentRecord {
  id: number;
  provider: string;
  provider_payment_id: string;
  transfer_ref: string | null;
  payment_type: string;
  payment_method: string | null;
  amount: number | null;
  currency: string | null;
  status: NormalizedPaymentStatus;
  provider_status: string | null;
  payment_date: string | null;
}

export interface TransferSummary {
  id: number;
  transaction_ref: string | null;
  data_field_id?: string | null;
  send_amount: number | null;
  send_currency: string | null;
  status: string | null;
}

export interface PaymentDiscrepancy {
  type: "amount_mismatch" | "gateway_failed" | "gateway_refunded" | "status_conflict";
  severity: "warning" | "danger";
  label: string;
  message: string;
}

const SUCCESS_KEYWORDS = [
  "success",
  "succeeded",
  "approved",
  "paid",
  "captured",
  "settled",
  "complete",
  "completed",
  "processed",
  "received",
];

const REFUND_KEYWORDS = ["refund", "refunded", "chargeback", "reversed", "reversal"];
const FAILED_KEYWORDS = ["fail", "failed", "declined", "reject", "cancel", "void", "error"];
const PAID_TRANSFER_STATUSES = new Set(["Deposited", "Completed", "Paid"]);
const UNPAID_TRANSFER_STATUSES = new Set(["Pending", "Hold", "Processed", "Ready", "Action Required"]);

export function normalizePaymentStatus(
  providerStatus: string | null | undefined,
  paymentType: string | null | undefined,
): NormalizedPaymentStatus {
  const type = (paymentType ?? "").toLowerCase();
  const raw = (providerStatus ?? "").toLowerCase();

  if (type.includes("refund") || REFUND_KEYWORDS.some((keyword) => raw.includes(keyword))) {
    return "refunded";
  }

  if (SUCCESS_KEYWORDS.some((keyword) => raw.includes(keyword))) {
    return "success";
  }

  if (FAILED_KEYWORDS.some((keyword) => raw.includes(keyword))) {
    return "failed";
  }

  return "failed";
}

function sumAmounts(payments: PaymentRecord[], status: NormalizedPaymentStatus): number {
  return payments
    .filter((payment) => payment.status === status)
    .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);
}

export function buildPaymentDiscrepancies(
  transfer: TransferSummary,
  payments: PaymentRecord[],
): PaymentDiscrepancy[] {
  if (payments.length === 0) return [];

  const issues: PaymentDiscrepancy[] = [];
  const expectedAmount = Number(transfer.send_amount ?? 0);
  const successfulAmount = sumAmounts(payments, "success");
  const refundedAmount = sumAmounts(payments, "refunded");
  const hasFailed = payments.some((payment) => payment.status === "failed");
  const hasRefund = refundedAmount > 0;
  const transferStatus = transfer.status ?? "Unknown";

  if (expectedAmount > 0 && successfulAmount > 0 && Math.abs(successfulAmount - expectedAmount) > 0.009) {
    issues.push({
      type: "amount_mismatch",
      severity: "warning",
      label: "Amount Mismatch",
      message: `Gateway success total ${successfulAmount.toFixed(2)} does not match transfer amount ${expectedAmount.toFixed(2)}.`,
    });
  }

  if (hasFailed && PAID_TRANSFER_STATUSES.has(transferStatus)) {
    issues.push({
      type: "gateway_failed",
      severity: "danger",
      label: "Gateway Unsettled",
      message: `Transfer is marked ${transferStatus} but at least one gateway row is failed.`,
    });
  }

  if (hasRefund) {
    issues.push({
      type: "gateway_refunded",
      severity: PAID_TRANSFER_STATUSES.has(transferStatus) ? "danger" : "warning",
      label: "Refund Detected",
      message: `Gateway refunds totaling ${refundedAmount.toFixed(2)} were recorded for this transfer.`,
    });
  }

  if (successfulAmount > 0 && UNPAID_TRANSFER_STATUSES.has(transferStatus)) {
    issues.push({
      type: "status_conflict",
      severity: "warning",
      label: "Status Conflict",
      message: `Gateway shows a successful payment while transfer status is still ${transferStatus}.`,
    });
  }

  return issues;
}
