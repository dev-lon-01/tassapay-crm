"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import {
  Loader2,
  MessageCircle,
  Paperclip,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface InboxRow {
  id: number;
  wamid: string;
  from_phone: string;
  message_type: string;
  body: string | null;
  media_url: string | null;
  attached_task_id: number | null;
  attached_at: string | null;
  received_at: string;
}

interface CustomerHit {
  customer_id: string;
  full_name: string;
  phone_number: string | null;
}

export default function WhatsAppInboxPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch("/api/whatsapp/inbox")
      .then((r) => r.json())
      .then((d: InboxRow[] | { error?: string }) => {
        if (!Array.isArray(d)) {
          throw new Error((d as { error?: string }).error ?? "Failed to load");
        }
        setRows(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Subscribe to SSE for live updates
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    apiFetch("/api/realtime/token", { method: "POST" })
      .then((r) => r.json())
      .then((d: { token?: string; error?: string }) => {
        if (cancelled || !d.token) return;
        es = new EventSource(
          `/api/realtime/stream?token=${encodeURIComponent(d.token)}`
        );
        const onChange = () => load();
        es.addEventListener("whatsapp.unlinked", onChange);
        es.addEventListener("whatsapp.message", onChange);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (es) es.close();
    };
  }, [load]);

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          WhatsApp Inbox
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Inbound messages from numbers we couldn&apos;t auto-match. Attach to a
          customer to file the message and any future ones.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading inbox...</span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white py-16 text-center text-sm text-slate-400">
          No unlinked messages.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <InboxItem key={row.id} row={row} onAttached={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxItem({
  row,
  onAttached,
}: {
  row: InboxRow;
  onAttached: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerHit[]>([]);
  const [resolved, setResolved] = useState<CustomerHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (resolved) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      apiFetch(
        `/api/customers?search=${encodeURIComponent(searchQuery)}&limit=6`
      )
        .then((r) => r.json())
        .then((d: { data?: CustomerHit[] }) => {
          setSearchResults(d.data ?? []);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, resolved]);

  function attach() {
    if (!resolved) return;
    setSubmitting(true);
    setAttachError(null);
    apiFetch(`/api/whatsapp/inbox/${row.id}/attach`, {
      method: "POST",
      body: JSON.stringify({ customer_id: resolved.customer_id }),
    })
      .then(async (r) => {
        const d = (await r.json()) as { ok?: boolean; taskId?: number; error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? "Failed to attach");
        return d;
      })
      .then(() => {
        onAttached();
      })
      .catch((e: Error) => setAttachError(e.message))
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <MessageCircle size={12} className="text-emerald-500" />
            <span className="font-mono font-semibold text-slate-700">
              +{row.from_phone}
            </span>
            <span>·</span>
            <span>{new Date(row.received_at).toLocaleString()}</span>
            <span>·</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 uppercase tracking-wide text-[10px] font-semibold text-slate-600">
              {row.message_type}
            </span>
          </div>
          {row.body && (
            <p className="whitespace-pre-wrap text-sm text-slate-800">
              {row.body}
            </p>
          )}
          {row.media_url && (
            <Link
              href={row.media_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              <Paperclip size={12} />
              View attachment
            </Link>
          )}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          {open ? "Cancel" : "Attach to customer"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="relative flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Search size={13} className="shrink-0 text-slate-400" />
            <input
              type="text"
              value={resolved ? resolved.full_name : searchQuery}
              onChange={(e) => {
                setResolved(null);
                setSearchQuery(e.target.value);
              }}
              placeholder="Search customer name or ID..."
              className="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
            />
            {searching && (
              <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" />
            )}
            {resolved && (
              <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />
            )}
          </div>

          {!resolved && searchResults.length > 0 && (
            <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {searchResults.map((hit) => (
                <li key={hit.customer_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setResolved(hit);
                      setSearchResults([]);
                    }}
                    className="block w-full px-3 py-2 text-left transition hover:bg-slate-50"
                  >
                    <div className="text-sm font-medium text-slate-800">
                      {hit.full_name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {hit.customer_id} · {hit.phone_number ?? "—"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={attach}
              disabled={!resolved || submitting}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? "Attaching..." : "Attach"}
            </button>
            {attachError && (
              <span className="text-xs font-medium text-rose-600">
                {attachError}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
