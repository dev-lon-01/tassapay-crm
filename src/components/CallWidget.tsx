"use client";

import { useState } from "react";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  Hash,
  X,
  AlertTriangle,
} from "lucide-react";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";

// ─── Duration formatter ───────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ─── DTMF Keypad ─────────────────────────────────────────────────────────────

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function DtmfKeypad({ onDigit, onClose }: { onDigit: (d: string) => void; onClose: () => void }) {
  return (
    <div className="absolute bottom-full mb-2 right-0 w-48 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">Keypad</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {DTMF_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => onDigit(k)}
            className="flex h-10 items-center justify-center rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-95"
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── CallWidget ──────────────────────────────────────────────────────────────

export function CallWidget() {
  const {
    callState,
    callerInfo,
    callDuration,
    isMuted,
    deviceError,
    deviceReady,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    sendDigits,
  } = useTwilioVoice();

  const [showKeypad, setShowKeypad] = useState(false);

  const hasMicError = deviceError === "MIC_BLOCKED";
  const visible = callState !== "idle" || hasMicError || (!hasMicError && !deviceReady === false);
  // Show the ready/starting pill whenever call is idle and no mic error
  const showReadyPill = callState === "idle" && !hasMicError;

  if (!visible && !showReadyPill) return null;

  return (
    // z-[70] clears mobile nav z-50
    <div className="fixed bottom-20 right-4 z-[70] w-72 md:bottom-6 md:right-6">

      {/* ── Device ready/starting indicator (idle state, no error) ───────── */}
      {showReadyPill && (
        <div
          className={`mb-2 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-md w-fit ml-auto ${
            deviceReady
              ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
              : "bg-amber-100 text-amber-700 border border-amber-200"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              deviceReady ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
            }`}
          />
          {deviceReady ? "Ready" : "Starting…"}
        </div>
      )}

      {/* ── Mic blocked banner ───────────────────────────────────────────── */}
      {hasMicError && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 shadow-md">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <span>
            <strong>Microphone blocked.</strong> To make calls, click the camera/lock icon in your browser address bar and allow microphone access, then refresh the page.
          </span>
        </div>
      )}

      {/* ── Call card ────────────────────────────────────────────────────── */}
      {callState !== "idle" && (
        <div className="relative rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div
            className={`flex items-center gap-3 rounded-t-2xl px-4 py-3 ${
              callState === "active"
                ? "bg-emerald-600"
                : callState === "incoming"
                  ? "bg-indigo-600"
                  : "bg-slate-700"
            }`}
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
              {callState === "incoming" ? (
                <PhoneIncoming size={16} className="text-white" />
              ) : (
                <Phone size={16} className="text-white" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {callerInfo ?? "Unknown"}
              </p>
              <p className="text-xs text-white/70">
                {callState === "connecting"
                  ? "Connecting…"
                  : callState === "incoming"
                    ? "Incoming call"
                    : formatDuration(callDuration)}
              </p>
            </div>
            {/* Connecting pulse ring */}
            {callState === "connecting" && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
              </span>
            )}
          </div>

          {/* Body — action buttons */}
          <div className="flex items-center justify-center gap-3 px-4 py-4">
            {callState === "incoming" && (
              <>
                <button
                  onClick={acceptCall}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm transition hover:bg-emerald-600 active:scale-95"
                  title="Accept"
                >
                  <Phone size={20} />
                </button>
                <button
                  onClick={rejectCall}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition hover:bg-red-600 active:scale-95"
                  title="Reject"
                >
                  <PhoneOff size={20} />
                </button>
              </>
            )}

            {callState === "connecting" && (
              <button
                onClick={hangUp}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition hover:bg-red-600 active:scale-95"
                title="Cancel"
              >
                <PhoneOff size={20} />
              </button>
            )}

            {callState === "active" && (
              <>
                {/* Mute */}
                <button
                  onClick={toggleMute}
                  title={isMuted ? "Unmute" : "Mute"}
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                    isMuted
                      ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                {/* DTMF keypad toggle */}
                <div className="relative">
                  <button
                    onClick={() => setShowKeypad((v) => !v)}
                    title="Keypad"
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                      showKeypad
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <Hash size={18} />
                  </button>
                  {showKeypad && (
                    <DtmfKeypad
                      onDigit={(d) => sendDigits(d)}
                      onClose={() => setShowKeypad(false)}
                    />
                  )}
                </div>

                {/* Hang up */}
                <button
                  onClick={hangUp}
                  title="Hang up"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition hover:bg-red-600 active:scale-95"
                >
                  <PhoneOff size={18} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
