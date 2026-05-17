"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  ArrowRightLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  CalendarDays,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

// ─── types ────────────────────────────────────────────────────────────────────

interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped?: number;
  syncLogId?: number;
  error?: string;
}

interface SyncLogEntry {
  id: number;
  started_at: string;
  type: string | null;
  finished_at: string | null;
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  status: "running" | "success" | "error";
  error_message: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function durationSecs(start: string, end: string | null): string {
  if (!end) return "-";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "-";
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── sync panel ───────────────────────────────────────────────────────────────

interface SyncPanelProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  onSyncComplete: () => void;
  accentClass: string;
  btnClass: string;
  idPullEndpoint?: string;
  idPullLabel?: string;
  idPullCheckboxLabel?: string;
}

function SyncPanel({
  title,
  description,
  icon,
  endpoint,
  onSyncComplete,
  accentClass,
  btnClass,
  idPullEndpoint,
  idPullLabel,
  idPullCheckboxLabel,
}: SyncPanelProps) {
  const [fromDate, setFromDate] = useState(daysAgoISO(30));
  const [toDate, setToDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [idPullMode, setIdPullMode] = useState(false);

  async function runSync() {
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const url = idPullMode && idPullEndpoint
        ? `${idPullEndpoint}?${params}`
        : `${endpoint}?${params}`;
      const res = await apiFetch(url, { method: "POST" });
      const data: SyncResult = await res.json();
      setResult(data);
      if (!data.error) onSyncComplete();
    } catch (e) {
      setResult({ fetched: 0, inserted: 0, updated: 0, error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";

  return (
    <div className={`rounded-2xl border-2 ${accentClass} bg-white p-5 shadow-sm`}>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
            From date
          </label>
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
            To date
          </label>
          <input
            type="date"
            value={toDate}
            max={todayISO()}
            onChange={(e) => setToDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {idPullEndpoint && (
        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
            checked={idPullMode}
            onChange={(e) => setIdPullMode(e.target.checked)}
          />
          {idPullCheckboxLabel ?? "Pull legacy ID documents instead of customer profiles"}
        </label>
      )}

      <button
        onClick={runSync}
        disabled={loading}
        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${btnClass}`}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {idPullMode && idPullLabel ? `${idPullLabel}…` : "Syncing..."}
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" />
            {idPullMode && idPullLabel ? idPullLabel : "Start Sync"}
          </>
        )}
      </button>

      {result && (
        <div
          className={`mt-3 rounded-xl px-4 py-3 text-sm ${
            result.error
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {result.error ? (
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all text-xs font-medium">{result.error}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Fetched <strong>{result.fetched.toLocaleString()}</strong> ·
                Inserted <strong>{result.inserted.toLocaleString()}</strong> ·
                Updated <strong>{result.updated.toLocaleString()}</strong>
                {result.skipped !== undefined && result.skipped > 0
                  ? ` · Skipped ${result.skipped}`
                  : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SyncLogEntry["status"] }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Success
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        <XCircle className="h-3 w-3" /> Error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
      <Clock className="h-3 w-3" /> Running
    </span>
  );
}

function TypeBadge({ type }: { type: string | null }) {
  if (type === "customers")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
        <Users className="h-3 w-3" /> Customers
      </span>
    );
  if (type === "transfers")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
        <ArrowRightLeft className="h-3 w-3" /> Transfers
      </span>
    );
  return <span className="text-xs text-slate-400">{type ?? "-"}</span>;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SyncPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const fetchLogs = useCallback(() => {
    setLogsLoading(true);
    apiFetch("/api/sync/logs")
      .then((r) => r.json())
      .then((data: SyncLogEntry[]) => setLogs(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (user && user.role !== "Admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">Access Restricted</p>
          <p className="mt-1 text-xs text-slate-500">Only Admins can trigger manual syncs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Manual Sync</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Pull the latest data from the TassaPay backoffice into the CRM database.
        </p>
      </div>

      {/* Sync panels */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <SyncPanel
          title="Sync Customers"
          description="Fetches customer records from the backoffice Customer search API."
          icon={<Users className="h-5 w-5" />}
          endpoint="/api/sync/customers"
          idPullEndpoint="/api/sync/customer-ids"
          idPullLabel="Pull ID Documents"
          idPullCheckboxLabel="Pull legacy ID documents instead of customer profiles"
          onSyncComplete={fetchLogs}
          accentClass="border-blue-300"
          btnClass="bg-blue-600 hover:bg-blue-700"
        />
        <SyncPanel
          title="Sync Transfers"
          description="Fetches transfer records from the Transaction_Search API."
          icon={<ArrowRightLeft className="h-5 w-5" />}
          endpoint="/api/sync/transfers"
          onSyncComplete={fetchLogs}
          accentClass="border-purple-300"
          btnClass="bg-purple-600 hover:bg-purple-700"
        />
      </div>

      {/* Sync log */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Recent Sync Log</h2>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-3 w-3 ${logsLoading ? "animate-spin" : ""}`} />
            Refresh log
          </button>
        </div>

        {logsLoading && logs.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading logs...</span>
          </div>
        ) : logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No sync runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80">
                  {["Started", "Type", "Status", "Duration", "Fetched", "Inserted", "Updated", "Error"].map(
                    (h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 first:pl-5 last:pr-5"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap py-3 pl-5 pr-4 text-xs text-slate-600">
                      {fmtDateTime(log.started_at)}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={log.type} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {durationSecs(log.started_at, log.finished_at)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-700">
                      {log.records_fetched?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-emerald-700">
                      {log.records_inserted?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-blue-700">
                      {log.records_updated?.toLocaleString() ?? "-"}
                    </td>
                    <td className="max-w-xs truncate py-3 pl-4 pr-5 text-xs text-red-600">
                      {log.error_message ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
