"use client";

const PROCESSED = new Set(["Completed", "Deposited", "Paid"]);
const CANCELLED = new Set(["Cancelled", "Cancel", "Rejected"]);

export interface TransferStatusBadgeProps {
  status: string | null;
  /** Rendered when status is null. Defaults to em-dash. */
  emptyValue?: string;
}

export function TransferStatusBadge({
  status,
  emptyValue = "—",
}: TransferStatusBadgeProps) {
  if (!status) {
    return <span className="text-xs text-slate-400">{emptyValue}</span>;
  }
  if (PROCESSED.has(status)) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        {status}
      </span>
    );
  }
  if (CANCELLED.has(status)) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      {status}
    </span>
  );
}
