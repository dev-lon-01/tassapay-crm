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
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import {
  useQueue,
  type QueueCustomer,
  type QueueTab,
} from "@/src/context/QueueContext";

// ─── helpers ──────────────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  "United Kingdom": "\u{1F1EC}\u{1F1E7}",
  Germany: "\u{1F1E9}\u{1F1EA}",
  Sweden: "\u{1F1F8}\u{1F1EA}",
  Netherlands: "\u{1F1F3}\u{1F1F1}",
  France: "\u{1F1EB}\u{1F1F7}",
  Italy: "\u{1F1EE}\u{1F1F9}",
  Spain: "\u{1F1EA}\u{1F1F8}",
  Belgium: "\u{1F1E7}\u{1F1EA}",
};

function flagFor(country: string | null): string {
  return COUNTRY_FLAGS[country ?? ""] ?? "\u{1F30D}";
}

function getPriority(c: QueueCustomer): 0 | 1 | 2 {
  if (c.kyc_completion_date === null) return 0;
  const regMs = c.registration_date
    ? new Date(c.registration_date).getTime()
    : 0;
  const ageDays = (Date.now() - regMs) / 86_400_000;
  if (c.total_transfers === 0 && ageDays < 30) return 1;
  return 2;
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

// ─── priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({ c }: { c: QueueCustomer }) {
  const p = getPriority(c);
  if (p === 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
        <ShieldAlert className="h-3 w-3" />
        Pending KYC
      </span>
    );
  if (p === 1)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
        <TrendingDown className="h-3 w-3" />
        New · 0 Transfers
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
      <Clock className="h-3 w-3" />
      Dormant
    </span>
  );
}

// ─── queue card ───────────────────────────────────────────────────────────────

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
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open();
      }}
      className="cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 pb-3 pt-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {tab === "uncontacted" ? (
          <PriorityBadge c={customer} />
        ) : (
          <span
            className={\`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold \${
              tab === "follow-up"
                ? "bg-blue-50 text-blue-700"
                : "bg-slate-100 text-slate-500"
            }\`}
          >
            {tab === "follow-up" ? "Follow-Up" : "Closed"}
          </span>
        )}
        <span className="text-xs text-slate-400">
          {dueLabel(customer.registration_date)}
        </span>
      </div>
      <p className="text-base font-bold leading-tight text-slate-900">
        {customer.full_name ?? "\u2014"}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-slate-500">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm">
          {flagFor(customer.country)} {customer.country ?? "\u2014"}
        </span>
      </div>
      <p className="mt-1.5 font-mono text-xs text-slate-400">
        #{customer.customer_id}
      </p>
    </article>
  );
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

const TABS: { key: QueueTab; label: string }[] = [
  { key: "uncontacted", label: "Uncontacted" },
  { key: "follow-up", label: "Follow-Up" },
  { key: "closed", label: "Closed" },
];

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MyTasksPage() {
  const router = useRouter();
  const { rawCustomers, setRawCustomers, activeTab, setActiveTab, sortedQueue } =
    useQueue();

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/tasks")
      .then((r) => r.json())
      .then((data: QueueCustomer[]) => {
        setRawCustomers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // intentionally run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queue = sortedQueue(activeTab);
  const tabCount = (key: QueueTab) => (loading ? 0 : sortedQueue(key).length);
  const activeCount = tabCount("uncontacted") + tabCount("follow-up");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          My Tasks
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading
            ? "Loading\u2026"
            : \`\${activeCount} customer\${activeCount === 1 ? "" : "s"} need attention\`}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex border-b border-slate-200 bg-white">
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

        <div className="p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading tasks\u2026</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <p className="text-sm font-semibold text-slate-500">
                {activeTab === "uncontacted"
                  ? "All caught up! \u{1F389}"
                  : \`No \${activeTab} customers\`}
              </p>
              <p className="text-xs text-slate-400">
                {activeTab === "uncontacted"
                  ? "No new customers need attention."
                  : "Customers in this state will appear here."}
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
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-emerald-700"
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
console.log("Written:", filePath);
