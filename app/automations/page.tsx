"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Pencil, Save, X, Zap } from "lucide-react";
import { useAuth } from "@/src/context/AuthContext";

// ─── types ────────────────────────────────────────────────────────────────────

interface AutomationRule {
  id: number;
  rule_name: string;
  trigger_key: string;
  delay_hours: number;
  is_active: boolean;
  email_subject: string;
  email_template_id: string;
  updated_at: string;
}

const TEMPLATE_OPTIONS = [
  { value: "first-transfer-nudge", label: "First Transfer Nudge" },
  { value: "general-email", label: "General Email" },
  { value: "beneficiary-issue", label: "Beneficiary Issue" },
];

// ─── toggle switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
        checked ? "bg-emerald-500" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ─── edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  rule,
  onClose,
  onSave,
}: {
  rule: AutomationRule;
  onClose: () => void;
  onSave: (updates: Partial<AutomationRule>) => Promise<void>;
}) {
  const [delayHours, setDelayHours] = useState(String(rule.delay_hours));
  const [subject, setSubject] = useState(rule.email_subject);
  const [template, setTemplate] = useState(rule.email_template_id);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        id: rule.id,
        delay_hours: Number(delayHours),
        email_subject: subject,
        email_template_id: template,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Edit Rule</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-sm font-medium text-slate-500">
          {rule.rule_name}
        </p>

        {/* Delay */}
        <label className="mb-3 block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Delay (hours)
          </span>
          <input
            type="number"
            min={1}
            value={delayHours}
            onChange={(e) => setDelayHours(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </label>

        {/* Subject */}
        <label className="mb-3 block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Email Subject
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </label>

        {/* Template */}
        <label className="mb-5 block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Email Template
          </span>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          >
            {TEMPLATE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const { token } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/automations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch rules");
      const data = await res.json();
      setRules(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  async function updateRule(updates: Partial<AutomationRule>) {
    const res = await fetch("/api/admin/automations", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Update failed");
    }
    const updated: AutomationRule = await res.json();
    setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function handleToggle(rule: AutomationRule) {
    setTogglingId(rule.id);
    try {
      await updateRule({ id: rule.id, is_active: !rule.is_active } as Partial<AutomationRule>);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setTogglingId(null);
    }
  }

  const activeCount = rules.filter((r) => r.is_active).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
            <Bot size={18} strokeWidth={2.5} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Automations
            </h1>
            <p className="text-sm text-slate-500">
              {activeCount} of {rules.length} rules active
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Rules table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80">
              <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Rule
              </th>
              <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Trigger
              </th>
              <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                Delay
              </th>
              <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                Active
              </th>
              <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rules.map((rule) => (
              <tr
                key={rule.id}
                className={`transition-colors ${
                  rule.is_active ? "" : "opacity-60"
                }`}
              >
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                        rule.is_active
                          ? "bg-indigo-100 text-indigo-600"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      <Zap size={14} strokeWidth={2.5} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {rule.rule_name}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {rule.email_subject}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <code className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {rule.trigger_key}
                  </code>
                </td>
                <td className="px-5 py-4 text-center font-medium text-slate-700">
                  {rule.delay_hours}h
                </td>
                <td className="px-5 py-4 text-center">
                  <ToggleSwitch
                    checked={!!rule.is_active}
                    onChange={() => handleToggle(rule)}
                    disabled={togglingId === rule.id}
                  />
                </td>
                <td className="px-5 py-4 text-center">
                  <button
                    onClick={() => setEditingRule(rule)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rules.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <Zap size={40} className="mb-3 text-slate-200" />
            <p className="text-sm font-medium text-slate-500">
              No automation rules configured yet.
            </p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editingRule && (
        <EditModal
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSave={updateRule}
        />
      )}
    </div>
  );
}