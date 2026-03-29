"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Phone, Search, X, Loader2, Delete, Grid3x3 } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";
import { normalizePhone } from "@/src/lib/phoneUtils";

// ─── Numpad ───────────────────────────────────────────────────────────────────

const NUMPAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
] as const;

interface NumpadProps {
  onKey:       (char: string) => void;
  onBackspace: () => void;
}

function Numpad({ onKey, onBackspace }: NumpadProps) {
  return (
    <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50 p-2">
      <div className="grid grid-cols-3 gap-1.5">
        {NUMPAD_KEYS.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onKey(key)}
            className="flex h-10 items-center justify-center rounded-lg bg-white text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
          >
            {key}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onBackspace}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-xs font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-600 active:scale-95"
      >
        <Delete size={14} />
        Backspace
      </button>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerSuggestion {
  customer_id: string;
  full_name:   string | null;
  phone_number: string | null;
  country:     string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * IndependentDialer
 *
 * A standalone dialer that:
 *  1. Lets the agent search for a customer by name (autocomplete)
 *  2. OR type a raw phone number manually
 *  3. Calls makeCall(phone, customerName, customerId) so PostCallModal gets FK context
 */
export function IndependentDialer() {
  const { makeCall, callState } = useTwilioVoice();

  const [query, setQuery]               = useState("");
  const [manualPhone, setManualPhone]   = useState("");
  const [mode, setMode]                 = useState<"search" | "manual">("search");

  const [suggestions, setSuggestions]   = useState<CustomerSuggestion[]>([]);
  const [sugLoading, setSugLoading]     = useState(false);
  const [selected, setSelected]         = useState<CustomerSuggestion | null>(null);

  const [open, setOpen]           = useState(false);
  const [showNumpad, setShowNumpad] = useState(false);
  const containerRef   = useRef<HTMLDivElement>(null);
  const phoneInputRef  = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  // ── Autocomplete search ──────────────────────────────────────────────────
  const search = useCallback((q: string) => {
    if (!q.trim() || q.length < 2) {
      setSuggestions([]);
      return;
    }
    setSugLoading(true);
    apiFetch(`/api/customers?search=${encodeURIComponent(q)}&limit=10`)
      .then((r) => r.json())
      .then((data: unknown) => {
        const items = Array.isArray(data)
          ? data
          : Array.isArray((data as { data?: unknown[] }).data)
            ? (data as { data: CustomerSuggestion[] }).data
            : [];
        setSuggestions(items as CustomerSuggestion[]);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setSugLoading(false));
  }, []);

  useEffect(() => {
    if (mode === "search") search(debouncedQuery);
  }, [debouncedQuery, mode, search]);

  // ── Numpad handlers ──────────────────────────────────────────────────────
  function handleNumpadKey(char: string) {
    setManualPhone((prev) => prev + char);
    phoneInputRef.current?.focus();
  }

  function handleNumpadBackspace() {
    setManualPhone((prev) => prev.slice(0, -1));
    phoneInputRef.current?.focus();
  }

  // ── Close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isCallBusy = callState !== "idle";

  function getCallTarget(): { phone: string; name: string | undefined; id: string | null } | null {
    if (mode === "search") {
      if (!selected) return null;
      const phone = selected.phone_number
        ? normalizePhone(selected.phone_number, selected.country ?? undefined)
        : null;
      if (!phone) return null;
      return { phone, name: selected.full_name ?? undefined, id: selected.customer_id };
    }
    // manual mode
    const trimmed = manualPhone.trim();
    if (!trimmed) return null;
    return { phone: trimmed, name: undefined, id: null };
  }

  function handleCall() {
    const target = getCallTarget();
    if (!target || isCallBusy) return;
    makeCall(target.phone, target.name, target.id);
    // Reset
    setQuery("");
    setManualPhone("");
    setSelected(null);
    setSuggestions([]);
    setShowNumpad(false);
    setOpen(false);
  }

  const target = getCallTarget();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.98]"
      >
        <Phone size={15} />
        Dial
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200/80 bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-700">Make a Call</p>
        <button
          onClick={() => { setOpen(false); setShowNumpad(false); }}
          className="text-slate-400 hover:text-slate-600"
        >
          <X size={15} />
        </button>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-1 p-3 border-b border-slate-100">
        <button
          onClick={() => { setMode("search"); setManualPhone(""); }}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
            mode === "search"
              ? "bg-indigo-600 text-white"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          Search Customer
        </button>
        <button
          onClick={() => { setMode("manual"); setQuery(""); setSelected(null); setSuggestions([]); setShowNumpad(false); }}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
            mode === "manual"
              ? "bg-indigo-600 text-white"
              : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          Manual Number
        </button>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3">
        {mode === "search" ? (
          <div className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search size={14} className="shrink-0 text-slate-400" />
              <input
                autoFocus
                placeholder="Search by name or phone..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
                className="flex-1 bg-transparent text-sm outline-none placeholder-slate-400"
              />
              {sugLoading && <Loader2 size={13} className="animate-spin text-slate-400" />}
              {query && (
                <button onClick={() => { setQuery(""); setSuggestions([]); setSelected(null); }}>
                  <X size={13} className="text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>

            {/* Suggestions dropdown */}
            {suggestions.length > 0 && !selected && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {suggestions.map((s) => (
                  <li key={s.customer_id}>
                    <button
                      onClick={() => {
                        setSelected(s);
                        setQuery(s.full_name ?? s.phone_number ?? "");
                        setSuggestions([]);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-800">{s.full_name ?? "-"}</span>
                      <span className="text-xs text-slate-400">{s.phone_number}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-indigo-700">{selected.full_name}</span>
                <span className="text-xs text-indigo-500">{selected.phone_number}</span>
                <button onClick={() => { setSelected(null); setQuery(""); }}>
                  <X size={13} className="text-indigo-400 hover:text-indigo-600" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Phone size={14} className="shrink-0 text-slate-400" />
              <input
                ref={phoneInputRef}
                autoFocus
                type="tel"
                placeholder="+447xxxxxxxxx"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCall(); }}
                className="flex-1 bg-transparent text-sm outline-none placeholder-slate-400"
              />
              {manualPhone && (
                <button type="button" onClick={() => setManualPhone("")} className="text-slate-300 hover:text-slate-500">
                  <X size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowNumpad((v) => !v)}
                title={showNumpad ? "Hide keypad" : "Show keypad"}
                className={`ml-1 rounded-lg p-1 transition ${
                  showNumpad
                    ? "bg-indigo-100 text-indigo-600"
                    : "text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                }`}
              >
                <Grid3x3 size={15} />
              </button>
            </div>
            {showNumpad && (
              <Numpad onKey={handleNumpadKey} onBackspace={handleNumpadBackspace} />
            )}
          </div>
        )}

        <button
          onClick={handleCall}
          disabled={!target || isCallBusy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Phone size={14} />
          {isCallBusy ? "Call in progress..." : "Call"}
        </button>
      </div>
    </div>
  );
}
