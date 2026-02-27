const fs = require("fs");

// Helpers used in the template literal that contain backticks
const bq = "`";
const bq3 = "```";

const page = `"use client";

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

// \u2500\u2500\u2500 types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

type QueueType = "default" | "dormant" | "new" | "incomplete";

const DORMANT_TIMEFRAMES = [
  { value: 40,  label: "Over 40 Days"  },
  { value: 90,  label: "Over 90 Days"  },
  { value: 180, label: "Over 180 Days" },
  { value: 360, label: "Over 360 Days" },
];

const NEW_TIMEFRAMES = [
  { value: 7,  label: "Last 7 Days"  },
  { value: 14, label: "Last 14 Days" },
  { value: 28, label: "Last 28 Days" },
  { value: 60, label: "Last 60 Days" },
];

const DEFAULT_TIMEFRAME: Record<QueueType, number> = {
  default:    30,
  dormant:    40,
  new:         7,
  incomplete:  0,
};

// \u2500\u2500\u2500 helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const COUNTRY_FLAGS: Record<string, string> = {
  "United Kingdom": "\u{1F1EC}\u{1F1E7}",
  Germany:          "\u{1F1E9}\u{1F1EA}",
  Sweden:           "\u{1F1F8}\u{1F1EA}",
  Netherlands:      "\u{1F1F3}\u{1F1F1}",
  France:           "\u{1F1EB}\u{1F1F7}",
  Italy:            "\u{1F1EE}\u{1F1F9}",
  Spain:            "\u{1F1EA}\u{1F1F8}",
  Belgium:          "\u{1F1E7}\u{1F1EA}",
};

function flagFor(country: string | null): string {
  return COUNTRY_FLAGS[country ?? ""] ?? "\u{1F30D}";
}

function dueLabel(registrationDate: string | null): string {
  if (!registrationDate) return "";
  const hours = Math.floor(
    (Date.now() - new Date(registrationDate).getTime()) / 3_600_000
  );
  if (hours < 1) return "Just registered";
  if (hours < 24) return ${bq}\${hours}h ago${bq};
  return ${bq}\${Math.floor(hours / 24)}d ago${bq};
}

// \u2500\u2500\u2500 reason label \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface ReasonInfo {
  label: string;
  className: string;
  Icon: React.ComponentType<{ className?: string }>;
}

function getReasonLabel(c: QueueCustomer): ReasonInfo {
  if (!c.kyc_completion_date)
    return { label: "Incomplete Profile",  className: "bg-rose-100 text-rose-700",     Icon: ShieldAlert  };
  if (c.total_transfers === 0)
    return { label: "Recently Registered", className: "bg-blue-100 text-blue-700",     Icon: UserCheck    };
  return   { label: "No Recent Transfer",  className: "bg-orange-100 text-orange-700", Icon: TrendingDown };
}

function ReasonBadge({ customer }: { customer: QueueCustomer }) {
  const { label, className, Icon } = getReasonLabel(customer);
  return (
    <span className=${bq}inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold \${className}${bq}>
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
    router.push(${bq}/customer/\${customer.customer_id}${bq});
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
          <span className=${bq}rounded-full px-2 py-0.5 text-xs font-semibold \${
            tab === "follow-up" ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
          }${bq}>
            {tab === "follow-up" ? "Follow-Up" : "Closed"}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-slate-400">
          {dueLabel(customer.registration_date)}
        </span>
      </div>
      <p className="text-base font-bold leading-tight text-slate-900">
        {customer.full_name ?? "\u2014"}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-slate-500">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm">{flagFor(customer.country)} {customer.country ?? "\u2014"}</span>
      </div>
      <p className="mt-1.5 font-mono text-xs text-slate-400">#{customer.customer_id}</p>
    </article>
  );
}

// \u2500\u2500\u2500 select wrapper \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3 pr-7 text-sm font-medium text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
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
  const { rawCustomers, setRawCustomers, activeTab, setActiveTab, sortedQueue } = useQueue();

  const [loading,         setLoading        ] = useState(true);
  const [searchQuery,     setSearchQuery    ] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("All");
  const [countries,       setCountries      ] = useState<string[]>([]);
  const [queueType,       setQueueTypeState ] = useState<QueueType>("default");
  const [timeframe,       setTimeframe      ] = useState<number>(30);

  // \u2014 debounce search 350 ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // \u2014 load country list once
  useEffect(() => {
    apiFetch("/api/countries")
      .then((r) => r.json())
      .then((data: string[]) => setCountries(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // \u2014 reset timeframe when queue type changes
  function handleQueueTypeChange(val: string) {
    const qt = val as QueueType;
    setQueueTypeState(qt);
    setTimeframe(DEFAULT_TIMEFRAME[qt]);
  }

  // \u2014 fetch tasks whenever any filter changes
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    p.set("queueType", queueType);
    if (timeframe > 0)             p.set("timeframe", String(timeframe));
    if (debouncedSearch)           p.set("search",    debouncedSearch);
    if (selectedCountry !== "All") p.set("country",   selectedCountry);

    apiFetch(${bq}/api/tasks?\${p.toString()}${bq})
      .then((r) => r.json())
      .then((data: QueueCustomer[]) => {
        setRawCustomers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedCountry, queueType, timeframe]);

  const queue       = sortedQueue(activeTab);
  const tabCount    = (key: QueueTab) => loading ? 0 : sortedQueue(key).length;
  const activeCount = tabCount("uncontacted") + tabCount("follow-up");
  const isFiltered  = !!debouncedSearch || selectedCountry !== "All" || queueType !== "default";
  const showTimeframe = queueType === "dormant" || queueType === "new";

  return (
    <div className="space-y-3">

      {/* page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Tasks</h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading
            ? "Loading\u2026"
            : ${bq}\${activeCount} customer\${activeCount === 1 ? "" : "s"} need attention${bq}}
        </p>
      </div>

      {/* sticky filter bar */}
      <div className="sticky top-[65px] z-30 -mx-4 bg-[#f4f7fb]/95 px-4 pb-2 pt-1 backdrop-blur-sm">

        {/* row 1: search */}
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, ID\u2026"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>

        {/* row 2: dropdowns — 2 or 3 columns */}
        <div className={${bq}grid gap-2 \${showTimeframe ? "grid-cols-3" : "grid-cols-2"}${bq}}>

          {/* country */}
          <FilterSelect value={selectedCountry} onChange={setSelectedCountry}>
            <option value="All">All Countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>{flagFor(c)} {c}</option>
            ))}
          </FilterSelect>

          {/* queue logic */}
          <FilterSelect value={queueType} onChange={handleQueueTypeChange}>
            <option value="default">Default View</option>
            <option value="incomplete">Incomplete Profiles</option>
            <option value="new">Recently Registered</option>
            <option value="dormant">Dormant Users</option>
          </FilterSelect>

          {/* timeframe — conditional */}
          {showTimeframe && (
            <FilterSelect value={timeframe} onChange={(v) => setTimeframe(Number(v))}>
              {(queueType === "dormant" ? DORMANT_TIMEFRAMES : NEW_TIMEFRAMES).map(
                ({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                )
              )}
            </FilterSelect>
          )}
        </div>

        {isFiltered && (
          <button
            onClick={() => { setSearchQuery(""); setSelectedCountry("All"); handleQueueTypeChange("default"); }}
            className="mt-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-800"
          >
            \u00d7 Clear filters
          </button>
        )}
      </div>

      {/* tabs + list */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">

        <div className="flex border-b border-slate-200">
          {TABS.map(({ key, label }) => {
            const count = tabCount(key);
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={${bq}flex-1 py-3 text-sm font-semibold transition \${
                  activeTab === key
                    ? "border-b-2 border-emerald-600 text-emerald-700"
                    : "text-slate-500 hover:text-slate-800"
                }${bq}}
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

        <div className="p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading tasks\u2026</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <Clock className="h-8 w-8 text-slate-200" />
              <p className="text-sm font-semibold text-slate-500">
                {activeTab === "uncontacted"
                  ? isFiltered ? "No results for this filter" : "All caught up! \u{1F389}"
                  : ${bq}No \${activeTab} customers yet${bq}}
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
                  onClick={() => { setActiveTab("uncontacted"); router.push(${bq}/customer/\${queue[0].customer_id}${bq}); }}
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

fs.writeFileSync("app/my-tasks/page.tsx", page, "utf8");
console.log("page.tsx written:", page.length, "bytes");
