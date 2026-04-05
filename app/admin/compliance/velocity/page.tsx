"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, Search, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

interface VelocityRow {
  customer_id: string;
  full_name: string;
  country: string;
  sent_24h: number;
  sent_7d: number;
  sent_30d: number;
  sent_3m: number;
  sent_6m: number;
  sent_12m: number;
  sent_all_time: number;
  display_currency: string;
}

interface VelocityResponse {
  data: VelocityRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

function formatAmount(amount: number, currency: string | null) {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const LIMIT = 50;
// Highlight threshold: transactions > £3,000 in the last 24 hours
const ALERT_24H_THRESHOLD = 3000;

export default function VelocityReportPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [searchName, setSearchName] = useState("");
  const [region, setRegion] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<VelocityRow[]>([]);
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

    const timer = window.setTimeout(
      () => {
        setLoading(true);
        const params = new URLSearchParams({
          page: String(page),
          limit: String(LIMIT),
        });
        if (searchName.trim()) params.set("search_name", searchName.trim());
        if (region) params.set("region", region);
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);

        apiFetch(`/api/compliance/velocity-report?${params.toString()}`)
          .then((res) => res.json())
          .then((data: VelocityResponse) => {
            setRows(Array.isArray(data.data) ? data.data : []);
            setTotal(data.total ?? 0);
            setPages(data.pages ?? 1);
          })
          .finally(() => setLoading(false));
      },
      searchName ? 250 : 0,
    );

    return () => window.clearTimeout(timer);
  }, [page, searchName, region, dateFrom, dateTo, user]);

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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Velocity Report</h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading
            ? "Loading..."
            : `${total.toLocaleString()} customer${total === 1 ? "" : "s"} with successful transactions`}
        </p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchName}
            onChange={(e) => {
              setSearchName(e.target.value);
              setPage(1);
            }}
            placeholder="Search by customer name..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <select
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setPage(1);
          }}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        >
          <option value="">All Regions</option>
          <option value="UK">UK</option>
          <option value="EU">EU</option>
        </select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="From date"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <span className="text-sm text-slate-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="To date"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading velocity data...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-slate-200" />
            <div>
              <p className="text-sm font-semibold text-slate-700">No data found</p>
              <p className="mt-1 text-xs text-slate-500">
                Adjust filters to see customer transaction velocity.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full table-auto text-left">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 pl-5 pr-3">Customer</th>
                  <th className="px-3 py-3">Country</th>
                  <th className="px-3 py-3">24 Hours</th>
                  <th className="px-3 py-3">7 Days</th>
                  <th className="px-3 py-3">30 Days</th>
                  <th className="px-3 py-3">3 Months</th>
                  <th className="px-3 py-3">6 Months</th>
                  <th className="px-3 py-3">12 Months</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isAlert = row.sent_24h > ALERT_24H_THRESHOLD;
                  return (
                    <tr
                      key={row.customer_id}
                      className="border-t border-slate-100 text-sm text-slate-700 hover:bg-slate-50/50"
                    >
                      <td className="py-3 pl-5 pr-3">
                        <Link
                          href={`/customer/${row.customer_id}`}
                          className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                        >
                          {row.full_name}
                        </Link>
                      </td>
                      <td className="px-3 py-3">{row.country}</td>
                      <td
                        className={`px-3 py-3 ${isAlert ? "font-bold text-amber-600" : ""}`}
                      >
                        {formatAmount(row.sent_24h, row.display_currency)}
                      </td>
                      <td className="px-3 py-3">
                        {formatAmount(row.sent_7d, row.display_currency)}
                      </td>
                      <td className="px-3 py-3">
                        {formatAmount(row.sent_30d, row.display_currency)}
                      </td>
                      <td className="px-3 py-3">
                        {formatAmount(row.sent_3m, row.display_currency)}
                      </td>
                      <td className="px-3 py-3">
                        {formatAmount(row.sent_6m, row.display_currency)}
                      </td>
                      {/* AC 1: default sort col — bold to draw the eye */}
                      <td className="px-3 py-3 font-semibold">
                        {formatAmount(row.sent_12m, row.display_currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">
            Page {page} of {pages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
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
