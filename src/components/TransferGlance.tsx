"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/src/lib/apiFetch";
import { TransferStatusBadge } from "@/src/components/TransferStatusBadge";

interface TransferDetailResponse {
  status: string | null;
  send_amount: number | null;
  send_currency: string | null;
  receive_amount: number | null;
  receive_currency: string | null;
  beneficiary_name: string | null;
  data_field_id: string | null;
  created_at: string | null;
  tayo_date_paid: string | null;
}

interface TransferGlanceData {
  status: string | null;
  sendAmount: string | null;
  sendCurrency: string | null;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  beneficiaryName: string | null;
  tayoRef: string | null;
  createdAt: string | null;
  tayoDatePaid: string | null;
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export interface TransferGlanceProps {
  transferId: number;
}

function formatAmount(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TransferGlance({ transferId }: TransferGlanceProps) {
  const [data, setData] = useState<TransferGlanceData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setData(null);

    apiFetch(`/api/transfers/details/${transferId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { transfer?: TransferDetailResponse };
        if (!body.transfer) throw new Error("missing transfer");
        return body.transfer;
      })
      .then((t) => {
        if (cancelled) return;
        setData({
          status: t.status,
          sendAmount: formatAmount(t.send_amount),
          sendCurrency: t.send_currency,
          receiveAmount: formatAmount(t.receive_amount),
          receiveCurrency: t.receive_currency,
          beneficiaryName: t.beneficiary_name,
          tayoRef: t.data_field_id,
          createdAt: t.created_at,
          tayoDatePaid: t.tayo_date_paid,
        });
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [transferId]);

  if (phase === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading transfer details"
        className="mt-2 h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100"
      />
    );
  }

  if (phase === "error" || !data) return null;

  const beneficiary = data.beneficiaryName ?? "Unknown";
  const amounts =
    data.sendAmount && data.sendCurrency && data.receiveAmount && data.receiveCurrency
      ? `${data.sendAmount} ${data.sendCurrency} → ${data.receiveAmount} ${data.receiveCurrency}`
      : null;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TransferStatusBadge status={data.status} />
        {amounts && (
          <span className="text-xs font-medium text-slate-700">{amounts}</span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        <span>Beneficiary: {beneficiary}</span>
        {data.tayoRef && (
          <>
            <span className="mx-2 text-slate-300">•</span>
            <span>
              Tayo: <span className="font-mono text-slate-600">{data.tayoRef}</span>
            </span>
          </>
        )}
      </div>
      {(data.createdAt || data.tayoDatePaid) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          {data.createdAt && (
            <span>
              <span className="text-slate-400">Created:</span> {formatDateTime(data.createdAt)}
            </span>
          )}
          {data.tayoDatePaid && (
            <span className="text-emerald-600">
              <span className="text-emerald-500/70">Deposited:</span> {formatDateTime(data.tayoDatePaid)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
