"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Phone,
  PhoneOff,
  MapPin,
  Calendar,
  AtSign,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Send,
  CheckCircle,
  XCircle,
  ArrowRight,
  Zap,
  Mic,
  MicOff,
  PlayCircle,
  ClipboardList,
  Circle,
  Minus,
  ExternalLink,
} from "lucide-react";
import { normalizePhone } from "@/src/lib/phoneUtils";
import { apiFetch } from "@/src/lib/apiFetch";
import { useQueue, type TaskStatus } from "@/src/context/QueueContext";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";
import { useDropdowns } from "@/src/context/DropdownsContext";
import { LogCallModal } from "@/src/components/LogCallModal";
import { AccountLookupPanel } from "@/src/components/AccountLookupPanel";
import { AccountVerificationsList } from "@/src/components/AccountVerificationsList";

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

interface ApiInteraction {
  id: number;
  customer_id: string;
  agent_id: number | null;
  type: "Call" | "Email" | "Note" | "System" | "SMS";
  outcome: string | null;
  call_status: string | null;
  note: string | null;
  direction: string | null;
  metadata: string | null;
  created_at: string;
  agent_name: string | null;
  call_duration_seconds: number | null;
  recording_url: string | null;
  twilio_call_sid: string | null;
}

interface ApiTransfer {
  id: number;
  transaction_ref: string;
  created_at: string | null;
  send_amount: number | null;
  send_currency: string | null;
  receive_amount: number | null;
  receive_currency: string | null;
  destination_country: string | null;
  beneficiary_name: string | null;
  status: string | null;
  hold_reason: string | null;
  payment_method: string | null;
  delivery_method: string | null;
  data_field_id: string | null;
}

interface ApiTemplate {
  id: number;
  name: string;
  channel: "SMS" | "Email";
  subject: string | null;
  body: string;
}

interface CustomerTask {
  id: number;
  customer_id: string;
  title: string;
  description: string | null;
  category: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  status: "Open" | "In_Progress" | "Pending" | "Closed";
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskComment {
  id: number;
  task_id: number;
  agent_id: number;
  agent_name: string | null;
  comment: string;
  created_at: string;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

const FOCUS_PLACEHOLDER = "Select outcome...";

function outcomeToStatus(outcome: string): TaskStatus {
  return outcome === "Not Interested" || outcome === "Wrong Number"
    ? "closed"
    : "follow-up";
}

const NOTE_PLACEHOLDER = "Select outcome...";

const LOGGER_TABS = [
  { key: "SMS" as const, label: "Send SMS", icon: MessageSquare },
  { key: "Email" as const, label: "Send Email", icon: AtSign },
  { key: "Note" as const, label: "Log Note", icon: FileText },
  { key: "Call" as const, label: "Call", icon: Phone },
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

export default function CustomerProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { queuePosition, sortedQueue, activeTab: queueTab, setTaskStatus } = useQueue();
  const { makeCall, callState, callerInfo, callDuration, isMuted, toggleMute, hangUp } = useTwilioVoice();
  const { focusOutcomes: dbFocusOutcomes, noteOutcomes: dbNoteOutcomes } = useDropdowns();

  // Build runtime arrays with placeholder; fall back to hardcoded if DB not loaded yet
  const FOCUS_OUTCOMES = [
    FOCUS_PLACEHOLDER,
    ...(dbFocusOutcomes.length > 0
      ? dbFocusOutcomes
      : ["No Answer","Left Voicemail","Left SMS","Promised to Upload ID",
         "Guided Through App","Requested Call Back","Not Interested","Wrong Number"]),
  ];
  const NOTE_OUTCOMES = [
    NOTE_PLACEHOLDER,
    ...(dbNoteOutcomes.length > 0
      ? dbNoteOutcomes
      : ["Left Voicemail","Requested Callback","Number Dis","Not Interested","Sent WhatsApp Info","Invalid Details"]),
  ];

  const focusPosition = queuePosition(params.id);
  const [customer, setCustomer] = useState<ApiCustomer | null>(null);
  const [timeline, setTimeline] = useState<ApiInteraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [verificationsKey, setVerificationsKey] = useState(0);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  const [activeTab, setActiveTab] = useState<LoggerTab>("SMS");
  const [smsTo, setSmsTo] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [smsMessage, setSmsMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [noteOutcome, setNoteOutcome] = useState(NOTE_PLACEHOLDER);
  const [noteText, setNoteText] = useState("");
  const [sending, setSending] = useState(false);
  const [focusOutcome, setFocusOutcome] = useState<string>(FOCUS_PLACEHOLDER);
  const [focusNote, setFocusNote] = useState("");
  const [focusSending, setFocusSending] = useState(false);
  const [logCallOpen, setLogCallOpen] = useState(false);

  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [beneficiaryTransferId, setBeneficiaryTransferId] = useState("");
  const [beneficiaryAmount, setBeneficiaryAmount] = useState("");

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning";
  } | null>(null);

  const [transfers, setTransfers] = useState<ApiTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transferPage, setTransferPage] = useState(1);
  const [transferTotal, setTransferTotal] = useState(0);
  const TRANSFERS_PER_PAGE = 10;

  // ── tasks state ────────────────────────────────────────────────────────────
  const [customerTasks, setCustomerTasks] = useState<CustomerTask[]>([]);
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksTab, setTasksTab] = useState<"active" | "history">("active");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    apiFetch(`/api/customers/${params.id}`)
      .then((r) => {
        if (r.status === 403 || r.status === 404) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setCustomer(data.customer);
        setTimeline(data.timeline ?? []);
        setSmsTo(data.customer.phone_number ? normalizePhone(data.customer.phone_number, data.customer.country) : "");
        setEmailTo(data.customer.email ?? "");
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [params.id]);

  useEffect(() => {
    if (loading || notFound) return;
    setTransfersLoading(true);
    apiFetch(
      `/api/transfers/${params.id}?page=${transferPage}&limit=${TRANSFERS_PER_PAGE}`
    )
      .then((r) => r.json())
      .then((data) => {
        setTransfers(data.data ?? []);
        setTransferTotal(data.total ?? 0);
        setTransfersLoading(false);
      })
      .catch(() => setTransfersLoading(false));
  }, [params.id, transferPage, loading, notFound]);

  useEffect(() => {
    apiFetch("/api/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // ── tasks fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || notFound) return;
    setTasksLoading(true);
    apiFetch(`/api/todos?customerId=${encodeURIComponent(params.id)}&view=all&limit=100`)
      .then((r) => r.json())
      .then(async (data) => {
        const tasks: CustomerTask[] = data.data ?? [];
        setCustomerTasks(tasks);
        // Fetch comments for all tasks to show action history
        const allComments: TaskComment[] = [];
        await Promise.all(
          tasks.map((t) =>
            apiFetch(`/api/todos/${t.id}/comments`)
              .then((r) => r.json())
              .then((d) => { allComments.push(...(d.data ?? [])); })
              .catch(() => {})
          )
        );
        allComments.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setTaskComments(allComments);
        setTasksLoading(false);
      })
      .catch(() => setTasksLoading(false));
  }, [params.id, loading, notFound]);

  const applyTemplate = useCallback(
    (templateId: string) => {
      if (!templateId || !customer) return;
      const tpl = templates.find((t) => String(t.id) === templateId);
      if (!tpl) return;
      const fill = (str: string) =>
        str
          .replace(/\{\{fullName\}\}/g, customer.full_name ?? "")
          .replace(/\{\{customerName\}\}/g, customer.full_name ?? "")
          .replace(/\{\{country\}\}/g, customer.country ?? "");
      if (activeTab === "SMS") {
        setSmsMessage(fill(tpl.body));
      } else if (activeTab === "Email") {
        setEmailBody(fill(tpl.body));
        if (tpl.subject) setEmailSubject(fill(tpl.subject));
      }
      setSelectedTemplate("");
      setSelectedTemplateId(tpl.id);
    },
    [templates, customer, activeTab]
  );

  const handleTabChange = useCallback((tab: LoggerTab) => {
    setActiveTab(tab);
    setSelectedTemplate("");
    setSelectedTemplateId(null);
    setBeneficiaryTransferId("");
    setBeneficiaryAmount("");
  }, []);

  async function handleSend() {
    if (sending) return;
    setSending(true);
    try {
      if (activeTab === "SMS") {
        const res = await apiFetch("/api/communicate/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: params.id,
            requestId: createRequestId(),
            overridePhone: smsTo.trim(),
            message: smsMessage.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          if (res.status === 429) {
            setToast({ message: err.error ?? "Please wait before sending another message.", type: "warning" });
            return;
          }
          throw new Error(err.error ?? "Failed to send SMS");
        }
        const interaction: ApiInteraction = await res.json();
        setTimeline((prev) => [interaction, ...prev]);
        setSmsMessage("");
        setToast({ message: "SMS sent & logged!", type: "success" });
      } else if (activeTab === "Email") {
        // Template id 6 = "Beneficiary Information Update Required"
        const emailPayload: Record<string, unknown> = {
          customerId: params.id,
          requestId: createRequestId(),
          overrideEmail: emailTo.trim(),
          subject: emailSubject.trim(),
          message: emailBody.trim(),
        };
        if (selectedTemplateId === 6) {
          emailPayload.templateId = 6;
          emailPayload.templateData = {
            transferId: beneficiaryTransferId.trim(),
            amount: beneficiaryAmount.trim(),
          };
        }
        const res = await apiFetch("/api/communicate/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailPayload),
        });
        if (!res.ok) {
          const err = await res.json();
          if (res.status === 429) {
            setToast({ message: err.error ?? "Please wait before sending another message.", type: "warning" });
            return;
          }
          throw new Error(err.error ?? "Failed to send email");
        }
        const interaction: ApiInteraction = await res.json();
        setTimeline((prev) => [interaction, ...prev]);
        setEmailSubject("");
        setEmailBody("");
        setSelectedTemplateId(null);
        setBeneficiaryTransferId("");
        setBeneficiaryAmount("");
        setToast({ message: "Email sent & logged!", type: "success" });
      } else {
        const res = await apiFetch("/api/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: params.id,
            type: "Note",
            outcome: noteOutcome,
            note: noteText.trim() || noteOutcome,
          }),
        });
        if (res.ok) {
          const interaction: ApiInteraction = await res.json();
          setTimeline((prev) => [interaction, ...prev]);
          setNoteOutcome(NOTE_PLACEHOLDER);
          setNoteText("");
          setToast({ message: "Note saved!", type: "success" });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setToast({ message: msg, type: "error" });
    } finally {
      setSending(false);
    }
  }

  const smsTemplates = templates.filter((t) => t.channel === "SMS");
  const emailTemplates = templates.filter((t) => t.channel === "Email");

  // - Focus Mode save handler -------------------------------------------------
  async function handleFocusSave(andNext: boolean) {
    if (focusSending || focusOutcome === FOCUS_PLACEHOLDER) return;
    setFocusSending(true);

    // Compute next customer BEFORE status change to avoid stale queue lookup
    const currentQueue = sortedQueue(queueTab);
    const currentIndex = currentQueue.findIndex(
      (c) => c.customer_id === params.id
    );
    const nextCustomer = currentQueue[currentIndex + 1] ?? null;

    try {
      const res = await apiFetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: params.id,
          type: "Note",
          outcome: focusOutcome,
          note: focusNote.trim() || null,
        }),
      });
      if (res.ok) {
        const interaction: ApiInteraction = await res.json();
        setTimeline((prev) => [interaction, ...prev]);
        setTaskStatus(params.id, outcomeToStatus(focusOutcome));
        setFocusOutcome(FOCUS_PLACEHOLDER);
        setFocusNote("");
        if (andNext) {
          if (nextCustomer) {
            router.push(`/customer/${nextCustomer.customer_id}`);
          } else {
            setToast({ message: "Queue complete! ??", type: "success" });
            setTimeout(() => router.push("/my-tasks"), 1800);
          }
        } else {
          router.push("/my-tasks");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setToast({
          message:
            (errData as { error?: string }).error ?? "Failed to save",
          type: "error",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setToast({ message: msg, type: "error" });
    } finally {
      setFocusSending(false);
    }
  }

  const isCallActive = callState !== "idle" && callerInfo === (customer?.full_name ?? smsTo);

  const isSendDisabled =
    sending ||
    (activeTab === "SMS" && (!smsTo.trim() || !smsMessage.trim())) ||
    (activeTab === "Email" && (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim())) ||
    (activeTab === "Note" &&
      (noteOutcome === NOTE_PLACEHOLDER));

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">Loading profile...</span>
      </div>
    );
  }

  if (notFound || !customer) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle size={48} className="text-slate-300" />
        <p className="text-lg font-medium text-slate-500">Customer not found</p>
        <button
          onClick={() => router.back()}
          className="font-medium text-indigo-600 hover:text-indigo-800"
        >
          Go back
        </button>
      </div>
    );
  }

  const initials = (customer.full_name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");

  const isKycDone = !!customer.kyc_completion_date;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">

      {toast && (
        <div
          className={`fixed right-4 top-4 z-[100] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-xl ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : toast.type === "warning"
                ? "bg-amber-500 text-white"
                : "bg-red-600 text-white"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle size={16} />
          ) : toast.type === "warning" ? (
            <Clock size={16} />
          ) : (
            <XCircle size={16} />
          )}
          {toast.message}
        </div>
      )}

      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xl font-bold text-white">
              {initials}
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight text-slate-900">
                {customer.full_name ?? "-"}
              </h1>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(customer.customer_id)}
                title="Copy customer ID"
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 font-mono text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 active:scale-95"
              >
                <AtSign size={11} />
                {customer.customer_id}
              </button>
              {focusPosition && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <Zap size={11} />
                  Queue {focusPosition.index} of {focusPosition.total}
                </p>
              )}
            </div>
          </div>
          <span
            className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              customer.risk_status === "High"
                ? "bg-red-100 text-red-700"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {customer.risk_status === "High" ? (
              <AlertCircle size={11} />
            ) : (
              <CheckCircle2 size={11} />
            )}
            {customer.risk_status ?? "-"} Risk
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Mail size={15} className="flex-shrink-0 text-slate-400" />
            <span className="truncate">{customer.email ?? "-"}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Phone size={15} className="flex-shrink-0 text-slate-400" />
            {customer.phone_number ? (
              <button
                type="button"
                onClick={() => {
                  const phone = normalizePhone(customer.phone_number!, customer.country);
                  setSmsTo(phone);
                  handleTabChange("Call");
                  makeCall(phone, customer.full_name ?? undefined, params.id);
                }}
                title="Click to call"
                className="group flex items-center gap-1 transition-colors hover:text-indigo-600"
              >
                <span className="group-hover:underline">
                  {normalizePhone(customer.phone_number, customer.country)}
                </span>
                <Phone size={11} className="opacity-0 transition-opacity group-hover:opacity-100 text-indigo-500" />
              </button>
            ) : (
              <span>-</span>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <MapPin size={15} className="flex-shrink-0 text-slate-400" />
            <span>{customer.country ?? "-"}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Calendar size={15} className="flex-shrink-0 text-slate-400" />
            <span>Registered {formatDate(customer.registration_date)}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              isKycDone
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            KYC: {isKycDone ? "Completed" : "Pending"}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
            {customer.total_transfers} Transfer
            {customer.total_transfers !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <AccountVerificationsList
        targetType="customer"
        targetId={customer.customer_id}
        refreshKey={verificationsKey}
      />

      <AccountLookupPanel
        attachContext={{
          targetType: "customer",
          targetId: customer.customer_id,
          label: customer.full_name ?? `Customer ${customer.customer_id}`,
        }}
        onAttached={() => setVerificationsKey((k) => k + 1)}
      />

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ArrowRightLeft size={16} className="text-indigo-500" />
            Transfers
            {transferTotal > 0 && (
              <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                {transferTotal}
              </span>
            )}
          </h2>
        </div>

        {transfersLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading transfers...</span>
          </div>
        ) : transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <ArrowRightLeft size={32} className="text-slate-200" />
            <p className="text-sm text-slate-400">No transfers found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="pb-2 pr-3">Date</th>
                    <th className="pb-2 pr-3">Ref</th>
                    <th className="pb-2 pr-3">Tayo Ref</th>
                    <th className="pb-2 pr-3">Send</th>
                    <th className="pb-2 pr-3">Receive</th>
                    <th className="pb-2 pr-3">Beneficiary</th>
                    <th className="pb-2 pr-3">Destination</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {transfers.map((t) => (
                    <tr key={t.id} className="text-slate-700 hover:bg-slate-50">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-500">
                        {t.created_at
                          ? new Date(t.created_at).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "-"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono text-xs text-slate-600">
                          {t.transaction_ref}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono text-xs text-slate-500">
                          {t.data_field_id ?? "-"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3">
                        {t.send_amount != null
                          ? `${t.send_currency ?? ""} ${Number(t.send_amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
                          : "-"}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3">
                        {t.receive_amount != null
                          ? `${t.receive_currency ?? ""} ${Number(t.receive_amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
                          : "-"}
                      </td>
                      <td className="max-w-[120px] truncate py-2.5 pr-3">
                        {t.beneficiary_name ?? "-"}
                      </td>
                      <td className="py-2.5 pr-3">{t.destination_country ?? "-"}</td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            t.status === "Processed"
                              ? "bg-emerald-50 text-emerald-700"
                              : t.status === "Hold"
                                ? "bg-amber-50 text-amber-700"
                                : t.status === "Cancelled"
                                  ? "bg-red-50 text-red-600"
                                  : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {t.status ?? "-"}
                        </span>
                        {t.hold_reason && (
                          <p
                            className="mt-0.5 max-w-[160px] truncate text-xs text-slate-400"
                            title={t.hold_reason}
                          >
                            {t.hold_reason}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {transferTotal > TRANSFERS_PER_PAGE && (
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <p className="text-xs text-slate-400">
                  Showing {(transferPage - 1) * TRANSFERS_PER_PAGE + 1}
                  {`–`}
                  {Math.min(transferPage * TRANSFERS_PER_PAGE, transferTotal)} of{" "}
                  {transferTotal}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setTransferPage((p) => Math.max(1, p - 1))}
                    disabled={transferPage === 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setTransferPage((p) => p + 1)}
                    disabled={transferPage * TRANSFERS_PER_PAGE >= transferTotal}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Communication
        </h2>

        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
          {LOGGER_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all ${
                activeTab === key
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {activeTab === "SMS" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                To (phone number)
              </label>
              <input
                type="tel"
                value={smsTo}
                onChange={(e) => setSmsTo(e.target.value)}
                placeholder="+447xxxxxxxxx"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {smsTemplates.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Insert Template
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">- Select a template -</option>
                  {smsTemplates.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600">
                  Message
                </label>
                <span
                  className={`text-xs font-medium tabular-nums ${
                    smsMessage.length > 140 ? "text-amber-600" : "text-slate-400"
                  }`}
                >
                  {smsMessage.length}/160
                </span>
              </div>
              <textarea
                rows={4}
                maxLength={160}
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                placeholder="Type your SMS message..."
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        )}

        {activeTab === "Email" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                To (email address)
              </label>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="customer@example.com"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {emailTemplates.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Insert Template
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">- Select a template -</option>
                  {emailTemplates.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Subject
              </label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Email subject..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Message
              </label>
              <textarea
                rows={5}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Type your email message..."
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {/* Beneficiary template extra fields - shown only when template id=6 is active */}
            {selectedTemplateId === 6 && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700">
                  Beneficiary Issue Details
                </p>
                <input
                  type="text"
                  value={beneficiaryTransferId}
                  onChange={(e) => setBeneficiaryTransferId(e.target.value)}
                  placeholder="Transfer ID (e.g. TAS-12345)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <input
                  type="text"
                  value={beneficiaryAmount}
                  onChange={(e) => setBeneficiaryAmount(e.target.value)}
                  placeholder="Amount (e.g. £500 GBP)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "Note" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Outcome
              </label>
              <select
                value={noteOutcome}
                onChange={(e) => setNoteOutcome(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {NOTE_OUTCOMES.map((o) => (
                  <option key={o} value={o} disabled={o === NOTE_PLACEHOLDER}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Note <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add extra details or context..."
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        )}

        {activeTab === "Call" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Phone number
              </label>
              <input
                type="tel"
                value={smsTo}
                onChange={(e) => setSmsTo(e.target.value)}
                placeholder="+447xxxxxxxxx"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {callState !== "idle" ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-sm font-semibold text-emerald-800">
                      {callState === "connecting"
                        ? "Connecting..."
                        : callState === "active"
                          ? `${String(Math.floor(callDuration / 60)).padStart(2, "0")}:${String(callDuration % 60).padStart(2, "0")}`
                          : "Incoming"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={toggleMute}
                      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                        isMuted ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    <button
                      onClick={hangUp}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                    >
                      <PhoneOff size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => makeCall(smsTo.trim(), customer?.full_name ?? undefined, params.id)}
                  disabled={!smsTo.trim() || callState !== "idle"}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Phone size={15} />
                  Start Call
                </button>
                <button
                  onClick={() => setLogCallOpen(true)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  <FileText size={15} />
                  Log Offline Call
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={isSendDisabled || activeTab === "Call"}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
            activeTab === "Call" ? "hidden" : ""
          }`}
        >
          {sending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {activeTab === "Note" ? "Saving..." : "Sending..."}
            </>
          ) : (
            <>
              <Send size={14} />
              {activeTab === "Note" ? "Save Note" : `Send ${activeTab}`}
            </>
          )}
        </button>
      </div>

      {/* --- Focus Mode --------------------------------------------------- */}
      {focusPosition && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-emerald-900">
              <Zap size={16} className="text-emerald-600" />
              Focus Mode
            </h2>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
              {focusPosition.index} of {focusPosition.total} in queue
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Call Outcome
              </label>
              <select
                value={focusOutcome}
                onChange={(e) => setFocusOutcome(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {FOCUS_OUTCOMES.map((o) => (
                  <option key={o} value={o} disabled={o === FOCUS_PLACEHOLDER}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Notes (optional)
              </label>
              <textarea
                rows={2}
                value={focusNote}
                onChange={(e) => setFocusNote(e.target.value)}
                placeholder="Add extra context..."
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => handleFocusSave(false)}
              disabled={focusSending || focusOutcome === FOCUS_PLACEHOLDER}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {focusSending && <Loader2 size={14} className="animate-spin" />}
              Save &amp; Close
            </button>
            <button
              onClick={() => handleFocusSave(true)}
              disabled={focusSending || focusOutcome === FOCUS_PLACEHOLDER}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {focusSending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowRight size={14} />
              )}
              Save &amp; Next
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-5 text-base font-semibold text-slate-900">
          Activity Timeline
        </h2>

        {timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <Clock size={32} className="text-slate-200" />
            <p className="text-sm text-slate-400">No activity recorded yet</p>
          </div>
        ) : (
          <ol className="relative">
            <span
              className="absolute bottom-3 left-[18px] top-3 w-px bg-slate-100"
              aria-hidden="true"
            />
            <div className="space-y-5">
              {timeline.map((item) => (
                <li key={item.id} className="relative flex gap-4">
                  <span
                    className={`relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${timelineColor(item.type)}`}
                  >
                    {timelineIcon(item.type)}
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-tight text-slate-800">
                        {item.outcome ?? item.call_status ?? item.type}
                      </p>
                      <span className="flex-shrink-0 text-xs text-slate-400">
                        {formatRelative(item.created_at)}
                      </span>
                    </div>
                    {item.type === "SMS" && item.direction === "inbound" && (
                      <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                        ? Inbound SMS
                      </span>
                    )}
                    {(() => {
                      const note = item.note ?? "";
                      const LIMIT = 200;
                      const isLong = note.length > LIMIT;
                      const expanded = expandedNotes.has(item.id);
                      return (
                        <div>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
                            {isLong && !expanded ? note.slice(0, LIMIT) + "..." : note}
                          </p>
                          {isLong && (
                            <button
                              onClick={() => setExpandedNotes((prev) => {
                                const next = new Set(prev);
                                expanded ? next.delete(item.id) : next.add(item.id);
                                return next;
                              })}
                              className="mt-1 text-xs font-medium text-indigo-500 hover:text-indigo-700"
                            >
                              {expanded ? "View less" : "View more"}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {item.type === "Call" && item.call_duration_seconds != null && (
                      <p className="mt-1 text-xs text-slate-400">
                        Duration: {formatDuration(item.call_duration_seconds)}
                      </p>
                    )}
                    {item.recording_url && (
                      <a
                        href={item.recording_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        <PlayCircle size={13} />
                        Play Recording
                      </a>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      {item.agent_name ?? "System"}
                    </p>
                  </div>
                </li>
              ))}
            </div>
          </ol>
        )}
      </div>

      {/* ── Tasks Card ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ClipboardList size={16} className="text-indigo-500" />
            Tasks
            {customerTasks.length > 0 && (
              <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                {customerTasks.length}
              </span>
            )}
          </h2>
          <a
            href={`/to-do`}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            <ExternalLink size={12} />
            View All
          </a>
        </div>

        {/* Sub-tabs */}
        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["active", "history"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTasksTab(tab)}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-all ${
                tasksTab === tab
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab === "active" ? "Active Tasks" : "Action History"}
            </button>
          ))}
        </div>

        {tasksLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading tasks…</span>
          </div>
        ) : tasksTab === "active" ? (
          (() => {
            const active = customerTasks.filter((t) => t.status !== "Closed");
            return active.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <ClipboardList size={28} className="text-slate-200" />
                <p className="text-sm text-slate-400">No active tasks for this customer</p>
              </div>
            ) : (
              <div className="space-y-2">
                {active.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                      {task.description && (
                        <p className="mt-0.5 truncate text-xs text-slate-400">{task.description}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-400">
                        {task.assigned_agent_name ?? "Unassigned"} · {new Date(task.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      {/* priority */}
                      {(task.priority === "Urgent") && (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">Urgent</span>
                      )}
                      {/* status */}
                      {task.status === "Open" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <Circle size={8} />Open
                        </span>
                      )}
                      {task.status === "In_Progress" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                          <Clock size={8} />In Progress
                        </span>
                      )}
                      {task.status === "Pending" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          <Minus size={8} />Pending
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        ) : (
          (() => {
            return taskComments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <MessageSquare size={28} className="text-slate-200" />
                <p className="text-sm text-slate-400">No action logs yet</p>
              </div>
            ) : (
              <ol className="relative space-y-4">
                <span className="absolute bottom-3 left-[18px] top-3 w-px bg-slate-100" aria-hidden="true" />
                {taskComments.slice(0, 20).map((c) => (
                  <li key={c.id} className="relative flex gap-4">
                    <span className="relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                      <MessageSquare size={14} />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-700">{c.comment}</p>
                        <span className="flex-shrink-0 text-xs text-slate-400">
                          {new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">{c.agent_name ?? "Agent"}</p>
                    </div>
                  </li>
                ))}
              </ol>
            );
          })()
        )}
      </div>

      {logCallOpen && customer && (
        <LogCallModal
          customer={{ customer_id: customer.customer_id, full_name: customer.full_name }}
          onClose={() => {
            setLogCallOpen(false);
            // Refresh timeline after logging a call
            apiFetch(`/api/customers/${params.id}`)
              .then((r) => r.json())
              .then((data) => { if (data?.timeline) setTimeline(data.timeline); })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}



