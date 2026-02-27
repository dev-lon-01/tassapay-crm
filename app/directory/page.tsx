"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search, SearchX } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

// ─── types ────────────────────────────────────────────────────────────────────

interface ApiCustomer {
  customer_id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  country: string | null;
  registration_date: string | null;
  kyc_completion_date: string | null;
  risk_status: string | null;
  total_transfers: number;
}

interface PaginatedResponse {
  data: ApiCustomer[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface Filters {
  search: string;
  country: string;
  kyc: string;
  transfer: string;
}

// ─── lookup maps ──────────────────────────────────────────────────────────────

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

const DIAL_CODES: Record<string, string> = {
  "United Kingdom": "+44",
  Germany: "+49",
  France: "+33",
  Italy: "+39",
  Sweden: "+46",
  Netherlands: "+31",
  Belgium: "+32",
  Norway: "+47",
  Denmark: "+45",
  Finland: "+358",
  Switzerland: "+41",
  Austria: "+43",
  Ireland: "+353",
  Portugal: "+351",
  Spain: "+34",
  Greece: "+30",
  Poland: "+48",
  "Czech Republic": "+420",
  Hungary: "+36",
  Romania: "+40",
  "United States": "+1",
  USA: "+1",
  Canada: "+1",
  Australia: "+61",
  Somalia: "+252",
  Ethiopia: "+251",
  Kenya: "+254",
  Nigeria: "+234",
  Ghana: "+233",
  Eritrea: "+291",
  Djibouti: "+253",
  UAE: "+971",
  "Saudi Arabia": "+966",
  "South Africa": "+27",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function flagFor(country: string | null): string {
  return COUNTRY_FLAGS[country ?? ""] ?? "🌍";
}

function formatPhone(phone: string | null, country: string | null): string {
  if (!phone) return "—";
  const t = phone.trim();
  if (t.startsWith("+")) return t;
  const code = DIAL_CODES[country ?? ""];
  if (!code) return t;
  const digits = t.startsWith("0") ? t.slice(1) : t;
  return `${code} ${digits}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function kycLabel(c: ApiCustomer): "Completed" | "Pending" {
  return c.kyc_completion_date ? "Completed" : "Pending";
}

// ─── badges ───────────────────────────────────────────────────────────────────

function KycBadge({ status }: { status: "Completed" | "Pending" }) {
  return status === "Completed" ? (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      Completed
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      Pending
    </span>
  );
}

function RiskBadge({ status }: { status: string | null }) {
  return status === "High" ? (
    <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
      High
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
      {status ?? "—"}
    </span>
  );
}

// ─── filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
  countries: string[];
}

function FilterBar({ filters, onChange, countries }: FilterBarProps) {
  const selectCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by name or ID…"
          value={filters.search}
          onChange={(e) => onChange("search", e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <select
          value={filters.country}
          onChange={(e) => onChange("country", e.target.value)}
          className={selectCls}
        >
          <option value="All">All Countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {flagFor(c)} {c}
            </option>
          ))}
        </select>
        <select
          value={filters.kyc}
          onChange={(e) => onChange("kyc", e.target.value)}
          className={selectCls}
        >
          <option value="All">All KYC</option>
          <option value="Pending">Pending</option>
          <option value="Complete">Complete</option>
        </select>
        <select
          value={filters.transfer}
          onChange={(e) => onChange("transfer", e.target.value)}
          className={`${selectCls} col-span-2 md:col-span-1`}
        >
          <option value="All">All Transfers</option>
          <option value="Zero">Zero Transfers</option>
          <option value="HasTransfers">Has Transfers</option>
        </select>
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

  const btn =
    "h-8 min-w-[32px] rounded-lg px-1.5 text-xs font-medium transition";
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm sm:flex-row sm:justify-between">
      <p className="text-xs text-slate-500">
        Showing {from}–{to} of {total.toLocaleString()} customers
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

function CustomerCard({ customer }: { customer: ApiCustomer }) {
  const router = useRouter();
  const phone = formatPhone(customer.phone_number, customer.country);
  return (
    <article
      onClick={() => router.push(`/customer/${customer.customer_id}`)}
      className="flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2.5">
          <span className="text-3xl leading-none">{flagFor(customer.country)}</span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {customer.full_name ?? "—"}
            </p>
            <p className="text-xs text-slate-500">
              #{customer.customer_id} · {customer.country ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <KycBadge status={kycLabel(customer)} />
          <RiskBadge status={customer.risk_status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="font-mono">{phone}</span>
          <span>·</span>
          <span>Reg. {formatDate(customer.registration_date)}</span>
        </div>
      </div>
      <button
        onClick={() => router.push(`/customer/${customer.customer_id}`)}
        aria-label="View profile"
        className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </article>
  );
}

// ─── desktop table row ────────────────────────────────────────────────────────

function CustomerRow({ customer }: { customer: ApiCustomer }) {
  const router = useRouter();
  const phone = formatPhone(customer.phone_number, customer.country);
  return (
    <tr
      className="group cursor-pointer border-t border-slate-100 transition hover:bg-slate-50/70"
      onClick={() => router.push(`/customer/${customer.customer_id}`)}
    >
      <td className="py-3 pl-5 pr-3 font-mono text-xs text-slate-500">
        #{customer.customer_id}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{flagFor(customer.country)}</span>
          <span className="text-sm font-semibold text-slate-800">
            {customer.full_name ?? "—"}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 text-sm text-slate-600">{customer.country ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">
        {phone}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-600">
        {formatDate(customer.registration_date)}
      </td>
      <td className="px-3 py-3">
        <KycBadge status={kycLabel(customer)} />
      </td>
      <td className="px-3 py-3 text-sm text-slate-600">
        {customer.total_transfers === 0 ? (
          <span className="italic text-slate-400">None</span>
        ) : (
          customer.total_transfers
        )}
      </td>
      <td className="px-3 py-3">
        <RiskBadge status={customer.risk_status} />
      </td>
      <td className="py-3 pl-3 pr-5">
        <button
          onClick={() => router.push(`/customer/${customer.customer_id}`)}
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
        <p className="text-sm font-semibold text-slate-700">No customers found</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Try adjusting your filters or search query.
        </p>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

const LIMIT = 50;

export default function DirectoryPage() {
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    country: "All",
    kyc: "All",
    transfer: "All",
  });

  // Updating a filter also resets to page 1
  function updateFilter(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  }

  // Populate country dropdown once on mount
  useEffect(() => {
    apiFetch("/api/countries")
      .then((r) => r.json())
      .then((data: string[]) => setCountries(data))
      .catch(() => {});
  }, []);

  // Fetch customers whenever filters or page change
  useEffect(() => {
    const timer = setTimeout(
      () => {
        setLoading(true);
        const params = new URLSearchParams();
        if (filters.country !== "All") params.set("country", filters.country);
        if (filters.kyc !== "All") params.set("kycStatus", filters.kyc);
        if (filters.transfer !== "All")
          params.set("transferStatus", filters.transfer);
        if (filters.search.trim()) params.set("search", filters.search.trim());
        params.set("page", String(currentPage));
        params.set("limit", String(LIMIT));

        apiFetch(`/api/customers?${params}`)
          .then((r) => r.json())
          .then((res: PaginatedResponse) => {
            setCustomers(res.data ?? []);
            setTotal(res.total ?? 0);
            setPages(res.pages ?? 1);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      },
      filters.search ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [filters, currentPage]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Customer Directory
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? "Loading…" : `${total.toLocaleString()} customer${total === 1 ? "" : "s"}`}
        </p>
      </div>

      <FilterBar filters={filters} onChange={updateFilter} countries={countries} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading customers…</span>
        </div>
      ) : customers.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 md:hidden">
            {customers.map((c) => (
              <CustomerCard key={c.customer_id} customer={c} />
            ))}
          </div>

          {/* Desktop: scrollable table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/80">
                  {[
                    "ID",
                    "Name",
                    "Country",
                    "Phone",
                    "Registered",
                    "KYC",
                    "Transfers",
                    "Risk",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 first:pl-5 last:pr-5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <CustomerRow key={c.customer_id} customer={c} />
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