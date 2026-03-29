"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bell,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { useRouter } from "next/navigation";
import { Modal } from "@/src/components/Modal";

// ─── types ────────────────────────────────────────────────────────────────────

interface AlertRouting {
  id: number;
  destination_country: string;
  source_currency: string;
  alert_emails: string | null;
  alert_phones: string | null;

  pushover_sound: string;
  pushover_priority: number;
  pushover_enabled: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const CURRENCIES = ["GBP", "EUR", "USD", "AED", "SAR", "CAD", "AUD", "NOK", "SEK", "DKK"];

// ─── status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: number }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-600">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
      Inactive
    </span>
  );
}

// ─── modal ───────────────────────────────────────────────────────────────────

interface ModalProps {
  rule: AlertRouting | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

function RuleModal({ rule, onClose, onSaved }: ModalProps) {
  const isEdit = !!rule;

  const [currency, setCurrency]            = useState(rule?.source_currency ?? "GBP");
  const [emails, setEmails]                = useState(rule?.alert_emails ?? "");
  const [phones, setPhones]                = useState(rule?.alert_phones ?? "");
  const [pushoverEnabled, setPushoverEnabled] = useState(rule ? rule.pushover_enabled !== 0 : true);
  const [pushoverSound, setPushoverSound]  = useState(rule?.pushover_sound ?? "pushover");
  const [pushoverPriority, setPushoverPriority] = useState(rule?.pushover_priority ?? 0);
  const [isActive, setIsActive]            = useState(rule ? rule.is_active !== 0 : true);
  const [saving, setSaving]                = useState(false);
  const [error, setError]                  = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!emails.trim() && !phones.trim() && !pushoverEnabled) {
      setError("At least one of Email, Phone, or Push Notification must be enabled.");
      setSaving(false);
      return;
    }

    const payload = {
      source_currency:      currency,
      destination_country:  "Somalia",
      alert_emails:         emails.trim() || null,
      alert_phones:         phones.trim() || null,
      pushover_sound:       pushoverSound,
      pushover_priority:    pushoverPriority,
      pushover_enabled:     pushoverEnabled,
      is_active:            isActive,
    };

    try {
      if (isEdit) {
        const res = await apiFetch(`/api/settings/alerts/${rule!.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error ?? "Failed to save");
        }
      } else {
        const res = await apiFetch("/api/settings/alerts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error ?? "Failed to save");
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Edit Alert Rule" : "New Alert Rule"}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="alert-rule-form"
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Rule"}
          </button>
        </div>
      }
    >
      <form id="alert-rule-form" onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Destination (locked) */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Destination Country
          </label>
          <input
            type="text"
            value="Somalia"
            disabled
            className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
          />
        </div>

        {/* Currency */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Source Currency <span className="text-rose-500">*</span>
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {isEdit && (
            <p className="mt-1 text-xs text-slate-400">Currency cannot be changed after creation.</p>
          )}
        </div>

        {/* Emails */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Alert Emails
          </label>
          <input
            type="text"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="ops@example.com, manager@example.com"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="mt-1 text-xs text-slate-400">Separate multiple addresses with commas.</p>
        </div>

        {/* Phones */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Alert Phone Numbers
          </label>
          <input
            type="text"
            value={phones}
            onChange={(e) => setPhones(e.target.value)}
            placeholder="+447911123456, +13125551234"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="mt-1 text-xs text-slate-400">Include + country code. Separate with commas.</p>
        </div>

        {/* Push Notification toggle */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-700">Push Notification</p>
            <p className="text-xs text-slate-400">Send a Pushover alert when this rule fires.</p>
          </div>
          <button
            type="button"
            onClick={() => setPushoverEnabled((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              pushoverEnabled ? "bg-emerald-500" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                pushoverEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Pushover Priority */}
        {pushoverEnabled && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Pushover Priority
          </label>
          <select
            value={pushoverPriority}
            onChange={(e) => setPushoverPriority(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value={-2}>Lowest (-2)</option>
            <option value={-1}>Low (-1)</option>
            <option value={0}>Normal (0)</option>
            <option value={1}>High (1)</option>
            <option value={2}>Emergency (2) - bypasses silent mode</option>
          </select>
        </div>
        )}

        {/* Pushover Sound */}
        {pushoverEnabled && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Pushover Sound
          </label>
          <select
            value={pushoverSound}
            onChange={(e) => setPushoverSound(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="pushover">Pushover (default)</option>
            <option value="cashregister">Cash Register</option>
            <option value="siren">Siren</option>
            <option value="alien">Alien</option>
            <option value="magic">Magic</option>
          </select>
        </div>
        )}

        {/* Active toggle */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-700">Rule Active</p>
            <p className="text-xs text-slate-400">Inactive rules are ignored by the alert engine.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              isActive ? "bg-emerald-500" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                isActive ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AlertSettingsPage() {
  const { user } = useAuth();
  const router   = useRouter();

  const [rules, setRules]       = useState<AlertRouting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [modal, setModal]       = useState<"create" | AlertRouting | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (user && user.role !== "Admin") router.replace("/dashboard");
  }, [user, router]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/settings/alerts");
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  async function handleDelete(id: number) {
    if (!confirm("Delete this alert rule? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await apiFetch(`/api/settings/alerts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Delete failed");
      }
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  if (user?.role !== "Admin") return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-600" />
            <h1 className="text-xl font-bold text-slate-800">SLA Alert Routing</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Configure who gets notified when a Somalia transfer is delayed more than 15 minutes.
            Rules are matched by the transfer&apos;s send currency.
          </p>
        </div>
        <button
          onClick={() => setModal("create")}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          New Rule
        </button>
      </div>

      {/* Info banner */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Spam lock enabled:</span> Each delayed transfer triggers at most one alert, regardless of how long it remains unresolved.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
            Loading rules...
          </div>
        ) : rules.length === 0 ? (
          <div className="py-16 text-center">
            <Bell className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">No alert rules configured yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Create a rule to start receiving SLA breach notifications.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Currency</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Alert Emails</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Alert Phones</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Push</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                      {rule.source_currency}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 max-w-xs truncate">
                    {rule.alert_emails ? (
                      <span title={rule.alert_emails}>{rule.alert_emails}</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 max-w-xs truncate">
                    {rule.alert_phones ? (
                      <span title={rule.alert_phones}>{rule.alert_phones}</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                      Push ✓
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge active={rule.is_active} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setModal(rule)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        disabled={deleting === rule.id}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        title="Delete"
                      >
                        {deleting === rule.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <RuleModal
          rule={modal === "create" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadRules(); }}
        />
      )}
    </div>
  );
}
