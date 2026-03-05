"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Plus, Search, Filter, Upload, Download, X,
  Loader2, ChevronDown, Tag, CheckCircle, AlertCircle, User,
  Phone, MapPin, RefreshCw, Pencil,
} from "lucide-react";
import Papa from "papaparse";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { useLeadsQueue } from "@/src/context/LeadsQueueContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  customer_id: string;
  full_name:   string | null;
  phone_number: string | null;
  email:       string | null;
  country:     string | null;
  lead_stage:  LeadStage | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  labels:      string[] | null;   // MySQL JSON → already parsed by mysql2
  created_at:  string;
}

interface Agent {
  id:   number;
  name: string;
}

type LeadStage = "New" | "Contacted" | "Follow-up" | "Dead";

const STAGES: LeadStage[] = ["New", "Contacted", "Follow-up", "Dead"];

const STAGE_COLORS: Record<LeadStage, string> = {
  "New":        "bg-sky-50 border-sky-200 text-sky-700",
  "Contacted":  "bg-indigo-50 border-indigo-200 text-indigo-700",
  "Follow-up":  "bg-amber-50 border-amber-200 text-amber-700",
  "Dead":       "bg-slate-100 border-slate-200 text-slate-500",
};

const STAGE_HEADER: Record<LeadStage, string> = {
  "New":        "bg-sky-500",
  "Contacted":  "bg-indigo-500",
  "Follow-up":  "bg-amber-500",
  "Dead":       "bg-slate-400",
};

const STAGE_DOT: Record<LeadStage, string> = {
  "New":        "bg-sky-400",
  "Contacted":  "bg-indigo-400",
  "Follow-up":  "bg-amber-400",
  "Dead":       "bg-slate-400",
};

// ─── CSV row from PapaParse ───────────────────────────────────────────────────

interface CsvRow {
  Name?:                 string;
  Phone?:                string;
  Country?:              string;
  Assigned_Agent_Email?: string;
  Labels?:               string;
  [k: string]:           unknown;
}

interface ParsedRow {
  name:                 string;
  phone:                string;
  country:              string;
  assigned_agent_email: string;
  labels:               string[];
}

interface BulkSummary {
  total:     number;
  valid:     ParsedRow[];
  errors:    string[];
  duplicates: string[];   // phones already in DB
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const E164_RE = /^\+?[1-9]\d{6,14}$/;

function parseLabels(cell: string | undefined): string[] {
  if (!cell?.trim()) return [];
  return cell.split("|").map((l) => l.trim()).filter(Boolean);
}

function getLabels(lead: Lead): string[] {
  if (!lead.labels) return [];
  if (Array.isArray(lead.labels)) return lead.labels;
  try { return JSON.parse(lead.labels as unknown as string); } catch { return []; }
}

// ─── Country / Dial-Code Data ─────────────────────────────────────────────────

const COUNTRIES: { name: string; dial: string }[] = [
  { name: "United Kingdom",  dial: "+44"  },
  { name: "Ireland",         dial: "+353" },
  { name: "Germany",         dial: "+49"  },
  { name: "France",          dial: "+33"  },
  { name: "Spain",           dial: "+34"  },
  { name: "Italy",           dial: "+39"  },
  { name: "Netherlands",     dial: "+31"  },
  { name: "Belgium",         dial: "+32"  },
  { name: "Portugal",        dial: "+351" },
  { name: "Sweden",          dial: "+46"  },
  { name: "Denmark",         dial: "+45"  },
  { name: "Finland",         dial: "+358" },
  { name: "Austria",         dial: "+43"  },
  { name: "Greece",          dial: "+30"  },
  { name: "Poland",          dial: "+48"  },
  { name: "Czech Republic",  dial: "+420" },
  { name: "Hungary",         dial: "+36"  },
  { name: "Romania",         dial: "+40"  },
  { name: "Bulgaria",        dial: "+359" },
  { name: "Croatia",         dial: "+385" },
  { name: "Slovakia",        dial: "+421" },
  { name: "Slovenia",        dial: "+386" },
  { name: "Estonia",         dial: "+372" },
  { name: "Latvia",          dial: "+371" },
  { name: "Lithuania",       dial: "+370" },
  { name: "Luxembourg",      dial: "+352" },
  { name: "Malta",           dial: "+356" },
  { name: "Cyprus",          dial: "+357" },
];

function dialCodeFor(countryName: string): string {
  return COUNTRIES.find((c) => c.name === countryName)?.dial ?? "";
}

// Replace any known dial-code prefix and keep the local portion
function swapPrefix(currentPhone: string, newDial: string): string {
  let local = currentPhone.trim();
  for (const c of COUNTRIES) {
    if (local.startsWith(c.dial)) {
      local = local.slice(c.dial.length).replace(/^0+/, "");
      break;
    }
  }
  local = local.replace(/^\+/, "");
  return newDial + local;
}

// ─── Labels Multi-Select (creatable) ──────────────────────────────────────────

function LabelsSelect({
  value,
  onChange,
  options,
  inputId,
}: {
  value: string[];
  onChange: (labels: string[]) => void;
  options: string[];
  inputId?: string;
}) {
  const [inputVal, setInputVal] = useState("");
  const [open, setOpen]         = useState(false);

  const filtered = options.filter(
    (o) => !value.includes(o) && o.toLowerCase().includes(inputVal.toLowerCase())
  );
  const trimmed    = inputVal.trim();
  const showCreate = Boolean(trimmed) && !options.includes(trimmed) && !value.includes(trimmed);

  function add(label: string) {
    const t = label.trim();
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    setInputVal("");
  }

  function remove(label: string) {
    onChange(value.filter((l) => l !== label));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (trimmed) add(trimmed);
    } else if (e.key === "Backspace" && !inputVal && value.length > 0) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-[42px] flex-wrap items-center gap-1 rounded-xl border border-slate-200 px-2 py-1.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 cursor-text"
        onClick={() => document.getElementById(inputId ?? "labels-input")?.focus()}
      >
        {value.map((lbl) => (
          <span
            key={lbl}
            className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800"
          >
            {lbl}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => remove(lbl)}
              className="ml-0.5 text-indigo-400 hover:text-indigo-700"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id={inputId ?? "labels-input"}
          className="min-w-[80px] flex-1 bg-transparent text-sm outline-none"
          placeholder={value.length === 0 ? "Add labels…" : ""}
          value={inputVal}
          onChange={(e) => { setInputVal(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(trimmed)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
            >
              <Plus size={13} /> Create &ldquo;{trimmed}&rdquo;
            </button>
          )}
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(opt)}
              className="flex w-full items-center px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Lead Modal ────────────────────────────────────────────────────────

function CreateLeadModal({
  agents,
  existingLabels,
  onClose,
  onCreated,
}: {
  agents: Agent[];
  existingLabels: string[];
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: "",
    country: "",
    phone: "",
    email: "",
    assigned_agent_id: user?.role === "Agent" ? String(user.id) : "",
  });
  const [labels, setLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function handleCountryChange(countryName: string) {
    const dial = dialCodeFor(countryName);
    if (!dial) {
      setForm((prev) => ({ ...prev, country: countryName }));
      return;
    }
    setForm((prev) => ({ ...prev, country: countryName, phone: swapPrefix(prev.phone, dial) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:              form.name.trim(),
          phone:             form.phone.trim(),
          country:           form.country.trim(),
          email:             form.email.trim() || null,
          assigned_agent_id: form.assigned_agent_id ? Number(form.assigned_agent_id) : null,
          labels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create lead");
      onCreated(data as Lead);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New Lead</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name *</label>
            <input
              required autoFocus
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Country *</label>
            <select
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.country}
              onChange={(e) => handleCountryChange(e.target.value)}
            >
              <option value="">— Select country —</option>
              {COUNTRIES.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.dial})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Phone (E.164) *</label>
            <input
              required placeholder="+447911123456"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
            <input
              type="email" placeholder="optional"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Assign to agent</label>
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.assigned_agent_id}
              onChange={(e) => setForm({ ...form, assigned_agent_id: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Labels</label>
            <LabelsSelect value={labels} onChange={setLabels} options={existingLabels} inputId="create-labels" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Create Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Lead Modal ───────────────────────────────────────────────────────────

function EditLeadModal({
  lead,
  agents,
  existingLabels,
  onClose,
  onUpdated,
}: {
  lead: Lead;
  agents: Agent[];
  existingLabels: string[];
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
}) {
  const [form, setForm] = useState({
    name:              lead.full_name ?? "",
    country:           lead.country ?? "",
    phone:             lead.phone_number ?? "",
    email:             lead.email ?? "",
    assigned_agent_id: lead.assigned_agent_id ? String(lead.assigned_agent_id) : "",
  });
  const [labels, setLabels] = useState<string[]>(getLabels(lead));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function handleCountryChange(countryName: string) {
    const dial = dialCodeFor(countryName);
    if (!dial) {
      setForm((prev) => ({ ...prev, country: countryName }));
      return;
    }
    setForm((prev) => ({ ...prev, country: countryName, phone: swapPrefix(prev.phone, dial) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead.customer_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:              form.name.trim(),
          phone:             form.phone.trim(),
          country:           form.country.trim(),
          email:             form.email.trim() || null,
          assigned_agent_id: form.assigned_agent_id ? Number(form.assigned_agent_id) : null,
          labels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update lead");
      onUpdated(data as Lead);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Edit Lead</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name *</label>
            <input
              required autoFocus
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Country *</label>
            <select
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.country}
              onChange={(e) => handleCountryChange(e.target.value)}
            >
              <option value="">— Select country —</option>
              {/* If the lead's current country is not in the EU/UK list, keep it selectable */}
              {form.country && !COUNTRIES.find((c) => c.name === form.country) && (
                <option value={form.country}>{form.country}</option>
              )}
              {COUNTRIES.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.dial})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Phone (E.164) *</label>
            <input
              required placeholder="+447911123456"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
            <input
              type="email" placeholder="optional"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Assign to agent</label>
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.assigned_agent_id}
              onChange={(e) => setForm({ ...form, assigned_agent_id: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Labels</label>
            <LabelsSelect value={labels} onChange={setLabels} options={existingLabels} inputId="edit-labels" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Bulk Import Modal ─────────────────────────────────────────────────────────

function BulkImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const csv = "Name,Phone,Country,Assigned_Agent_Email,Labels\nJohn Doe,+447911123456,United Kingdom,agent@example.com,VIP|facebook_ad";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "leads_template.csv";
    a.click(); URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const valid: ParsedRow[] = [];
        const errors: string[] = [];

        // Track phones within this CSV for intra-batch duplicate check
        const seenPhones = new Set<string>();

        results.data.forEach((row, i) => {
          const rowNum = i + 1;
          const name   = row["Name"]?.trim() ?? "";
          const phone  = row["Phone"]?.trim() ?? "";
          const country = row["Country"]?.trim() ?? "";
          const email   = row["Assigned_Agent_Email"]?.trim() ?? "";
          const labels  = parseLabels(row["Labels"]);

          if (!name)  { errors.push(`Row ${rowNum}: Name is missing`); return; }
          if (!phone) { errors.push(`Row ${rowNum}: Phone is missing`); return; }
          if (!E164_RE.test(phone)) { errors.push(`Row ${rowNum}: Phone "${phone}" is not valid E.164`); return; }
          if (!country) { errors.push(`Row ${rowNum}: Country is missing`); return; }

          const normalised = phone.replace(/[\s\-+]/g, "");
          if (seenPhones.has(normalised)) {
            errors.push(`Row ${rowNum}: Duplicate phone in this CSV — ${phone}`);
            return;
          }
          seenPhones.add(normalised);

          valid.push({ name, phone, country, assigned_agent_email: email, labels });
        });

        // Check valid phones against DB
        let duplicates: string[] = [];
        if (valid.length > 0) {
          try {
            const res = await apiFetch("/api/leads/validate-bulk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phones: valid.map((r) => r.phone) }),
            });
            const json = await res.json();
            duplicates = json.duplicates ?? [];
          } catch {
            /* offline or error — proceed anyway, INSERT IGNORE will guard */
          }
        }

        setSummary({ total: results.data.length, valid, errors, duplicates });
        setStep("preview");
      },
    });
  }

  async function executeImport() {
    if (!summary) return;
    const toInsert = summary.valid.filter(
      (r) => !summary.duplicates.includes(r.phone.replace(/[\s\-+]/g, ""))
    );
    setImporting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: toInsert }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setImportResult({ imported: json.imported, skipped: json.skipped ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setImporting(false);
    }
  }

  if (importResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
          <CheckCircle size={48} className="mx-auto mb-4 text-emerald-500" />
          <h2 className="text-xl font-bold text-slate-900">Import Complete!</h2>
          <p className="mt-2 text-slate-500">
            <span className="font-semibold text-emerald-600">{importResult.imported}</span> leads imported.
            {importResult.skipped > 0 && (
              <> <span className="font-semibold text-slate-500">{importResult.skipped}</span> skipped.</>
            )}
          </p>
          <button onClick={() => { onImported(); onClose(); }}
            className="mt-6 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {step === "upload" ? "Bulk Import Leads" : "Import Preview"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="p-6">
          {step === "upload" && (
            <div className="space-y-5">
              <button onClick={downloadTemplate}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
                <Download size={16} /> Download Master Template
              </button>

              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
              >
                <Upload size={32} className="text-slate-300" />
                <p className="text-sm font-semibold text-slate-500">Drop CSV here or click to browse</p>
                <p className="text-xs text-slate-400">Headers: Name, Phone, Country, Assigned_Agent_Email, Labels</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            </div>
          )}

          {step === "preview" && summary && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-100 p-4">
                  <p className="text-2xl font-bold text-slate-900">{summary.total}</p>
                  <p className="text-xs text-slate-500">Rows found</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-2xl font-bold text-emerald-700">
                    {summary.valid.length - summary.duplicates.length}
                  </p>
                  <p className="text-xs text-emerald-600">Ready to import</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-2xl font-bold text-amber-700">{summary.errors.length}</p>
                  <p className="text-xs text-amber-600">Formatting errors</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <p className="text-2xl font-bold text-red-700">{summary.duplicates.length}</p>
                  <p className="text-xs text-red-600">Duplicates detected</p>
                </div>
              </div>

              {/* Error list */}
              {summary.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-xl border border-amber-100 bg-amber-50 p-3">
                  {summary.errors.map((e, i) => (
                    <p key={i} className="text-xs text-amber-700">{e}</p>
                  ))}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              {/* Acknowledge checkbox */}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                I reviewed the summary and want to import{" "}
                <strong>{summary.valid.length - summary.duplicates.length}</strong> valid leads.
              </label>

              <div className="flex gap-3">
                <button onClick={() => setStep("upload")}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  Back
                </button>
                <button
                  disabled={!acknowledged || importing || (summary.valid.length - summary.duplicates.length) === 0}
                  onClick={executeImport}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {importing && <Loader2 size={14} className="animate-spin" />}
                  Execute Import
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({ lead, onClick, onEdit }: { lead: Lead; onClick: () => void; onEdit: () => void }) {
  const labels = getLabels(lead);
  const stage  = (lead.lead_stage ?? "New") as LeadStage;
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${STAGE_COLORS[stage]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 leading-tight">
          {lead.full_name ?? "—"}
        </h3>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="flex-shrink-0 rounded-lg p-1 opacity-50 hover:opacity-100 hover:bg-white/80 transition"
          title="Edit lead"
        >
          <Pencil size={11} />
        </button>
      </div>
      {lead.phone_number && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <Phone size={11} className="flex-shrink-0" />
          <span className="font-mono">{lead.phone_number}</span>
        </div>
      )}
      {lead.country && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
          <MapPin size={11} className="flex-shrink-0" />
          <span>{lead.country}</span>
        </div>
      )}
      {lead.assigned_agent_name && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
          <User size={11} className="flex-shrink-0" />
          <span className="truncate">{lead.assigned_agent_name}</span>
        </div>
      )}
      {labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {labels.map((lbl) => (
            <span key={lbl} className="rounded-full bg-white/70 border border-current px-2 py-0.5 text-[10px] font-semibold">
              {lbl}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [leads, setLeads]           = useState<Lead[]>([]);
  const [agents, setAgents]         = useState<Agent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterAgent, setFilterAgent]     = useState("all");
  const [filterLabels, setFilterLabels]   = useState<string[]>([]);
  const [allLabels, setAllLabels]         = useState<string[]>([]);
  const [showCreate, setShowCreate]   = useState(false);
  const [showBulk, setShowBulk]       = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const { setQueue } = useLeadsQueue();

  const isAdmin = user?.role === "Admin";

  // Derive unique countries from loaded leads
  const countries = [...new Set(leads.map((l) => l.country).filter(Boolean) as string[])].sort();

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({ limit: "500" });
    if (filterCountry) qp.set("country", filterCountry);
    if (filterAgent !== "all") qp.set("assigned_agent", filterAgent);
    if (search) qp.set("search", search);
    if (filterLabels.length) qp.set("labels", filterLabels.join(","));
    qp.set("show_dead", "1");

    try {
      const res  = await apiFetch(`/api/leads?${qp}`);
      const data = await res.json();
      const rows: Lead[] = (data.data ?? []).map((r: Lead) => ({
        ...r,
        labels: typeof r.labels === "string" ? JSON.parse(r.labels) : (r.labels ?? []),
      }));
      setLeads(rows);

      // Collect all unique labels across leads
      const lblSet = new Set<string>();
      rows.forEach((l) => getLabels(l).forEach((lbl) => lblSet.add(lbl)));
      setAllLabels([...lblSet].sort());
      setQueue(rows.map((r) => r.customer_id));
    } finally {
      setLoading(false);
    }
  }, [filterCountry, filterAgent, search, filterLabels]);

  useEffect(() => {
    apiFetch("/api/users")
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : (data.data ?? [])))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(loadLeads, 300);
    return () => clearTimeout(t);
  }, [loadLeads]);

  // Group by stage
  const byStage: Record<LeadStage, Lead[]> = {
    "New":       leads.filter((l) => (l.lead_stage ?? "New") === "New"),
    "Contacted": leads.filter((l) => l.lead_stage === "Contacted"),
    "Follow-up": leads.filter((l) => l.lead_stage === "Follow-up"),
    "Dead":      leads.filter((l) => l.lead_stage === "Dead"),
  };

  const totalActive = byStage["New"].length + byStage["Contacted"].length + byStage["Follow-up"].length;

  return (
    <div className="flex h-full flex-col">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="border-b border-slate-100 bg-white px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
              <Users size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Leads Pipeline</h1>
              <p className="text-xs text-slate-400">{totalActive} active</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => setShowBulk(true)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Upload size={14} /> Bulk Import
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus size={14} /> New Lead
            </button>
          </div>
        </div>

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Country */}
          <select
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-7 text-sm outline-none focus:border-indigo-400"
          >
            <option value="">All Countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Agent */}
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-7 text-sm outline-none focus:border-indigo-400"
          >
            <option value="all">All Agents</option>
            {isAdmin && <option value={String(user?.id)}>My Leads</option>}
            {!isAdmin && <option value={String(user?.id)}>My Leads</option>}
            {agents.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </select>

          {/* Labels */}
          {allLabels.length > 0 && (
            <div className="relative">
              <button className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-sm text-slate-600">
                <Tag size={13} />
                {filterLabels.length > 0 ? `${filterLabels.length} label(s)` : "Labels"}
                <ChevronDown size={13} />
              </button>
              {/* Simple dropdown: clicking a label toggles it */}
              <div className="absolute top-full left-0 z-20 mt-1 min-w-[160px] rounded-xl border border-slate-200 bg-white p-2 shadow-lg hidden group-open:block">
                {/* toggled via CSS trick below */}
              </div>
            </div>
          )}

          {/* Labels multi-select (always visible as pills) */}
          {allLabels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allLabels.map((lbl) => (
                <button
                  key={lbl}
                  onClick={() => setFilterLabels((prev) =>
                    prev.includes(lbl) ? prev.filter((l) => l !== lbl) : [...prev, lbl]
                  )}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    filterLabels.includes(lbl)
                      ? "border-indigo-400 bg-indigo-600 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300"
                  }`}
                >
                  {lbl}
                </button>
              ))}
              {filterLabels.length > 0 && (
                <button
                  onClick={() => setFilterLabels([])}
                  className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <button onClick={loadLeads} title="Refresh" className="ml-auto rounded-xl border border-slate-200 p-2 hover:bg-slate-50">
            <RefreshCw size={14} className="text-slate-500" />
          </button>
        </div>
      </div>

      {/* ── Kanban Board ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
          <span className="text-sm">Loading leads…</span>
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-x-auto p-4 md:p-6">
          {STAGES.map((stage) => {
            const stageLeads = byStage[stage];
            return (
              <div key={stage} className="flex w-72 flex-shrink-0 flex-col rounded-2xl border border-slate-100 bg-slate-50">
                {/* Column header */}
                <div className={`flex items-center justify-between rounded-t-2xl px-4 py-3 text-white ${STAGE_HEADER[stage]}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full bg-white/60`} />
                    <span className="text-sm font-bold">{stage}</span>
                  </div>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
                    {stageLeads.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
                  {stageLeads.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-8 text-sm text-slate-300">
                      No leads
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <LeadCard
                        key={lead.customer_id}
                        lead={lead}
                        onClick={() => router.push(`/leads/${lead.customer_id}`)}
                        onEdit={() => setEditingLead(lead)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateLeadModal
          agents={agents}
          existingLabels={allLabels}
          onClose={() => setShowCreate(false)}
          onCreated={(lead) => {
            setLeads((prev) => [lead, ...prev]);
            setShowCreate(false);
          }}
        />
      )}

      {showBulk && (
        <BulkImportModal
          onClose={() => setShowBulk(false)}
          onImported={loadLeads}
        />
      )}

      {editingLead && (
        <EditLeadModal
          lead={editingLead}
          agents={agents}
          existingLabels={allLabels}
          onClose={() => setEditingLead(null)}
          onUpdated={(updated) => {
            setLeads((prev) =>
              prev.map((l) =>
                l.customer_id === updated.customer_id ? { ...l, ...updated } : l
              )
            );
            setEditingLead(null);
          }}
        />
      )}
    </div>
  );
}
