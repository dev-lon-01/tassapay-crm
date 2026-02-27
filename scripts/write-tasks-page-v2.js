const fs = require("fs");
const path = require("path");

const content = `"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MapPin,
  ShieldAlert,
  TrendingDown,
  Clock,
  ArrowRight,
  Search,
  ChevronDown,
  UserCheck,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import {
  useQueue,
  type QueueCustomer,
  type QueueTab,
} from "@/src/context/QueueContext";

// \u2500\u2500\u2500 helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const COUNTRY_FLAGS: Record<string, string> = {
  "United Kingdom": "\\u{1F1EC}\\u{1F1E7}",
  Germany:          "\\u{1F1E9}\\u{1F1EA}",
  Sweden:           "\\u{1F1F8}\\u{1F1EA}",
  Netherlands:      "\\u{1F1F3}\\u{1F1F1}",
  France:           "\\u{1F1EB}\\u{1F1F7}",
  Italy:            "\\u{1F1EE}\\u{1F1F9}",
  Spain:            "\\u{1F1EA}\\u{1F1F8}",
  Belgium:          "\\u{1F1E7}\\u{1F1EA}",
};

function flagFor(country: string | null): string {
  return COUNTRY_FLAGS[country ?? ""] ?? "\\u{1F30D}";
}

function dueLabel(registrationDate: string | null): string {
  if (!registrationDate) return "";
  const hours = Math.floor(
    (Date.now() - new Date(registrationDate).getTime()) / 3_600_000
  );
  if (hours < 1) return "Just registered";
  if (hours < 24) return \`\${hours}h ago\`;
  return \`\${Math.floor(hours / 24)}d ago\`;
}

// \u2500\u2500\u2500 reason label \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface ReasonInfo {
  label: string;
  className: string;
  Icon: React.ComponentType<{ className?: string }>;
}

function getReasonLabel(c: QueueCustomer): ReasonInfo {
  // Condition 1 (\u2605\u2605\u2605): KYC not completed
  if (!c.kyc_completion_date) {
    return {
      label: "Incomplete Profile",
      className: "bg-rose-100 text-rose-700",
      Icon: ShieldAlert,
    };
  }
  // Condition 2: KYC done, never transferred
  if (c.total_transfers === 0) {
    return {
      label: "Recently Registered",
      className: "bg-blue-100 text-blue-700",
      Icon: UserCheck,
    };
  }
  // Condition 3: has transfers, but last one was > 40 days ago
  return {
    label: "No Recent Transfer",
    className: "bg-orange-100 text-orange-700",
    Icon: TrendingDown,
  };
}

function ReasonBadge({ customer }: { customer: QueueCustomer }) {
  const { label, className, Icon } = getReasonLabel(customer);
  return (
    <span
      className={\`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold \${className}\`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// \u2500\u2500\u2500 queue card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function QueueCard({ customer, tab }: { customer: QueueCustomer; tab: QueueTab }) {
  const router = useRouter();
  const { setActiveTab } = useQueue();

  function open() {
    setActiveTab(tab);
    router.push(\`/customer/\${customer.customer_id}\`);
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(); }}
      className="cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 pb-3 pt-4 shadow-sm transition-shadow hover:shadow-md active:bg-slate-50"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ReasonBadge customer={customer} />
        {tab !== "uncontacted" && (
          <span
            className={\`rounded-full px-2 py-0.5 text-xs font-semibold \${
              tab === "follow-up"
                ? "bg-blue-50 text-blue-600"
                : "bg-slate-100 text-slate-500"
            }\`}
          >
            {tab === "follow-up" ? "Follow-Up" : "Closed"}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-slate-400">
          {dueLabel(customer.registration_date)}
        </span>
      </div>
      <p className="text-base font-bold leading-tight text-slate-900">
        {customer.full_name ?? "\\u2014"}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-slate-500">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm">
          {flagFor(customer.country)} {customer.country ?? "\\u2014"}
        </span>
      </div>
      <p className="mt-1.5 font-mono text-xs text-slate-400">
        #{customer.customer_id}
      </p>
    </article>
  );
}

// \u2500\u2500\u2500 tabs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const TABS: { key: QueueTab; label: string }[] = [
  { key: "uncontacted", label: "Uncontacted" },
  { key: "follow-up",   label: "Follow-Up"   },
  { key: "closed",      label: "Closed"      },
];

// \u2500\u2500\u2500 page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export default function MyTasksPage() {
  const router = useRouter();
  const { rawCustomers, setRawCustomers, activeTab, setActiveTab, sortedQueue } =
    useQueue();

  const [loading,         setLoading         ] = useState(true);
  const [searchQuery,     setSearchQuery     ] = useState("");
  const [debouncedSearch, setDebouncedSearch ] = useState("");
  const [selectedCountry, setSelectedCountry ] = useState("All");
  const [countries,       setCountries       ] = useState<string[]>([]);

  // \u2014 debounce search 350 ms \u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // \u2014 load country list once \u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014
  useEffect(() => {
    apiFetch("/api/countries")
      .then((r) => r.json())
      .then((data: string[]) => setCountries(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // \u2014 fetch tasks whenever filters change \u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch)         params.set("search",  debouncedSearch);
    if (selectedCountry !== "All") params.set("country", selectedCountry);
    const qs = params.toString();

    apiFetch(\`/api/tasks\${qs ? \`?\${qs}\` : ""}\`)
      .then((r) => r.json())
      .then((data: QueueCustomer[]) => {
        setRawCustomers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedCountry]);

  const queue      = sortedQueue(activeTab);
  const tabCount   = (key: QueueTab) => loading ? 0 : sortedQueue(key).length;
  const activeCount = tabCount("uncontacted") + tabCount("follow-up");
  const isFiltered = !!debouncedSearch || selectedCountry !== "All";

  return (
    <div className="space-y-3">

      {/* \u2500\u2500\u2500 Page heading \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          My Tasks
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading
            ? "Loading\\u2026"
            : \`\${activeCount} customer\${activeCount === 1 ? "" : "s"} need attention\`}
        </p>
      </div>

      {/* \u2500\u2500\u2500 Sticky search + country filter \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div className="sticky top-[65px] z-30 -mx-4 bg-[#f4f7fb]/95 px-4 pb-2 pt-1 backdrop-blur-sm">
        <div className="flex gap-2">
          {/* Search input */}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, phone, ID\\u2026"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          {/* Country dropdown */}
          <div className="relative shrink-0">
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="h-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="All">All Countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {flagFor(c)} {c}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {isFiltered && (
          <button
            onClick={() => { setSearchQuery(""); setSelectedCountry("All"); }}
            className="mt-1 text-xs font-semibold text-emerald-600 hover:text-emerald-800"
          >
            \\u00d7 Clear filters
          </button>
        )}
      </div>

      {/* \u2500\u2500\u2500 Tabs + queue list \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">

        {/* Tab bar */}
        <div className="flex border-b border-slate-200">
          {TABS.map(({ key, label }) => {
            const count = tabCount(key);
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={\`flex-1 py-3 text-sm font-semibold transition \${
                  activeTab === key
                    ? "border-b-2 border-emerald-600 text-emerald-700"
                    : "text-slate-500 hover:text-slate-800"
                }\`}
              >
                {label}
                {count > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List body */}
        <div className="p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading tasks\\u2026</span>
            </div>

          ) : queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <Clock className="h-8 w-8 text-slate-200" />
              <p className="text-sm font-semibold text-slate-500">
                {activeTab === "uncontacted"
                  ? isFiltered ? "No results for this filter" : "All caught up! \\u{1F389}"
                  : \`No \${activeTab} customers yet\`}
              </p>
              <p className="text-xs text-slate-400">
                {activeTab === "uncontacted" && !isFiltered
                  ? "No new customers need attention right now."
                  : "Customers you action will appear here."}
              </p>
            </div>

          ) : (
            <>
              {activeTab === "uncontacted" && (
                <button
                  onClick={() => {
                    setActiveTab("uncontacted");
                    router.push(\`/customer/\${queue[0].customer_id}\`);
                  }}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm shadow-emerald-600/25 transition active:scale-[0.98] active:bg-emerald-700"
                >
                  <ArrowRight className="h-4 w-4" />
                  Begin Queue ({queue.length})
                </button>
              )}
              <div className="space-y-3">
                {queue.map((c) => (
                  <QueueCard key={c.customer_id} customer={c} tab={activeTab} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
`;

const filePath = path.join(__dirname, "..", "app", "my-tasks", "page.tsx");
fs.writeFileSync(filePath, content, "utf8");
console.log("Written:", filePath, `(${content.length} bytes)`);
