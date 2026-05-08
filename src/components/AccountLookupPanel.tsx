"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Search, AlertTriangle, Wallet, Landmark } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

type SupportedMethod = {
  type: "bank" | "wallet";
  code: string;
  label: string;
};

type LookupResponse = {
  lookupId: number | null;
  status: "success" | "failed" | "error";
  accountName: string | null;
  responseCode: string | null;
  responseDescription: string | null;
};

export type AttachContext =
  | { targetType: "transfer"; targetId: string; label: string }
  | { targetType: "customer"; targetId: string; label: string };

export interface AccountLookupPanelProps {
  attachContext?: AttachContext;
  onAttached?: () => void;
}

const COUNTRIES = [{ code: "ET", label: "Ethiopia" }] as const;

export function AccountLookupPanel({ attachContext, onAttached }: AccountLookupPanelProps) {
  const [country, setCountry] = useState<"ET">("ET");
  const [methods, setMethods] = useState<SupportedMethod[]>([]);
  const [methodCode, setMethodCode] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachedAt, setAttachedAt] = useState<string | null>(null);

  // Load methods when country changes.
  useEffect(() => {
    let cancelled = false;
    setMethods([]);
    setMethodCode("");
    apiFetch(`/api/account-lookup/banks?country=${country}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { methods: SupportedMethod[] }) => {
        if (!cancelled) setMethods(j.methods);
      })
      .catch((e) => {
        if (!cancelled) setResultError(`Failed to load bank list: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [country]);

  const visibleMethods = useMemo(() => {
    const f = methodFilter.trim().toLowerCase();
    if (!f) return methods;
    return methods.filter((m) => m.label.toLowerCase().includes(f));
  }, [methods, methodFilter]);

  const selected = useMemo(
    () => methods.find((m) => m.code === methodCode) ?? null,
    [methods, methodCode]
  );

  const canSubmit = !!selected && accountNumber.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    setResult(null);
    setResultError(null);
    setAttachedAt(null);
    try {
      const r = await apiFetch("/api/account-lookup", {
        method: "POST",
        body: JSON.stringify({
          country,
          methodType: selected.type,
          methodCode: selected.code,
          accountNumber: accountNumber.trim(),
        }),
      });
      const j = (await r.json()) as LookupResponse | { error: string };
      if (!r.ok && r.status !== 502) {
        setResultError("error" in j ? j.error : `HTTP ${r.status}`);
        return;
      }
      setResult(j as LookupResponse);
    } catch (e) {
      setResultError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!result?.accountName) return;
    try {
      await navigator.clipboard.writeText(result.accountName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can still select the text
    }
  }

  async function handleAttach() {
    if (!result?.lookupId || !attachContext || result.status !== "success") return;
    setAttaching(true);
    try {
      const r = await apiFetch(`/api/account-lookup/${result.lookupId}/attach`, {
        method: "POST",
        body: JSON.stringify({
          targetType: attachContext.targetType,
          targetId: attachContext.targetId,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setResultError(j.error ?? `Attach failed: HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { attachedAt: string };
      setAttachedAt(j.attachedAt);
      onAttached?.();
    } finally {
      setAttaching(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Search className="h-5 w-5 text-emerald-600" />
        <h2 className="text-lg font-bold text-slate-900">Account Lookup</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Verify a beneficiary's bank or wallet account before sending funds.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {/* Country */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Country</label>
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={country}
            onChange={(e) => setCountry(e.target.value as "ET")}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Method */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Bank / Wallet</label>
          <input
            type="text"
            placeholder="Filter by name…"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <select
            size={6}
            value={methodCode}
            onChange={(e) => setMethodCode(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {visibleMethods.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}  ({m.type})
              </option>
            ))}
          </select>
          {selected && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {selected.type === "wallet" ? <Wallet className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
              {selected.label}
            </p>
          )}
        </div>

        {/* Account number */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Account number</label>
          <input
            type="text"
            inputMode="numeric"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
            placeholder="e.g. 1000188695168"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {submitting ? "Looking up…" : "Look up"}
        </button>
      </form>

      {/* Result */}
      {resultError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{resultError}</span>
        </div>
      )}

      {result?.status === "success" && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Account holder</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xl font-bold">{result.accountName}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-700"
            >
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>
          <p className="mt-1 text-xs text-emerald-800">
            {selected?.label} • {accountNumber} • response {result.responseCode ?? "—"}
          </p>

          {attachContext && !attachedAt && (
            <button
              type="button"
              onClick={handleAttach}
              disabled={attaching}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {attaching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Attach to {attachContext.label}
            </button>
          )}
          {attachedAt && (
            <p className="mt-3 inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <Check className="h-3 w-3" /> Attached to {attachContext?.label}
            </p>
          )}
        </div>
      )}

      {result?.status === "failed" && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">Lookup failed</p>
          <p className="mt-1">
            {result.responseDescription ?? "Account not found, or the bank/account combination is invalid."}
          </p>
        </div>
      )}

      {result?.status === "error" && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Service temporarily unavailable</p>
          <p className="mt-1">{result.responseDescription ?? "Try again in a moment."}</p>
        </div>
      )}
    </section>
  );
}
