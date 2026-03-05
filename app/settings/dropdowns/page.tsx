"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, ToggleLeft, ToggleRight, Loader2, ListFilter } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { useDropdowns } from "@/src/context/DropdownsContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DropdownItem {
  id:         number;
  category:   string;
  label:      string;
  sort_order: number;
  is_active:  number;
}

type Category = "call_outcome" | "focus_outcome" | "note_outcome";

const CATEGORY_LABELS: Record<Category, string> = {
  call_outcome:  "Call Outcomes",
  focus_outcome: "Focus Outcomes",
  note_outcome:  "Note Outcomes",
};

const CATEGORIES: Category[] = ["call_outcome", "focus_outcome", "note_outcome"];

// ─── Inline edit row ──────────────────────────────────────────────────────────

function EditableRow({
  item,
  onSaved,
}: {
  item: DropdownItem;
  onSaved: () => void;
}) {
  const [label, setLabel]       = useState(item.label);
  const [order, setOrder]       = useState(String(item.sort_order));
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch(`/api/settings/dropdowns/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), sort_order: Number(order) }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      setError(d.error ?? "Failed");
    } else {
      setEditing(false);
      onSaved();
    }
    setSaving(false);
  }

  async function toggleActive() {
    setSaving(true);
    const res = await apiFetch(`/api/settings/dropdowns/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: item.is_active ? 0 : 1 }),
    });
    if (res.ok) onSaved();
    setSaving(false);
  }

  return (
    <li className={`flex items-center gap-3 px-4 py-3 transition ${item.is_active ? "" : "opacity-50"}`}>
      {editing ? (
        <>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <input
            type="number"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm text-center focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <button
            onClick={save}
            disabled={saving || !label.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setLabel(item.label); setOrder(String(item.sort_order)); }}
            className="text-xs text-slate-400 underline"
          >
            Cancel
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-slate-800">{item.label}</span>
          <span className="w-10 text-center text-xs text-slate-400">{item.sort_order}</span>
          <button
            onClick={() => setEditing(true)}
            className="text-slate-400 transition hover:text-indigo-600"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={toggleActive}
            disabled={saving}
            className="text-slate-400 transition hover:text-indigo-600"
            title={item.is_active ? "Deactivate" : "Activate"}
          >
            {item.is_active
              ? <ToggleRight size={18} className="text-emerald-500" />
              : <ToggleLeft size={18} />}
          </button>
        </>
      )}
    </li>
  );
}

// ─── Add-item form ────────────────────────────────────────────────────────────

function AddItemForm({
  category,
  onAdded,
}: {
  category: Category;
  onAdded: () => void;
}) {
  const [label, setLabel]     = useState("");
  const [order, setOrder]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [open, setOpen]       = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await apiFetch("/api/settings/dropdowns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        label: label.trim(),
        sort_order: order ? Number(order) : 0,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      setError(d.error ?? "Failed");
    } else {
      setLabel("");
      setOrder("");
      setOpen(false);
      onAdded();
    }
    setSaving(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
      >
        <Plus size={14} /> Add item
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-t border-slate-100">
      <input
        autoFocus
        placeholder="New label…"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
      />
      <input
        type="number"
        placeholder="Order"
        value={order}
        onChange={(e) => setOrder(e.target.value)}
        className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm text-center focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
      />
      <button
        type="submit"
        disabled={saving || !label.trim()}
        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : "Add"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 underline">
        Cancel
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DropdownsPage() {
  const { user }     = useAuth();
  const { reload }   = useDropdowns();

  const [tab, setTab]       = useState<Category>("call_outcome");
  const [items, setItems]   = useState<DropdownItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const fetchItems = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch("/api/settings/dropdowns?includeInactive=1")
      .then((r) => r.json())
      .then((data: unknown) => {
        // API returns only active by default; fetch all for admin management
        // We fetch without is_active filter and show toggle
        if (Array.isArray(data)) setItems(data as DropdownItem[]);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);


  const tabItems = items
    .filter((i) => i.category === tab)
    .sort((a, b) => a.sort_order - b.sort_order);

  function handleSaved() {
    fetchItems();
    reload(); // refresh the global dropdown cache
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <ListFilter className="h-6 w-6 text-indigo-500" />
          Dropdown Options
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage the options available in calls, focus sessions, and notes.
          Toggle the switch to hide an option without deleting it.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm w-fit">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setTab(cat)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === cat
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span>Label</span>
          <span className="w-10 text-center">Order</span>
          <span>Edit</span>
          <span>Active</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-500">{error}</p>
        ) : tabItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No items yet</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tabItems.map((item) => (
              <EditableRow key={item.id} item={item} onSaved={handleSaved} />
            ))}
          </ul>
        )}

        <AddItemForm category={tab} onAdded={handleSaved} />
      </div>
    </div>
  );
}
