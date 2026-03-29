"use client";

import { useState } from "react";
import { Loader2, Phone, PhoneCall, X } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

const CALL_OUTCOMES = [
  "Left voicemail",
  "Will transfer tomorrow",
  "Call back later",
  "Not interested",
  "Wrong number",
  "No answer",
  "Successful call",
];

function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface LogCallCustomer {
  customer_id: string;
  full_name: string | null;
}

export interface LogCallTwilioData {
  callSid: string | null;
  durationSeconds: number;
}

export function LogCallModal({
  customer,
  onClose,
  callSource = "offline",
  twilioData,
}: {
  customer: LogCallCustomer;
  onClose: () => void;
  callSource?: "twilio" | "offline";
  twilioData?: LogCallTwilioData | null;
}) {
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [note, setNote] = useState("");
  const [connected, setConnected] = useState<"" | "yes" | "no">("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [saving, setSaving] = useState(false);

  const isTwilio = callSource === "twilio" && twilioData;

  async function handleSubmit() {
    setSaving(true);
    try {
      let callDurationSeconds: number | null = null;
      let callStatus: string | null = null;

      if (isTwilio) {
        callDurationSeconds = twilioData.durationSeconds;
        callStatus = twilioData.durationSeconds > 0 ? "completed" : "no-answer";
      } else {
        if (connected === "yes") {
          const mins = parseFloat(durationMinutes) || 0;
          callDurationSeconds = Math.round(mins * 60);
          callStatus = "completed";
        } else {
          callDurationSeconds = 0;
          callStatus = "no-answer";
        }
      }

      const body: Record<string, unknown> = {
        customerId: customer.customer_id,
        type: "Call",
        outcome,
        note: note.trim() || null,
        call_duration_seconds: callDurationSeconds,
        call_status: callStatus,
      };

      if (isTwilio && twilioData.callSid) {
        body.twilio_call_sid = twilioData.callSid;
      }

      await apiFetch("/api/interactions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Log Call</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {customer.full_name ?? "Unknown"} <span className="font-mono text-xs text-slate-400">#{customer.customer_id}</span>
        </p>

        {isTwilio ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <PhoneCall className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-700">
              {formatCallDuration(twilioData.durationSeconds)}
            </span>
            <span className="text-xs text-indigo-500">via Twilio</span>
          </div>
        ) : (
          <>
            <label className="mb-1 block text-sm font-medium text-slate-700">Was the call connected?</label>
            <select
              value={connected}
              onChange={(e) => setConnected(e.target.value as "" | "yes" | "no")}
              className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="" disabled>Select...</option>
              <option value="yes">Yes - connected</option>
              <option value="no">No - not connected</option>
            </select>
            {connected === "yes" && (
              <>
                <label className="mb-1 block text-sm font-medium text-slate-700">Duration (minutes)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="e.g. 5"
                  className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </>
            )}
          </>
        )}

        <label className="mb-1 block text-sm font-medium text-slate-700">Outcome</label>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <label className="mb-1 block text-sm font-medium text-slate-700">Note <span className="text-slate-400">(optional)</span></label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Will transfer tomorrow, needs GBP->KES rate..."
          className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />
        <button
          onClick={handleSubmit}
          disabled={saving || (!isTwilio && !connected)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          {saving ? "Saving..." : "Save Call"}
        </button>
        {!isTwilio && !connected && (
          <p className="mt-2 text-center text-xs text-slate-400">Please select whether the call was connected</p>
        )}
      </div>
    </div>
  );
}
