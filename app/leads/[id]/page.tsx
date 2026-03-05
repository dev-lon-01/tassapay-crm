"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, AtSign, FileText,
  AlertCircle, Loader2, MessageSquare, Send, CheckCircle, XCircle,
  Mic, MicOff, PhoneOff, PlayCircle, Tag, ChevronDown, User,
  ChevronLeft, ChevronRight, Pencil, Plus, X,
} from "lucide-react";
import { normalizePhone } from "@/src/lib/phoneUtils";
import { apiFetch } from "@/src/lib/apiFetch";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";
import { useAuth } from "@/src/context/AuthContext";
import { useDropdowns } from "@/src/context/DropdownsContext";
import { useLeadsQueue } from "@/src/context/LeadsQueueContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type LeadStage = "New" | "Contacted" | "Follow-up" | "Converted" | "Dead";

interface LeadProfile {
  customer_id:         string;
  full_name:           string | null;
  email:               string | null;
  phone_number:        string | null;
  country:             string | null;
  is_lead:             number;
  lead_stage:          LeadStage | null;
  assigned_agent_id:   number | null;
  assigned_agent_name: string | null;
  labels:              string[] | null;
  created_at:          string;
}

interface ApiInteraction {
  id:                    number;
  customer_id:           string;
  agent_id:              number | null;
  type:                  "Call" | "Email" | "Note" | "System" | "SMS";
  outcome:               string | null;
  note:                  string | null;
  direction:             string | null;
  metadata:              string | null;
  created_at:            string;
  agent_name:            string | null;
  call_duration_seconds: number | null;
  recording_url:         string | null;
  twilio_call_sid:       string | null;
}

interface ApiTemplate {
  id:      number;
  name:    string;
  channel: "SMS" | "Email";
  subject: string | null;
  body:    string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function getLabels(labels: string[] | null | unknown): string[] {
  if (!labels) return [];
  if (Array.isArray(labels)) return labels;
  try { return JSON.parse(labels as string); } catch { return []; }
}

const STAGE_COLORS: Record<LeadStage, string> = {
  "New":       "bg-sky-100 text-sky-700 border-sky-200",
  "Contacted": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "Follow-up": "bg-amber-100 text-amber-700 border-amber-200",
  "Converted": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Dead":      "bg-slate-100 text-slate-500 border-slate-200",
};

const STAGES: LeadStage[] = ["New", "Contacted", "Follow-up", "Converted", "Dead"];
const LOGGER_TABS = [
  { key: "SMS"   as const, label: "Send SMS",   icon: MessageSquare },
  { key: "Email" as const, label: "Send Email",  icon: AtSign },
  { key: "Note"  as const, label: "Log Note",    icon: FileText },
  { key: "Call"  as const, label: "Call",        icon: Phone },
] as const;
type LoggerTab = "SMS" | "Email" | "Note" | "Call";

function timelineIcon(type: ApiInteraction["type"]) {
  switch (type) {
    case "SMS":    return <MessageSquare size={15} />;
    case "Call":   return <Phone size={15} />;
    case "Email":  return <AtSign size={15} />;
    case "Note":   return <FileText size={15} />;
    case "System": return <AlertCircle size={15} />;
  }
}
function timelineColor(type: ApiInteraction["type"]) {
  switch (type) {
    case "SMS":    return "bg-blue-100 text-blue-600";
    case "Call":   return "bg-green-100 text-green-600";
    case "Email":  return "bg-purple-100 text-purple-600";
    case "Note":   return "bg-amber-100 text-amber-700";
    case "System": return "bg-slate-100 text-slate-500";
  }
}

const NOTE_PLACEHOLDER = "Select outcome…";
// ─── Agent type + COUNTRIES + helpers ─────────────────────────────────────────────

interface Agent { id: number; name: string; }

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

// ─── Labels Multi-Select ──────────────────────────────────────────────────────────────

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
    (o) => !value.includes(o) && o.toLowerCase().includes(inputVal.toLowerCase()),
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
        onClick={() => document.getElementById(inputId ?? "labels-input-detail")?.focus()}
      >
        {value.map((lbl) => (
          <span key={lbl} className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
            {lbl}
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => remove(lbl)} className="ml-0.5 text-indigo-400 hover:text-indigo-700">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id={inputId ?? "labels-input-detail"}
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
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(trimmed)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50">
              <Plus size={13} /> Create &ldquo;{trimmed}&rdquo;
            </button>
          )}
          {filtered.map((opt) => (
            <button key={opt} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(opt)}
              className="flex w-full items-center px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              {opt}
            </button>
          ))}
        </div>
      )}
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
  lead: LeadProfile;
  agents: Agent[];
  existingLabels: string[];
  onClose: () => void;
  onUpdated: (updated: LeadProfile) => void;
}) {
  const [form, setForm] = useState({
    name:              lead.full_name ?? "",
    country:           lead.country ?? "",
    phone:             lead.phone_number ?? "",
    email:             lead.email ?? "",
    assigned_agent_id: lead.assigned_agent_id ? String(lead.assigned_agent_id) : "",
  });
  const [labels, setLabels] = useState<string[]>(getLabels(lead.labels));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function handleCountryChange(countryName: string) {
    const dial = dialCodeFor(countryName);
    if (!dial) { setForm((prev) => ({ ...prev, country: countryName })); return; }
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
      onUpdated(data as LeadProfile);
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
            <input required autoFocus
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Country *</label>
            <select required
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.country}
              onChange={(e) => handleCountryChange(e.target.value)}>
              <option value="">— Select country —</option>
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
            <input required placeholder="+447911123456"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
            <input type="email" placeholder="optional"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Assign to agent</label>
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={form.assigned_agent_id}
              onChange={(e) => setForm({ ...form, assigned_agent_id: e.target.value })}>
              <option value="">— Unassigned —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Labels</label>
            <LabelsSelect value={labels} onChange={setLabels} options={existingLabels} inputId="detail-edit-labels" />
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
// ─── Component ────────────────────────────────────────────────────────────────

export default function LeadProfilePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { makeCall, callState, callerInfo, callDuration, isMuted, toggleMute, hangUp } = useTwilioVoice();
  const { user } = useAuth();
  const { noteOutcomes: dbNoteOutcomes } = useDropdowns();
  const { queue } = useLeadsQueue();
  const currentIdx = queue.indexOf(params.id);
  const prevId = currentIdx > 0 ? queue[currentIdx - 1] : null;
  const nextId = currentIdx !== -1 && currentIdx < queue.length - 1 ? queue[currentIdx + 1] : null;

  const NOTE_OUTCOMES = [
    NOTE_PLACEHOLDER,
    ...(dbNoteOutcomes.length > 0
      ? dbNoteOutcomes
      : ["Left Voicemail","Requested Callback","Number Disconnected","Not Interested","Sent WhatsApp Info","Invalid Details"]),
  ];

  const [lead, setLead]         = useState<LeadProfile | null>(null);
  const [timeline, setTimeline] = useState<ApiInteraction[]>([]);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab]       = useState<LoggerTab>("Note");
  const [smsTo, setSmsTo]               = useState("");
  const [emailTo, setEmailTo]           = useState("");
  const [smsMessage, setSmsMessage]     = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody]       = useState("");
  const [noteOutcome, setNoteOutcome]   = useState(NOTE_PLACEHOLDER);

  const [sending, setSending]           = useState(false);

  const [templates, setTemplates]               = useState<ApiTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [beneficiaryTransferId, setBeneficiaryTransferId] = useState("");
  const [beneficiaryAmount, setBeneficiaryAmount] = useState("");

  const [stageSaving, setStageSaving] = useState(false);

  const [editOpen, setEditOpen]             = useState(false);
  const [agents, setAgents]                 = useState<Agent[]>([]);
  const [existingLabels, setExistingLabels] = useState<string[]>([]);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load lead profile (piggybacking the customers endpoint — leads are customers)
  useEffect(() => {
    apiFetch(`/api/customers/${params.id}`)
      .then((r) => {
        if (r.status === 403 || r.status === 404) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setLead(data.customer as LeadProfile);
        setTimeline(data.timeline ?? []);
        setSmsTo(data.customer.phone_number
          ? normalizePhone(data.customer.phone_number, data.customer.country)
          : "");
        setEmailTo(data.customer.email ?? "");
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [params.id]);

  useEffect(() => {
    apiFetch("/api/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch("/api/users")
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : (data.data ?? [])))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch("/api/leads/labels")
      .then((r) => r.json())
      .then((data) => setExistingLabels(data.labels ?? []))
      .catch(() => {});
  }, []);

  const applyTemplate = useCallback(
    (templateId: string) => {
      if (!templateId || !lead) return;
      const tpl = templates.find((t) => String(t.id) === templateId);
      if (!tpl) return;
      const fill = (str: string) =>
        str
          .replace(/\{\{fullName\}\}/g, lead.full_name ?? "")
          .replace(/\{\{customerName\}\}/g, lead.full_name ?? "")
          .replace(/\{\{country\}\}/g, lead.country ?? "");
      if (activeTab === "SMS")   { setSmsMessage(fill(tpl.body)); }
      else if (activeTab === "Email") {
        setEmailBody(fill(tpl.body));
        if (tpl.subject) setEmailSubject(fill(tpl.subject));
      }
      setSelectedTemplate("");
      setSelectedTemplateId(tpl.id);
    },
    [templates, lead, activeTab]
  );

  async function updateStage(newStage: LeadStage) {
    if (!lead || stageSaving) return;
    setStageSaving(true);
    try {
      const res = await apiFetch(`/api/leads/${lead.customer_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_stage: newStage }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      setLead((prev) => prev ? { ...prev, lead_stage: newStage } : prev);
      setToast({ message: `Stage updated to ${newStage}`, type: "success" });

      // If converted, redirect back to pipeline after a moment
      if (newStage === "Converted") {
        setTimeout(() => router.push("/leads"), 1500);
      }
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Error", type: "error" });
    } finally {
      setStageSaving(false);
    }
  }

  async function handleSend() {
    if (sending || !lead) return;
    setSending(true);
    try {
      if (activeTab === "SMS") {
        const res = await apiFetch("/api/communicate/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: params.id, agentId: user?.id ?? null, overridePhone: smsTo.trim(), message: smsMessage.trim() }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed to send SMS"); }
        const interaction: ApiInteraction = await res.json();
        setTimeline((prev) => [interaction, ...prev]);
        setSmsMessage("");
        setToast({ message: "SMS sent & logged!", type: "success" });
      } else if (activeTab === "Email") {
        // Template id 6 = "Beneficiary Information Update Required"
        const emailPayload: Record<string, unknown> = {
          customerId: params.id, agentId: user?.id ?? null,
          overrideEmail: emailTo.trim(), subject: emailSubject.trim(), message: emailBody.trim(),
        };
        if (selectedTemplateId === 6) {
          emailPayload.templateId = 6;
          emailPayload.templateData = { transferId: beneficiaryTransferId.trim(), amount: beneficiaryAmount.trim() };
        }
        const res = await apiFetch("/api/communicate/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailPayload),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed to send email"); }
        const interaction: ApiInteraction = await res.json();
        setTimeline((prev) => [interaction, ...prev]);
        setEmailSubject(""); setEmailBody("");
        setSelectedTemplateId(null); setBeneficiaryTransferId(""); setBeneficiaryAmount("");
        setToast({ message: "Email sent & logged!", type: "success" });
      } else {
        const res = await apiFetch("/api/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: params.id, agentId: user?.id ?? null, type: "Note", outcome: noteOutcome, note: noteOutcome }),
        });
        if (res.ok) {
          const interaction: ApiInteraction = await res.json();
          setTimeline((prev) => [interaction, ...prev]);
          setNoteOutcome(NOTE_PLACEHOLDER);
          setToast({ message: "Note saved!", type: "success" });
        }
      }
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Something went wrong", type: "error" });
    } finally {
      setSending(false);
    }
  }

  const isSendDisabled =
    sending ||
    (activeTab === "SMS"   && (!smsTo.trim() || !smsMessage.trim())) ||
    (activeTab === "Email" && (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim())) ||
    (activeTab === "Note"  && noteOutcome === NOTE_PLACEHOLDER);

  const isCallActive = callState !== "idle" && callerInfo === (lead?.full_name ?? smsTo);
  const smsTemplates   = templates.filter((t) => t.channel === "SMS");
  const emailTemplates = templates.filter((t) => t.channel === "Email");
  const labels         = getLabels(lead?.labels);

  // ── Loading / not found states ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">Loading lead profile…</span>
      </div>
    );
  }

  if (notFound || !lead) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle size={48} className="text-slate-300" />
        <p className="text-lg font-medium text-slate-500">Lead not found</p>
        <button onClick={() => router.push("/leads")} className="font-medium text-indigo-600 hover:text-indigo-800">
          Back to pipeline
        </button>
      </div>
    );
  }

  const initials = (lead.full_name ?? "?").split(" ").slice(0, 2).map((n) => n[0]).join("");
  const currentStage = lead.lead_stage ?? "New";

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed right-4 top-4 z-[100] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-xl ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Back button + Prev/Next navigation */}
      <div className="flex items-center justify-between gap-4">
        <button onClick={() => router.push("/leads")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
          <ArrowLeft size={16} /> Back to Pipeline
        </button>

        {queue.length > 0 && currentIdx !== -1 && (
          <div className="flex items-center gap-2">
            <button
              disabled={!prevId}
              onClick={() => prevId && router.push(`/leads/${prevId}`)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={13} /> Prev
            </button>
            <span className="text-xs text-slate-400">{currentIdx + 1} / {queue.length}</span>
            <button
              disabled={!nextId}
              onClick={() => nextId && router.push(`/leads/${nextId}`)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/* ── Lead Profile Card ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-xl font-bold text-white">
              {initials}
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight text-slate-900">{lead.full_name ?? "—"}</h1>
              <p className="mt-0.5 font-mono text-xs text-slate-400">{lead.customer_id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 shadow-sm hover:border-indigo-300 hover:text-indigo-600 transition"
            >
              <Pencil size={13} /> Edit
            </button>
            {/* Lead Stage badge */}
            <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${STAGE_COLORS[currentStage as LeadStage]}`}>
              {currentStage}
            </span>
          </div>
        </div>

        {/* Contact details */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Mail size={15} className="flex-shrink-0 text-slate-400" />
            <span className="truncate">{lead.email ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Phone size={15} className="flex-shrink-0 text-slate-400" />
            {lead.phone_number ? (
              <button
                type="button"
                onClick={() => {
                  const phone = normalizePhone(lead.phone_number!, lead.country);
                  setSmsTo(phone); setActiveTab("Call");
                  makeCall(phone, lead.full_name ?? undefined, params.id);
                }}
                className="group flex items-center gap-1 hover:text-indigo-600"
              >
                <span className="group-hover:underline">{normalizePhone(lead.phone_number, lead.country)}</span>
                <Phone size={11} className="opacity-0 transition-opacity group-hover:opacity-100 text-indigo-500" />
              </button>
            ) : <span>—</span>}
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <MapPin size={15} className="flex-shrink-0 text-slate-400" />
            <span>{lead.country ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Calendar size={15} className="flex-shrink-0 text-slate-400" />
            <span>Created {formatDate(lead.created_at)}</span>
          </div>
          {lead.assigned_agent_name && (
            <div className="flex items-center gap-2.5 text-sm text-slate-600">
              <User size={15} className="flex-shrink-0 text-slate-400" />
              <span>{lead.assigned_agent_name}</span>
            </div>
          )}
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {labels.map((lbl) => (
              <span key={lbl} className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                <Tag size={10} /> {lbl}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Lead Stage Panel ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
          <ChevronDown size={16} className="text-sky-500" />
          Lead Stage
        </h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((stage) => (
            <button
              key={stage}
              disabled={stageSaving || currentStage === stage}
              onClick={() => updateStage(stage)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${
                currentStage === stage
                  ? `${STAGE_COLORS[stage]} ring-2 ring-offset-1 ring-current`
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
              }`}
            >
              {stage}
            </button>
          ))}
        </div>
        {stageSaving && <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Saving…</p>}
      </div>

      {/* ── Comms Panel ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {LOGGER_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setSelectedTemplate(""); }}
              className={`flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-semibold transition ${
                activeTab === key
                  ? "border-b-2 border-indigo-500 text-indigo-600"
                  : "text-slate-400 hover:text-slate-700"
              }`}
            >
              <Icon size={13} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* ── SMS ── */}
          {activeTab === "SMS" && (
            <div className="space-y-3">
              {smsTemplates.length > 0 && (
                <select value={selectedTemplate}
                  onChange={(e) => { setSelectedTemplate(e.target.value); applyTemplate(e.target.value); }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 outline-none focus:border-indigo-400">
                  <option value="">— Use a template —</option>
                  {smsTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <input value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="+447911…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <textarea value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)}
                placeholder="Type your message…" rows={4}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </div>
          )}

          {/* ── Email ── */}
          {activeTab === "Email" && (
            <div className="space-y-3">
              {emailTemplates.length > 0 && (
                <select value={selectedTemplate}
                  onChange={(e) => { setSelectedTemplate(e.target.value); applyTemplate(e.target.value); }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 outline-none focus:border-indigo-400">
                  <option value="">— Use a template —</option>
                  {emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="to@example.com" type="email"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Subject"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Email body…" rows={5}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              {/* Beneficiary template extra fields — shown only when template id=6 is active */}
              {selectedTemplateId === 6 && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-700">Beneficiary Issue Details</p>
                  <input type="text" value={beneficiaryTransferId}
                    onChange={(e) => setBeneficiaryTransferId(e.target.value)}
                    placeholder="Transfer ID (e.g. TAS-12345)"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                  <input type="text" value={beneficiaryAmount}
                    onChange={(e) => setBeneficiaryAmount(e.target.value)}
                    placeholder="Amount (e.g. £500 GBP)"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </div>
              )}
            </div>
          )}

          {/* ── Note ── */}
          {activeTab === "Note" && (
            <div className="space-y-3">
              <select value={noteOutcome} onChange={(e) => setNoteOutcome(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 outline-none focus:border-indigo-400">
                {NOTE_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}

          {/* ── Call ── */}
          {activeTab === "Call" && (
            <div className="space-y-3">
              <input value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="+447911…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              {isCallActive ? (
                <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">Call in progress…</p>
                    <p className="font-mono text-sm text-slate-500">{callDuration}</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={toggleMute}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition ${isMuted ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                      {isMuted ? "Unmute" : "Mute"}
                    </button>
                    <button onClick={hangUp}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700">
                      <PhoneOff size={15} /> Hang up
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  disabled={!smsTo.trim()}
                  onClick={() => makeCall(smsTo.trim(), lead.full_name ?? undefined, params.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Phone size={16} /> Dial
                </button>
              )}
            </div>
          )}

          {/* Send button (SMS / Email / Note) */}
          {activeTab !== "Call" && (
            <button
              onClick={handleSend} disabled={isSendDisabled}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {activeTab === "Note" ? "Save Note" : `Send ${activeTab}`}
            </button>
          )}
        </div>
      </div>

      {/* ── Activity Timeline ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
          <MessageSquare size={16} className="text-indigo-500" />
          Activity
          {timeline.length > 0 && (
            <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
              {timeline.length}
            </span>
          )}
        </h2>

        {timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <MessageSquare size={32} className="text-slate-200" />
            <p className="text-sm text-slate-400">No activity yet</p>
          </div>
        ) : (
          <ol className="relative border-l border-slate-100 pl-4">
            {timeline.map((item) => (
              <li key={item.id} className="mb-5 last:mb-0">
                <div className="absolute -left-1.5 mt-1 flex h-3 w-3 items-center justify-center">
                  <span className={`h-3 w-3 rounded-full ${timelineColor(item.type).split(" ")[0]}`} />
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${timelineColor(item.type)}`}>
                        {timelineIcon(item.type)}
                      </span>
                      <p className="text-xs font-semibold text-slate-700">
                        {item.type}
                        {item.outcome && <span className="ml-1 font-normal text-slate-400">— {item.outcome}</span>}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-slate-400">{formatRelative(item.created_at)}</span>
                  </div>

                  {item.type === "SMS" && item.direction === "inbound" && (
                    <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                      ← Inbound SMS
                    </span>
                  )}

                  {item.note && (
                    <p className="mt-0.5 ml-8 whitespace-pre-wrap text-sm text-slate-500">{item.note}</p>
                  )}

                  {item.type === "Call" && item.call_duration_seconds != null && (
                    <p className="ml-8 text-xs text-slate-400">Duration: {formatDuration(item.call_duration_seconds)}</p>
                  )}

                  {item.recording_url && (
                    <a href={item.recording_url} target="_blank" rel="noreferrer"
                      className="ml-8 mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
                      <PlayCircle size={13} /> Play Recording
                    </a>
                  )}

                  <p className="ml-8 text-xs text-slate-400">{item.agent_name ?? "System"}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Edit Lead Modal */}
      {editOpen && lead && (
        <EditLeadModal
          lead={lead}
          agents={agents}
          existingLabels={existingLabels}
          onClose={() => setEditOpen(false)}
          onUpdated={(updated) => {
            setLead(updated);
            setToast({ message: "Lead updated", type: "success" });
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}
