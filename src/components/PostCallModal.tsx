"use client";

import { useState } from "react";
import { Phone, X, Loader2 } from "lucide-react";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";
import { useDropdowns } from "@/src/context/DropdownsContext";
import { apiFetch } from "@/src/lib/apiFetch";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function PostCallModal() {
  const { lastEndedCall, clearLastEndedCall } = useTwilioVoice();
  const { callOutcomes } = useDropdowns();

  // Prepend placeholder; fall back to hardcoded list if DB hasn't loaded yet
  const OUTCOMES = [
    "Select outcome…",
    ...(callOutcomes.length > 0
      ? callOutcomes
      : ["Spoke with Customer","No Answer","Left Voicemail","Left SMS",
         "Promised to Upload ID","Guided Through App","Requested Call Back",
         "Not Interested","Wrong Number","Escalated to Compliance"]),
  ];

  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  if (!lastEndedCall) return null;

  async function handleSave() {
    if (!lastEndedCall || outcome === OUTCOMES[0]) return;
    if (!lastEndedCall.customerId) {
      setError("Cannot save log — customer context was lost. Use Skip.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        customerId: lastEndedCall.customerId,
        agentId: null,
        type: "Call",
        outcome,
        note: note.trim() || null,
        twilio_call_sid: lastEndedCall.callSid,
        call_duration_seconds: lastEndedCall.durationSeconds,
      };
      console.log("Sending interaction payload:", payload);
      const res = await apiFetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      setOutcome(OUTCOMES[0]);
      setNote("");
      clearLastEndedCall();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    setOutcome(OUTCOMES[0]);
    setNote("");
    setError(null);
    clearLastEndedCall();
  }

  return (
    /* Backdrop */
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
              <p className="text-xs text-white/70">
                {lastEndedCall.callerInfo}
                {lastEndedCall.durationSeconds > 0
                  ? ` · ${formatDuration(lastEndedCall.durationSeconds)}`
                  : ""}
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
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
              {error}
            </p>
          )}

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
            disabled={saving || outcome === OUTCOMES[0] || !lastEndedCall?.customerId}
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
