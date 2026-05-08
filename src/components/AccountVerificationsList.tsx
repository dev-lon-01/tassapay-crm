"use client";

import { useEffect, useState } from "react";
import { Check, Landmark, Wallet } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

type Verification = {
  id: number;
  lookup: {
    id: number;
    methodCode: string;
    methodType: "bank" | "wallet";
    accountNumber: string;
    accountName: string;
  };
  attachedBy: { id: number; name: string | null };
  attachedAt: string;
};

export interface AccountVerificationsListProps {
  targetType: "transfer" | "customer";
  targetId: string;
  /** Increment to trigger a refetch (e.g. after a new attach). */
  refreshKey?: number;
}

export function AccountVerificationsList({
  targetType,
  targetId,
  refreshKey = 0,
}: AccountVerificationsListProps) {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(
      `/api/account-lookup/verifications?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`
    )
      .then(async (r) => (r.ok ? ((await r.json()) as Verification[]) : []))
      .then((rows) => {
        if (!cancelled) setVerifications(rows);
      })
      .catch(() => {
        if (!cancelled) setVerifications([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId, refreshKey]);

  if (loading) return null;
  if (verifications.length === 0) return null;

  return (
    <section className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-emerald-800">
        <Check className="h-4 w-4" />
        <h2 className="text-sm font-semibold">
          Verified accounts ({verifications.length})
        </h2>
      </div>
      <ul className="mt-3 space-y-2">
        {verifications.map((v) => (
          <li
            key={v.id}
            className="rounded-xl border border-emerald-100 bg-white p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{v.lookup.accountName}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                  {v.lookup.methodType === "wallet" ? (
                    <Wallet className="h-3 w-3" />
                  ) : (
                    <Landmark className="h-3 w-3" />
                  )}
                  <span className="font-medium text-slate-700">
                    {v.lookup.methodCode}
                  </span>
                  <span>•</span>
                  <span className="font-mono">{v.lookup.accountNumber}</span>
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-slate-500">
                <p>by {v.attachedBy.name ?? "Unknown"}</p>
                <p>{new Date(v.attachedAt).toLocaleString("en-GB")}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
