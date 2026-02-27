"use client";

import { useState } from "react";
import { Plus, Zap, CornerDownRight } from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  isActive: boolean;
}

// ─── mock data ────────────────────────────────────────────────────────────────

const INITIAL_RULES: AutomationRule[] = [
  {
    id: "rule-1",
    name: "Zero-Transfer Nudge",
    trigger: "Total Transfers = 0 AND Account Age > 24h",
    action: "Send Email Promo",
    isActive: true,
  },
  {
    id: "rule-2",
    name: "Urgent KYC Routing",
    trigger: "KYC Pending AND Account Age > 2h",
    action: "Route to Agent 'My Tasks'",
    isActive: true,
  },
  {
    id: "rule-3",
    name: "VIP Support Queue",
    trigger: "Total Transfers > 10",
    action: "Flag as High Priority",
    isActive: false,
  },
];

// ─── toggle switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  isActive,
  onToggle,
}: {
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={isActive}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
        isActive ? "bg-emerald-500" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          isActive ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ─── automation card ──────────────────────────────────────────────────────────

function AutomationCard({
  rule,
  onToggle,
}: {
  rule: AutomationRule;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm transition-all duration-200 ${
        rule.isActive
          ? "border-slate-200 shadow-slate-900/5"
          : "border-slate-100 opacity-60"
      }`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
              rule.isActive
                ? "bg-indigo-100 text-indigo-600"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            <Zap size={16} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">
              {rule.name}
            </p>
            <p
              className={`mt-0.5 text-xs font-medium ${
                rule.isActive ? "text-emerald-600" : "text-slate-400"
              }`}
            >
              {rule.isActive ? "Active" : "Inactive"}
            </p>
          </div>
        </div>
        <ToggleSwitch
          isActive={rule.isActive}
          onToggle={() => onToggle(rule.id)}
        />
      </div>

      {/* Logic block */}
      <div className="mx-4 mb-4 rounded-xl bg-slate-50 px-4 py-3 space-y-2.5">
        {/* WHEN row */}
        <div className="flex items-start gap-2.5">
          <span className="mt-px flex-shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            When
          </span>
          <p className="text-sm text-slate-700 leading-snug">{rule.trigger}</p>
        </div>

        {/* Connector */}
        <div className="flex items-center gap-1.5 pl-0.5">
          <CornerDownRight
            size={13}
            className="flex-shrink-0 text-slate-400"
            strokeWidth={2}
          />
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        {/* THEN row */}
        <div className="flex items-start gap-2.5">
          <span className="mt-px flex-shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-500">
            Then
          </span>
          <p className="text-sm font-medium text-slate-800 leading-snug">
            {rule.action}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>(INITIAL_RULES);

  function handleToggle(id: string) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r))
    );
  }

  const activeCount = rules.filter((r) => r.isActive).length;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Automations &amp; Rules
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeCount} of {rules.length} rules active
          </p>
        </div>
        <button
          onClick={() => alert("Opening Rule Builder...")}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-900/20 transition hover:bg-indigo-700 active:scale-95"
        >
          <Plus size={15} strokeWidth={2.5} />
          New Rule
        </button>
      </div>

      {/* Rules list */}
      <div className="space-y-3">
        {rules.map((rule) => (
          <AutomationCard key={rule.id} rule={rule} onToggle={handleToggle} />
        ))}
      </div>

      {/* Empty state */}
      {rules.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Zap size={40} className="text-slate-200 mb-3" />
          <p className="text-sm font-medium text-slate-500">
            No automation rules yet.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Click &ldquo;+&nbsp;New Rule&rdquo; to get started.
          </p>
        </div>
      )}
    </div>
  );
}