"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Circle,
  Minus,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

// ─── types ────────────────────────────────────────────────────────────────────

type TaskStatus   = "Open" | "In_Progress" | "Pending" | "Closed";
type TaskPriority = "Low" | "Medium" | "High" | "Urgent";
type TaskCategory = "Query" | "Action" | "KYC" | "Payment_Issue";
type ViewTab      = "mine" | "open" | "closed" | "all" | "results";

interface Task {
  id: number;
  customer_id: string;
  transfer_reference: string | null;
  transfer_id: number | null;
  customer_name: string | null;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Agent {
  id: number;
  name: string;
}

interface Comment {
  id: number;
  task_id: number;
  agent_id: number | null;
  comment: string;
  created_at: string;
  agent_name: string | null;
}

interface CustomerSearchRow {
  customer_id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  country: string | null;
  total_transfers: number;
}

interface CustomerSearchResponse {
  data?: CustomerSearchRow[];
}

interface TransferSearchRow {
  id: number;
  transaction_ref: string;
  data_field_id: string | null;
  send_amount: string;
  send_currency: string;
  receive_amount: string;
  receive_currency: string;
  beneficiary_name: string | null;
  status: string;
  customer_id: string;
  full_name: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function priorityBadge(priority: TaskPriority) {
  const cls: Record<TaskPriority, string> = {
    Urgent: "bg-red-100 text-red-700 ring-1 ring-red-200",
    High:   "bg-orange-100 text-orange-700 ring-1 ring-orange-200",
    Medium: "bg-blue-100 text-blue-700 ring-1 ring-blue-200",
    Low:    "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls[priority]}`}>
      {priority}
    </span>
  );
}

function statusBadge(status: TaskStatus) {
  const cfg: Record<TaskStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    Open:        { cls: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200", icon: <Circle size={10} />,       label: "Open" },
    In_Progress: { cls: "bg-blue-100 text-blue-700 ring-1 ring-blue-200",          icon: <Clock size={10} />,        label: "In Progress" },
    Pending:     { cls: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",        icon: <Minus size={10} />,        label: "Pending" },
    Closed:      { cls: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",        icon: <CheckCircle2 size={10} />, label: "Closed" },
  };
  const { cls, icon, label } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {icon}{label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function categoryLabel(cat: TaskCategory): string {
  return cat === "Payment_Issue" ? "Payment Issue" : cat;
}

// ─── sub-components ───────────────────────────────────────────────────────────

interface CreateTaskModalProps {
  agents: Agent[];
  onClose: () => void;
  onCreated: (task: Task) => void;
}

function CreateTaskModal({ agents, onClose, onCreated }: CreateTaskModalProps) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    customer_id: "",
    transfer_reference: "",
    title: "",
    description: "",
    category: "Query" as TaskCategory,
    priority: "Medium" as TaskPriority,
    assigned_agent_id: user?.id ? String(user.id) : "",
  });
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [customerOptions, setCustomerOptions] = useState<CustomerSearchRow[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [transferQuery, setTransferQuery]       = useState("");
  const [selectedTransfer, setSelectedTransfer] = useState<TransferSearchRow | null>(null);
  const [transferOptions, setTransferOptions]   = useState<TransferSearchRow[]>([]);
  const [transferLoading, setTransferLoading]   = useState(false);
  const [transferOpen, setTransferOpen]         = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const customerRef         = useRef<HTMLDivElement>(null);
  const customerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transferRef         = useRef<HTMLDivElement>(null);
  const transferDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function optionLabel(c: CustomerSearchRow): string {
    return `${c.full_name ?? "Unnamed Customer"} (${c.customer_id})`;
  }

  function optionMeta(c: CustomerSearchRow): string {
    const parts = [
      c.email,
      c.phone_number,
      c.country,
      c.total_transfers > 0 ? `${c.total_transfers} transfers` : "0 transfers",
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function parseRows(data: unknown): CustomerSearchRow[] {
    if (Array.isArray(data)) return data as CustomerSearchRow[];
    if (data && typeof data === "object") {
      const rows = (data as CustomerSearchResponse).data;
      return Array.isArray(rows) ? rows : [];
    }
    return [];
  }

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) {
        setCustomerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (transferRef.current && !transferRef.current.contains(e.target as Node))
        setTransferOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    if (transferDebounceRef.current) clearTimeout(transferDebounceRef.current);
    const q = transferQuery.trim();
    if (q.length < 3) { setTransferOptions([]); return; }
    transferDebounceRef.current = setTimeout(async () => {
      setTransferLoading(true);
      try {
        const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8`);
        const d = await r.json();
        setTransferOptions(Array.isArray(d.data) ? d.data : []);
      } catch { setTransferOptions([]); }
      finally { setTransferLoading(false); }
    }, 300);
    return () => { if (transferDebounceRef.current) clearTimeout(transferDebounceRef.current); };
  }, [transferQuery]);

  function onSelectTransfer(t: TransferSearchRow) {
    setSelectedTransfer(t);
    setTransferQuery(t.transaction_ref);
    setTransferOptions([]);
    setTransferOpen(false);
    setForm((p) => ({ ...p, transfer_reference: t.transaction_ref }));
    if (!selectedCustomer) {
      const synth: CustomerSearchRow = {
        customer_id: t.customer_id, full_name: t.full_name,
        email: null, phone_number: null, country: null, total_transfers: 0,
      };
      setSelectedCustomer(synth);
      setCustomerQuery(t.full_name ? `${t.full_name} (${t.customer_id})` : t.customer_id);
      setForm((p) => ({ ...p, customer_id: t.customer_id }));
    }
  }

  useEffect(() => {
    if (customerDebounceRef.current) clearTimeout(customerDebounceRef.current);

    const q = customerQuery.trim();
    if (!q) {
      setCustomerOptions([]);
      setCustomerLoading(false);
      return;
    }

    customerDebounceRef.current = setTimeout(async () => {
      setCustomerLoading(true);
      try {
        const encoded = encodeURIComponent(q);
        const [searchRes, refRes] = await Promise.all([
          apiFetch(`/api/customers?search=${encoded}&page=1&limit=8`),
          apiFetch(`/api/customers?reference_search=${encoded}&page=1&limit=8`),
        ]);

        const [searchData, refData] = await Promise.all([
          searchRes.ok ? searchRes.json() : Promise.resolve([]),
          refRes.ok ? refRes.json() : Promise.resolve([]),
        ]);

        const merged = [...parseRows(searchData), ...parseRows(refData)];
        const seen = new Set<string>();
        const deduped = merged.filter((c) => {
          if (!c?.customer_id || seen.has(c.customer_id)) return false;
          seen.add(c.customer_id);
          return true;
        });

        setCustomerOptions(deduped);
      } catch {
        setCustomerOptions([]);
      } finally {
        setCustomerLoading(false);
      }
    }, 300);

    return () => {
      if (customerDebounceRef.current) clearTimeout(customerDebounceRef.current);
    };
  }, [customerQuery]);

  function onCustomerQueryChange(value: string) {
    setCustomerQuery(value);
    setCustomerOpen(true);

    if (selectedCustomer && value !== optionLabel(selectedCustomer)) {
      setSelectedCustomer(null);
      setForm((prev) => ({ ...prev, customer_id: "" }));
    }
  }

  function onSelectCustomer(c: CustomerSearchRow) {
    setSelectedCustomer(c);
    setCustomerQuery(optionLabel(c));
    setForm((prev) => ({ ...prev, customer_id: c.customer_id }));
    setCustomerOptions([]);
    setCustomerOpen(false);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer || !form.customer_id.trim()) { setError("Please select a customer"); return; }
    if (!form.title.trim())       { setError("Title is required");       return; }
    setError("");
    setSaving(true);
    try {
      const res = await apiFetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id:       form.customer_id.trim(),
          transfer_reference: form.transfer_reference.trim() || null,
          title:             form.title.trim(),
          description:       form.description.trim() || null,
          category:          form.category,
          priority:          form.priority,
          assigned_agent_id: form.assigned_agent_id ? Number(form.assigned_agent_id) : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create task");
        return;
      }
      const task: Task = await res.json();
      onCreated(task);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">New To-Do</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle size={14} className="shrink-0" />{error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative" ref={customerRef}>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Customer *</label>
            <div className="relative">
              <input
                type="text"
                className={inputCls}
                placeholder="Search by name, email, phone, ID or transfer ref"
                value={customerQuery}
                onFocus={() => setCustomerOpen(true)}
                onChange={(e) => onCustomerQueryChange(e.target.value)}
              />
              {customerLoading && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
              )}
            </div>

            {customerOpen && (
              <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {customerLoading && customerOptions.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-3 text-sm text-slate-500">
                    <Loader2 size={14} className="animate-spin" />
                    Searching customers...
                  </div>
                ) : customerQuery.trim() && customerOptions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-slate-500">No customers found</div>
                ) : customerOptions.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {customerOptions.map((c) => (
                      <button
                        key={c.customer_id}
                        type="button"
                        onClick={() => onSelectCustomer(c)}
                        className="w-full px-3 py-2.5 text-left transition hover:bg-slate-50"
                      >
                        <p className="truncate text-sm font-medium text-slate-800">{optionLabel(c)}</p>
                        <p className="truncate text-xs text-slate-500">{optionMeta(c)}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-3 text-sm text-slate-500">Start typing to search customers</div>
                )}
              </div>
            )}
          </div>
          <div className="relative" ref={transferRef}>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Transfer Reference (optional)</label>
            <div className="relative">
              <input
                type="text"
                className={inputCls}
                placeholder="Search by ref e.g. txn12345"
                value={transferQuery}
                onFocus={() => setTransferOpen(true)}
                onChange={(e) => {
                  const v = e.target.value;
                  setTransferQuery(v);
                  setTransferOpen(true);
                  setForm((p) => ({ ...p, transfer_reference: v }));
                  if (selectedTransfer && v !== selectedTransfer.transaction_ref) setSelectedTransfer(null);
                }}
              />
              {transferLoading && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
              )}
            </div>
            {selectedTransfer && (
              <div className="mt-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                <div className="flex items-center justify-between font-medium">
                  <span>{selectedTransfer.transaction_ref}</span>
                  <span>{selectedTransfer.send_amount} {selectedTransfer.send_currency} → {selectedTransfer.receive_amount} {selectedTransfer.receive_currency}</span>
                </div>
                <p className="mt-0.5 text-indigo-500">{selectedTransfer.full_name ?? selectedTransfer.customer_id} → {selectedTransfer.beneficiary_name ?? "Unknown beneficiary"}</p>
              </div>
            )}
            {transferOpen && transferQuery.trim().length >= 3 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {transferOptions.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {transferOptions.map((t) => (
                      <button key={t.id} type="button" onClick={() => onSelectTransfer(t)}
                              className="w-full px-3 py-2.5 text-left transition hover:bg-slate-50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-800">{t.transaction_ref}</span>
                          <span className="text-[10px] font-semibold text-slate-500 capitalize">{t.status}</span>
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {t.full_name ?? t.customer_id} → {t.beneficiary_name ?? "?"} · {t.send_amount} {t.send_currency}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : !transferLoading ? (
                  <div className="px-3 py-3 text-sm text-slate-500">No transfers found</div>
                ) : null}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Title *</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. USD Transfer Follow-up"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Category</label>
              <select className={inputCls} value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value as TaskCategory })}>
                <option value="Query">Query</option>
                <option value="Action">Action</option>
                <option value="KYC">KYC</option>
                <option value="Payment_Issue">Payment Issue</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Priority</label>
              <select className={inputCls} value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Assign to</label>
            <select className={inputCls} value={form.assigned_agent_id}
                    onChange={(e) => setForm({ ...form, assigned_agent_id: e.target.value })}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              placeholder="Optional — add any relevant context"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CloseTaskModalProps {
  task: Task;
  onClose: () => void;
  onClosed: (task: Task) => void;
}

function CloseTaskModal({ task, onClose, onClosed }: CloseTaskModalProps) {
  const [form, setForm] = useState({
    transfer_reference: task.transfer_reference || "",
  });
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) { setError("Resolution comment is required to close this task."); return; }
    setError("");
    setSaving(true);
    try {
      const updates: Record<string, any> = { status: "Closed", resolution_comment: comment.trim() };
      if (form.transfer_reference !== task.transfer_reference) {
        updates.transfer_reference = form.transfer_reference.trim() || null;
      }
      const res = await apiFetch(`/api/todos/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to close task");
        return;
      }
      const updated: Task = await res.json();
      onClosed(updated);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Close Task</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500 truncate">{task.title}</p>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle size={14} className="shrink-0" />{error}
          </div>
        )}

        <form onSubmit={handleClose} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Transfer Reference (optional)</label>
            <input
              type="text"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="e.g. txn_12345 or efu_67890"
              value={form.transfer_reference}
              onChange={(e) => setForm({ ...form, transfer_reference: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Final Resolution <span className="text-red-500">*</span>
            </label>
            <textarea
              autoFocus
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
              rows={4}
              placeholder="Describe how this task was resolved…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !comment.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              <CheckCircle2 size={14} />
              Close Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── CommentsList ──────────────────────────────────────────────────────────────

function CommentsList({ taskId, commentKey }: { taskId: number; commentKey: number }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/todos/${taskId}/comments`)
      .then((r) => r.json())
      .then((d) => setComments(Array.isArray(d.data) ? d.data : []))
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [taskId, commentKey]);

  if (loading) return <Loader2 size={12} className="animate-spin text-slate-400 my-2" />;
  if (comments.length === 0) return null;

  return (
    <ul className="mb-2 space-y-1.5">
      {comments.map((c) => (
        <li key={c.id} className="rounded-lg bg-white border border-slate-100 px-3 py-2 text-xs text-slate-700">
          <span className="font-medium text-slate-500">{c.agent_name ?? "Agent"}</span>
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="text-slate-400">{formatDate(c.created_at)}</span>
          <p className="mt-0.5 text-slate-700">{c.comment}</p>
        </li>
      ))}
    </ul>
  );
}

// ─── AddCommentInline ─────────────────────────────────────────────────────────

interface AddCommentProps {
  taskId: number;
  onAdded: () => void;
}

function AddCommentInline({ taskId, onAdded }: AddCommentProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/todos/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: text.trim() }),
      });
      if (res.ok) { setText(""); setOpen(false); onAdded(); }
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800">
        <MessageSquare size={12} />Log action
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 flex gap-2 items-start">
      <textarea
        autoFocus
        rows={2}
        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
        placeholder="e.g. Called bank, emailed customer…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-col gap-1">
        <button type="submit" disabled={saving || !text.trim()}
                className="rounded-lg bg-indigo-600 px-2 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-50">
          {saving ? <Loader2 size={11} className="animate-spin" /> : "Add"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setText(""); }}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

const TABS: { key: ViewTab; label: string }[] = [
  { key: "mine",   label: "My Tasks" },
  { key: "open",   label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all",    label: "All Tasks" },
];

const PAGE_SIZE = 50;

export default function ToDoPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [view, setView]             = useState<ViewTab>("mine");
  const [prevView, setPrevView]     = useState<Exclude<ViewTab, "results">>("mine");
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [closeTarget, setCloseTarget] = useState<Task | null>(null);
  const [agents, setAgents]         = useState<Agent[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Auto-switch to "results" tab when search activates, back when cleared
  useEffect(() => {
    if (debouncedSearch) {
      if (view !== "results") {
        setPrevView(view as Exclude<ViewTab, "results">);
        setView("results");
      }
    } else {
      if (view === "results") setView(prevView);
    }
  }, [debouncedSearch]);

  // Load agents once
  useEffect(() => {
    apiFetch("/api/todos/agents")
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Load tasks
  const loadTasks = useCallback(() => {
    setLoading(true);
    const apiView = view === "results" ? "all" : view;
    const p = new URLSearchParams({ view: apiView, page: String(page), limit: String(PAGE_SIZE) });
    if (debouncedSearch) p.set("search", debouncedSearch);
    apiFetch(`/api/todos?${p.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.data ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [view, page, debouncedSearch, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Reset page on tab/search change
  useEffect(() => { setPage(1); }, [view, debouncedSearch]);

  const pages = Math.ceil(total / PAGE_SIZE);

  function handleCreated(task: Task) {
    setShowCreate(false);
    // If the new task belongs to the current view, prepend it; otherwise reload
    setRefreshTick((t) => t + 1);
  }

  function handleClosed(updated: Task) {
    setCloseTarget(null);
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    // Remove from non-closed views immediately
    if (view !== "closed" && view !== "all") {
      setTasks((prev) => prev.filter((t) => t.id !== updated.id));
    }
  }

  const visibleTabs = debouncedSearch
    ? [{ key: "results" as ViewTab, label: "Results" }, ...TABS]
    : TABS;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* ── Header ── */}
      <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <ClipboardList size={16} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">To Do</h1>
              <p className="text-xs text-slate-500">Task management &amp; action logs</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus size={15} />New Task
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-6 md:px-8">
        {/* ── Tabs + Search ── */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1.5 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`whitespace-nowrap rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  view === tab.key
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-full rounded-xl border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        {/* ── Desktop Table ── */}
        <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm md:block">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-20 text-center text-sm text-slate-400">
              No tasks found for this view.
            </div>
          ) : (
            <table className="min-w-[960px] w-full table-auto text-left">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 pl-5 pr-3">Priority</th>
                  <th className="py-3 px-3">Title</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Assigned To</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Updated</th>
                  <th className="py-3 px-3 pr-5" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onClose={() => setCloseTarget(task)}
                    onCommentAdded={() => setRefreshTick((t) => t + 1)}
                    onNavigateCustomer={() => router.push(`/customer/${task.customer_id}`)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Mobile Cards ── */}
        <div className="space-y-3 md:hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-20 text-center text-sm text-slate-400">No tasks found.</div>
          ) : (
            tasks.map((task) => (
              <MobileTaskCard
                key={task.id}
                task={task}
                onClose={() => setCloseTarget(task)}
                onCommentAdded={() => setRefreshTick((t) => t + 1)}
                onNavigateCustomer={() => router.push(`/customer/${task.customer_id}`)}
              />
            ))
          )}
        </div>

        {/* ── Pagination ── */}
        {pages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm ${
                    page === p
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              disabled={page === pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showCreate && (
        <CreateTaskModal
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
      {closeTarget && (
        <CloseTaskModal
          task={closeTarget}
          onClose={() => setCloseTarget(null)}
          onClosed={handleClosed}
        />
      )}
    </div>
  );
}

// ─── TaskRow (desktop) ────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task;
  onClose: () => void;
  onCommentAdded: () => void;
  onNavigateCustomer: () => void;
}

function TaskRow({ task, onClose, onCommentAdded, onNavigateCustomer }: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [commentKey, setCommentKey] = useState(0);

  function handleCommentAdded() {
    setCommentKey((k) => k + 1);
    onCommentAdded();
  }

  return (
    <>
      <tr
        className="group cursor-pointer border-t border-slate-100 transition hover:bg-slate-50/70"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-3 pl-5 pr-3">{priorityBadge(task.priority)}</td>
        <td className="py-3 px-3 max-w-[220px]">
          <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
          {task.description && (
            <p className="mt-0.5 truncate text-xs text-slate-400">{task.description}</p>
          )}
        </td>
        <td className="py-3 px-3">
          <button
            onClick={(e) => { e.stopPropagation(); onNavigateCustomer(); }}
            className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {task.customer_name ?? task.customer_id}
            <ExternalLink size={11} />
          </button>
        </td>
        <td className="py-3 px-3">
          <span className="text-sm text-slate-600">
            {task.assigned_agent_name ?? <span className="italic text-slate-400">Unassigned</span>}
          </span>
        </td>
        <td className="py-3 px-3">
          <span className="text-xs text-slate-500">{categoryLabel(task.category)}</span>
        </td>
        <td className="py-3 px-3">{statusBadge(task.status)}</td>
        <td className="py-3 px-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(task.updated_at)}</td>
        <td className="py-3 pl-3 pr-5">
          {task.status !== "Closed" && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 opacity-0 transition hover:bg-emerald-100 group-hover:opacity-100"
            >
              Close
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50/40">
          <td colSpan={8} className="px-5 py-3">
            {task.description && (
              <p className="mb-2 text-sm text-slate-600">{task.description}</p>
            )}
            {task.transfer_reference && (
              <a
                href={task.transfer_id ? `/transfers/${task.transfer_id}` : `/transfers?search=${encodeURIComponent(task.transfer_reference ?? "")}`}
                className="mb-2 inline-flex items-center rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
              >
                Transfer: {task.transfer_reference}
                <ExternalLink size={10} className="ml-1" />
              </a>
            )}
            <CommentsList taskId={task.id} commentKey={commentKey} />
            <AddCommentInline taskId={task.id} onAdded={handleCommentAdded} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── MobileTaskCard ───────────────────────────────────────────────────────────

function MobileTaskCard({ task, onClose, onCommentAdded, onNavigateCustomer }: TaskRowProps) {
  const [commentKey, setCommentKey] = useState(0);

  function handleCommentAdded() {
    setCommentKey((k) => k + 1);
    onCommentAdded();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{task.title}</p>
          <button
            onClick={onNavigateCustomer}
            className="mt-0.5 flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            {task.customer_name ?? task.customer_id} <ExternalLink size={10} />
          </button>
        </div>
        {priorityBadge(task.priority)}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {statusBadge(task.status)}
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          {categoryLabel(task.category)}
        </span>
      </div>
      <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
        <span>{task.assigned_agent_name ?? "Unassigned"}</span>
        <span>{formatDate(task.updated_at)}</span>
      </div>
      {task.transfer_reference && (
        <a
          href={task.transfer_id ? `/transfers/${task.transfer_id}` : `/transfers?search=${encodeURIComponent(task.transfer_reference ?? "")}`}
          className="mb-2 inline-flex items-center rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
        >
          Transfer: {task.transfer_reference}
          <ExternalLink size={10} className="ml-1" />
        </a>
      )}
      <CommentsList taskId={task.id} commentKey={commentKey} />
      <div className="flex items-center gap-3 border-t border-slate-100 pt-2.5">
        <AddCommentInline taskId={task.id} onAdded={handleCommentAdded} />
        {task.status !== "Closed" && (
          <button
            onClick={onClose}
            className="ml-auto rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
          >
            Close Task
          </button>
        )}
      </div>
    </div>
  );
}
