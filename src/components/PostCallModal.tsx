"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, X, Loader2, Search, CheckCircle2, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";
import { useDropdowns } from "@/src/context/DropdownsContext";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/apiFetch";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface CustomerHit {
  customer_id: string;
  full_name: string;
  phone_number: string | null;
}

type LookupStatus = "loading" | "matched" | "unmatched";

export function PostCallModal() {
  const { lastEndedCall, clearLastEndedCall } = useTwilioVoice();
  const { callOutcomes } = useDropdowns();
  const { user } = useAuth();

  const OUTCOMES = [
    "Select outcome…",
    ...(callOutcomes.length > 0
      ? callOutcomes
      : ["Spoke with Customer", "No Answer", "Left Voicemail", "Left SMS",
         "Promised to Upload ID", "Guided Through App", "Requested Call Back",
         "Not Interested", "Wrong Number", "Escalated to Compliance"]),
  ];

  // ── Resolved customer state ──────────────────────────────────────────────
  const [lookupStatus, setLookupStatus]             = useState<LookupStatus>("loading");
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  const [resolvedName, setResolvedName]             = useState<string | null>(null);

  // ── Autocomplete search state ────────────────────────────────────────────
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState<CustomerHit[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [showDropdown, setShowDropdown]     = useState(false);
  const searchDebounce                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Form state ───────────────────────────────────────────────────────────
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── Auto-lookup on modal open ────────────────────────────────────────────
  useEffect(() => {
    if (!lastEndedCall) return;

    // Reset form on each new call
    setOutcome(OUTCOMES[0]);
    setNote("");
    setError(null);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);

    // If context already knows the customer (outbound from dialler), use it
    if (lastEndedCall.customerId) {
      setResolvedCustomerId(lastEndedCall.customerId);
      setResolvedName(lastEndedCall.callerInfo ?? null);
      setLookupStatus("matched");
      return;
    }

    // Otherwise try phone lookup
    if (lastEndedCall.phone) {
      setLookupStatus("loading");
      apiFetch(`/api/customers?phone=${encodeURIComponent(lastEndedCall.phone)}`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json() as CustomerHit;
            setResolvedCustomerId(data.customer_id);
            setResolvedName(data.full_name);
            setLookupStatus("matched");
          } else {
            setLookupStatus("unmatched");
          }
        })
        .catch(() => setLookupStatus("unmatched"));
    } else {
      setLookupStatus("unmatched");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEndedCall]);

  // ── Debounced autocomplete search ────────────────────────────────────────
  function handleSearchChange(q: string) {
    setSearchQuery(q);
    setResolvedCustomerId(null);
    setResolvedName(null);

    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!q.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await apiFetch(`/api/customers?search=${encodeURIComponent(q)}&limit=6`);
        if (res.ok) {
          const data = await res.json() as { data?: CustomerHit[] };
          setSearchResults(data.data ?? []);
          setShowDropdown(true);
        }
      } catch {
        // silently ignore
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }

  function selectSearchResult(hit: CustomerHit) {
    setResolvedCustomerId(hit.customer_id);
    setResolvedName(hit.full_name);
    setSearchQuery(hit.full_name);
    setShowDropdown(false);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!lastEndedCall || outcome === OUTCOMES[0]) return;
    if (!resolvedCustomerId) {
      setError("Please select a customer before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId:            resolvedCustomerId,
          agentId:               user?.id ?? null,
          type:                  "Call",
          outcome,
          note:                  note.trim() || null,
          twilio_call_sid:       lastEndedCall.callSid,
          call_duration_seconds: lastEndedCall.durationSeconds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      clearLastEndedCall();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    setError(null);
    clearLastEndedCall();
  }

  if (!lastEndedCall) return null;

  const directionLabel = lastEndedCall.direction === "outbound" ? "Outbound" : "Inbound";
  const DirectionIcon  = lastEndedCall.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl bg-indigo-600 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <Phone size={16} className="text-white" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">Log Call</p>
              <p className="text-xs text-white/70 flex items-center gap-1">
                <DirectionIcon size={11} />
                {directionLabel}
                {lastEndedCall.durationSeconds > 0
                  ? ` · ${formatDuration(lastEndedCall.durationSeconds)}`
                  : ""}
                {lastEndedCall.phone ? ` · ${lastEndedCall.phone}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/20 hover:text-white"
            title="Skip logging"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">

          {/* ── Customer identification area ── */}
          {lookupStatus === "loading" && (
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <Loader2 size={13} className="animate-spin" />
              Looking up caller…
            </div>
          )}

          {lookupStatus === "matched" && resolvedName && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5">
              <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-800">{resolvedName}</p>
                <p className="text-xs text-emerald-600">Auto-matched by phone number</p>
              </div>
            </div>
          )}

          {lookupStatus === "unmatched" && (
            <div className="space-y-2">
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                Unknown caller — search to link to a customer profile
              </div>
              {/* Autocomplete */}
              <div className="relative">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <Search size={13} className="text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    placeholder="Search name or customer ID…"
                    className="w-full text-sm text-slate-800 placeholder-slate-400 focus:outline-none bg-transparent"
                  />
                  {searchLoading && <Loader2 size={13} className="animate-spin text-slate-400 shrink-0" />}
                  {resolvedCustomerId && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
                </div>
                {showDropdown && searchResults.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                    {searchResults.map((hit) => (
                      <li key={hit.customer_id}>
                        <button
                          type="button"
                          onClick={() => selectSearchResult(hit)}
                          className="w-full px-3 py-2.5 text-left hover:bg-indigo-50 transition"
                        >
                          <p className="text-sm font-medium text-slate-800">{hit.full_name}</p>
                          <p className="text-xs text-slate-400">{hit.phone_number ?? hit.customer_id}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {showDropdown && !searchLoading && searchResults.length === 0 && searchQuery.trim() && (
                  <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500 shadow-lg">
                    No customers found
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
              {error}
            </p>
          )}

          {/* Outcome */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Call Outcome <span className="text-red-500">*</span>
            </label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o} disabled={o === OUTCOMES[0]}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Notes (optional)
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any additional context…"
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button
            onClick={handleSkip}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            Skip
          </button>
          <button
            onClick={handleSave}
            disabled={saving || outcome === OUTCOMES[0] || lookupStatus === "loading" || !resolvedCustomerId}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving…
              </>
            ) : (
              "Save Log"
            )}
          </button>
        </div>

      </div>
    </div>
  );
}

