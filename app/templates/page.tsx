"use client";

import { useState, useEffect } from "react";
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  MessageSquare,
  AtSign,
  Loader2,
  Save,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { Modal } from "@/src/components/Modal";

// ─── types ────────────────────────────────────────────────────────────────────

interface Template {
  id: number;
  name: string;
  channel: "SMS" | "Email";
  subject: string | null;
  body: string;
  created_at: string;
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: (t: Template) => void;
}) {
  const isEditing = !!template;
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState<"SMS" | "Email">(template?.channel ?? "SMS");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;

    setSaving(true);
    setError("");

    try {
      const url = isEditing ? `/api/templates/${template!.id}` : "/api/templates";
      const method = isEditing ? "PUT" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          channel,
          subject: channel === "Email" ? subject.trim() || null : null,
          body: body.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save template");
      }

      const saved: Template = await res.json();
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEditing ? "Edit Template" : "New Template"}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="template-modal-form"
            disabled={saving || !name.trim() || !body.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? "Saving..." : "Save Template"}
          </button>
        </div>
      }
    >
      <form id="template-modal-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Template Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "KYC Reminder 1"'
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        {/* Channel */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Channel
          </label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as "SMS" | "Email")}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="SMS">SMS</option>
            <option value="Email">Email</option>
          </select>
        </div>

        {/* Subject (email only) */}
        {channel === "Email" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject line..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        )}

        {/* Body */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Body
          </label>
          <textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            placeholder="Message body..."
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            Available variables:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-600">
              {"{{fullName}}"}
            </code>
            ,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-600">
              {"{{country}}"}
            </code>
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"All" | "SMS" | "Email">("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    apiFetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  function handleSaved(saved: Template) {
    setTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    closeModal();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await apiFetch(`/api/templates/${id}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  const smsCount = templates.filter((t) => t.channel === "SMS").length;
  const emailCount = templates.filter((t) => t.channel === "Email").length;
  const filtered =
    filter === "All" ? templates : templates.filter((t) => t.channel === filter);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Message Templates</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Pre-written SMS and Email messages with dynamic variables
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-[0.98]"
        >
          <Plus size={15} />
          New Template
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(
          [
            { key: "All", count: templates.length },
            { key: "SMS", count: smsCount },
            { key: "Email", count: emailCount },
          ] as const
        ).map(({ key, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              filter === key
                ? "bg-indigo-600 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {key}
            <span
              className={`ml-1.5 text-xs ${filter === key ? "opacity-80" : "opacity-60"}`}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
          <span className="text-sm">Loading templates...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-slate-200 py-20">
          <FileText size={44} className="text-slate-200" />
          <div className="text-center">
            <p className="font-medium text-slate-500">No templates yet</p>
            <p className="mt-0.5 text-sm text-slate-400">
              {filter !== "All"
                ? `No ${filter} templates. Switch filter or create one.`
                : "Create your first template to get started."}
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <Plus size={14} />
            Create template
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="group relative flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              {/* Card header */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.channel === "SMS"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-purple-50 text-purple-700"
                    }`}
                  >
                    {t.channel === "SMS" ? (
                      <MessageSquare size={10} />
                    ) : (
                      <AtSign size={10} />
                    )}
                    {t.channel}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {t.name}
                  </span>
                </div>
                {/* Actions */}
                <div className="flex flex-shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => openEdit(t)}
                    title="Edit"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    disabled={deleting === t.id}
                    title="Delete"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    {deleting === t.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              </div>

              {/* Subject (email) */}
              {t.subject && (
                <p className="mb-1.5 text-xs font-medium text-slate-500">
                  Subject:{" "}
                  <span className="font-normal italic text-slate-600">
                    {t.subject}
                  </span>
                </p>
              )}

              {/* Body preview */}
              <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">
                {t.body}
              </p>

              {/* Footer */}
              <p className="mt-3 text-xs text-slate-400">
                {new Date(t.created_at).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <TemplateModal
          template={editing}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
