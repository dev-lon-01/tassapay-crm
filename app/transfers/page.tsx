"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search, SearchX } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

// ─── types ────────────────────────────────────────────────────────────────────

interface ApiTransfer {
  id: number;
  transaction_ref: string | null;
  data_field_id: string | null;
  created_at: string;
  send_amount: number | null;
  send_currency: string | null;
  receive_amount: number | null;
  receive_currency: string | null;
  destination_country: string | null;
  beneficiary_name: string | null;
  status: string | null;
  hold_reason: string | null;
  customer_id: string;
  full_name: string | null;
  customer_country: string | null;
}

interface PaginatedResponse {
  data: ApiTransfer[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface Filters {
  search: string;
  status: string;
  country: string;
  slaFilter: string; // "" | "late_standard" | "late_somalia"
}

// ─── country flags ────────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  "United Kingdom": "🇬🇧",
  Germany: "🇩🇪",
  France: "🇫🇷",
  Italy: "🇮🇹",
  Sweden: "🇸🇪",
  Netherlands: "🇳🇱",
  Belgium: "🇧🇪",
  Norway: "🇳🇴",
  Denmark: "🇩🇰",
  Finland: "🇫🇮",
  Switzerland: "🇨🇭",
  Austria: "🇦🇹",
  Ireland: "🇮🇪",
  Portugal: "🇵🇹",
  Spain: "🇪🇸",
  Greece: "🇬🇷",
  Poland: "🇵🇱",
  "Czech Republic": "🇨🇿",
  Hungary: "🇭🇺",
  Romania: "🇷🇴",
  "United States": "🇺🇸",
  USA: "🇺🇸",
  Canada: "🇨🇦",
  Australia: "🇦🇺",
  Somalia: "🇸🇴",
  Ethiopia: "🇪🇹",
  Kenya: "🇰🇪",
  Nigeria: "🇳🇬",
  Ghana: "🇬🇭",
  Eritrea: "🇪🇷",
  Djibouti: "🇩🇯",
  UAE: "🇦🇪",
  "Saudi Arabia": "🇸🇦",
  "South Africa": "🇿🇦",
};

function flagFor(country: string | null): string {
  return COUNTRY_FLAGS[country ?? ""] ?? "🌍";
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (!amount || !currency) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// ─── status badge ─────────────────────────────────────────────────────────────

const PROCESSED = new Set(["Completed", "Deposited", "Paid"]);
const CANCELLED = new Set(["Cancelled", "Cancel", "Rejected"]);

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
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

// ─── filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
  onSlaFilter: (sla: string) => void;
  countries: string[];
}

function FilterBar({ filters, onChange, onSlaFilter, countries }: FilterBarProps) {
  const selectCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by ref, name, email, or phone…"
          value={filters.search}
          onChange={(e) => onChange("search", e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={filters.status}
          onChange={(e) => { onChange("status", e.target.value); onChange("slaFilter", ""); }}
          className={selectCls}
        >
          <option value="not-paid">Not Paid</option>
          <option value="in-progress">In Progress</option>
          <option value="paid">Paid</option>
          <option value="action-required">Action Required</option>
          <option value="all">All Statuses</option>
        </select>
        <select
          value={filters.country}
          onChange={(e) => onChange("country", e.target.value)}
          className={selectCls}
        >
          <option value="All">All Destinations</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {flagFor(c)} {c}
            </option>
          ))}
        </select>
      </div>
      {/* SLA Quick Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          <AlertTriangle className="h-3.5 w-3.5" /> SLA Alerts
        </span>
        <button
          onClick={() => onSlaFilter(filters.slaFilter === "late_standard" ? "" : "late_standard")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            filters.slaFilter === "late_standard"
              ? "border-amber-500 bg-amber-500 text-white shadow-sm"
              : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
          }`}
        >
          ⚠️ Late Transfers (&gt; 24 Hrs)
        </button>
        <button
          onClick={() => onSlaFilter(filters.slaFilter === "late_somalia" ? "" : "late_somalia")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            filters.slaFilter === "late_somalia"
              ? "border-red-500 bg-red-500 text-white shadow-sm"
              : "border-red-300 bg-white text-red-700 hover:bg-red-50"
          }`}
        >
          🚨 Late Somalia (&gt; 15 Mins)
        </button>
      </div>
    </div>
  );
}

// ─── pagination ───────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}

function Pagination({ page, pages, total, limit, onPage }: PaginationProps) {
  if (pages <= 1) return null;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const nums: (number | "…")[] = [];
  const delta = 2;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= page - delta && i <= page + delta)) {
      nums.push(i);
    } else if (nums[nums.length - 1] !== "…") {
      nums.push("…");
    }
  }

  const btn = "h-8 min-w-[32px] rounded-lg px-1.5 text-xs font-medium transition";
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm sm:flex-row sm:justify-between">
      <p className="text-xs text-slate-500">
        Showing {from}–{to} of {total.toLocaleString()} transfers
      </p>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={`${btn} border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30`}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => onPage(n)}
              className={`${btn} ${
                n === page
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {n}
            </button>
          )
        )}
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className={`${btn} border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30`}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── mobile card ──────────────────────────────────────────────────────────────

function TransferCard({ transfer }: { transfer: ApiTransfer }) {
  const router = useRouter();
  return (
    <article
      onClick={() => router.push(`/customer/${transfer.customer_id}`)}
      className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-3xl leading-none">{flagFor(transfer.customer_country)}</span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {transfer.full_name ?? "—"}
            </p>
            <p className="text-xs text-slate-500">#{transfer.customer_id}</p>
          </div>
        </div>
        <StatusBadge status={transfer.status} />
      </div>
      <div className="space-y-1 text-xs text-slate-600">
        {transfer.transaction_ref && (
          <p>
            <span className="font-medium text-slate-400">TassaPay: </span>
            <span className="font-mono">{transfer.transaction_ref}</span>
          </p>
        )}
        {transfer.data_field_id && (
          <p>
            <span className="font-medium text-slate-400">Tayo: </span>
            <span className="font-mono">{transfer.data_field_id}</span>
          </p>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {flagFor(transfer.destination_country)} {transfer.destination_country ?? "—"}
        </span>
        <span className="font-semibold text-slate-700">
          {formatAmount(transfer.send_amount, transfer.send_currency)}
        </span>
        <span>{formatDate(transfer.created_at)}</span>
      </div>
    </article>
  );
}

// ─── desktop table row ────────────────────────────────────────────────────────

function TransferRow({ transfer }: { transfer: ApiTransfer }) {
  const router = useRouter();
  return (
    <tr
      className="group cursor-pointer border-t border-slate-100 transition hover:bg-slate-50/70"
      onClick={() => router.push(`/customer/${transfer.customer_id}`)}
    >
      <td className="whitespace-nowrap py-3 pl-5 pr-3 text-xs text-slate-500">
        {formatDate(transfer.created_at)}
      </td>
      <td className="px-3 py-3 font-mono text-xs text-slate-700">
        {transfer.transaction_ref ?? <span className="italic text-slate-400">—</span>}
      </td>
      <td className="px-3 py-3 font-mono text-xs text-slate-500">
        {transfer.data_field_id ?? <span className="italic text-slate-400">—</span>}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{flagFor(transfer.customer_country)}</span>
          <span className="text-sm font-semibold text-slate-800">
            {transfer.full_name ?? "—"}
          </span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-600">
        {flagFor(transfer.destination_country)} {transfer.destination_country ?? "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-700">
        {formatAmount(transfer.send_amount, transfer.send_currency)}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={transfer.status} />
      </td>
      <td className="py-3 pl-3 pr-5">
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/customer/${transfer.customer_id}`); }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 opacity-0 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 group-hover:opacity-100"
        >
          View <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <SearchX className="h-10 w-10 text-slate-300" />
      <div>
        <p className="text-sm font-semibold text-slate-700">No transfers found</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Try adjusting your filters or search query.
        </p>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

const LIMIT = 50;

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<ApiTransfer[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    status: "not-paid",
    country: "All",
    slaFilter: "",
  });

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  }

  function applySlaFilter(sla: string) {
    // Activating an SLA filter overrides the status dropdown to prevent conflicts
    setFilters((prev) => ({
      ...prev,
      slaFilter: sla,
      status: sla ? "all" : prev.status,
    }));
    setCurrentPage(1);
  }

  // Populate destination country dropdown once on mount
  useEffect(() => {
    apiFetch("/api/transfers?distinct_countries=1")
      .then((r) => r.json())
      .then((data: string[]) => setCountries(data))
      .catch(() => {});
  }, []);

  // Fetch transfers whenever filters or page change
  useEffect(() => {
    const timer = setTimeout(
      () => {
        setLoading(true);
        const params = new URLSearchParams();
        params.set("status", filters.status);
        if (filters.country !== "All") params.set("country", filters.country);
        if (filters.search.trim()) params.set("search", filters.search.trim());
        params.set("page", String(currentPage));
        params.set("limit", String(LIMIT));
        if (filters.slaFilter) params.set("sla_filter", filters.slaFilter);

        apiFetch(`/api/transfers?${params}`)
          .then((r) => r.json())
          .then((res: PaginatedResponse) => {
            setTransfers(res.data ?? []);
            setTotal(res.total ?? 0);
            setPages(res.pages ?? 1);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      },
      filters.search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [filters, currentPage]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Transfers
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? "Loading…" : `${total.toLocaleString()} transfer${total === 1 ? "" : "s"}`}
        </p>
      </div>

      <FilterBar filters={filters} onChange={updateFilter} onSlaFilter={applySlaFilter} countries={countries} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading transfers…</span>
        </div>
      ) : transfers.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 md:hidden">
            {transfers.map((t) => (
              <TransferCard key={t.id} transfer={t} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm md:block">
            <table className="w-full table-auto text-left">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 pl-5 pr-3">Date</th>
                  <th className="px-3 py-3">TassaPay Ref</th>
                  <th className="px-3 py-3">Tayo Ref</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Destination</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="py-3 pl-3 pr-5" />
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <TransferRow key={t.id} transfer={t} />
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={currentPage}
            pages={pages}
            total={total}
            limit={LIMIT}
            onPage={setCurrentPage}
          />
        </>
      )}
    </div>
  );
}
