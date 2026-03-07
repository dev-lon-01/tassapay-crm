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
  Settings,
} from "lucide-react";
import { useTwilioVoice } from "@/src/context/TwilioVoiceContext";
import { useAudioDevices, type AudioDevice } from "@/src/hooks/useAudioDevices";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function DtmfKeypad({ onDigit, onClose }: { onDigit: (digit: string) => void; onClose: () => void }) {
  return (
    <div className="absolute bottom-full right-0 mb-2 w-48 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">Keypad</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {DTMF_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => onDigit(key)}
            className="flex h-10 items-center justify-center rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-95"
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

interface CallSettingsPopoverProps {
  audioOutputs: AudioDevice[];
  audioInputs: AudioDevice[];
  selectedOutput: string;
  selectedInput: string;
  onOutputChange: (id: string) => void;
  onInputChange: (id: string) => void;
  onClose: () => void;
}

function CallSettingsPopover({
  audioOutputs,
  audioInputs,
  selectedOutput,
  selectedInput,
  onOutputChange,
  onInputChange,
  onClose,
}: CallSettingsPopoverProps) {
  return (
    <div className="w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Call Settings</span>
        <button onClick={onClose} className="text-slate-400 transition hover:text-slate-700">
          <X size={14} />
        </button>
      </div>

      {audioOutputs.length > 0 && (
        <div className="mb-3">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            Audio Output (Speaker / Headset)
          </label>
          <select
            value={selectedOutput}
            onChange={(e) => onOutputChange(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">System Default</option>
            {audioOutputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-500">Microphone</label>
        <select
          value={selectedInput}
          onChange={(e) => onInputChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">System Default</option>
          {audioInputs.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
          ))}
        </select>
      </div>

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
        Safari does not support routing audio to specific devices. Use Chrome or Edge for the best experience.
      </p>
    </div>
  );
}

export function CallWidget() {
  const {
    callState,
    connectionState,
    connectionMessage,
    callerInfo,
    callDuration,
    isMuted,
    deviceError,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    sendDigits,
    setOutputDevice,
    setInputDevice,
  } = useTwilioVoice();

  const { audioOutputs, audioInputs, refresh } = useAudioDevices();

  const [showKeypad, setShowKeypad] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem("tp_crm_output_device") ?? "" : "")
  );
  const [selectedInput, setSelectedInput] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem("tp_crm_input_device") ?? "" : "")
  );

  function toggleSettings() {
    refresh();
    setShowSettings((value) => !value);
  }

  function handleOutputChange(deviceId: string) {
    setSelectedOutput(deviceId);
    localStorage.setItem("tp_crm_output_device", deviceId);
    if (deviceId) setOutputDevice(deviceId);
  }

  function handleInputChange(deviceId: string) {
    setSelectedInput(deviceId);
    localStorage.setItem("tp_crm_input_device", deviceId);
    if (deviceId) setInputDevice(deviceId);
  }

  const hasMicError = connectionState === "mic-blocked" || deviceError === "MIC_BLOCKED";
  const hasConnectionError = connectionState === "lost" && !hasMicError;
  const showStatusPill = callState === "idle" && !hasMicError;
  const showReadyPill = showStatusPill && connectionState === "ready";
  const showStartingPill = showStatusPill && connectionState === "starting";
  const visible = callState !== "idle" || hasMicError || hasConnectionError || showStatusPill;

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[70] w-72 md:bottom-6 md:right-6">
      {showStatusPill && (
        <div className="relative mb-2 flex items-center justify-end gap-2">
          <button
            onClick={toggleSettings}
            title="Call Settings"
            className={`flex h-7 w-7 items-center justify-center rounded-full shadow-md transition ${
              showSettings ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"
            }`}
          >
            <Settings size={14} />
          </button>
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md ${
              showReadyPill
                ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                : "border-amber-200 bg-amber-100 text-amber-700"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                showReadyPill ? "bg-emerald-500" : "animate-pulse bg-amber-400"
              }`}
            />
            {showReadyPill ? "Ready" : connectionMessage ?? "Starting..."}
          </div>
        </div>
      )}

      {hasMicError && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 shadow-md">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <span>
            <strong>Microphone blocked.</strong> Allow microphone access in the browser and refresh the page.
          </span>
        </div>
      )}

      {hasConnectionError && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-700 shadow-md">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
          <span>
            <strong>Connection Lost.</strong> {connectionMessage ?? "Voice calling is currently offline."}
          </span>
        </div>
      )}

      {callState !== "idle" && (
        <div className="relative rounded-2xl border border-slate-200 bg-white shadow-xl">
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
              <p className="truncate text-sm font-semibold text-white">{callerInfo ?? "Unknown"}</p>
              <p className="text-xs text-white/70">
                {callState === "connecting"
                  ? "Connecting..."
                  : callState === "incoming"
                    ? "Incoming call"
                    : formatDuration(callDuration)}
              </p>
            </div>
            {callState === "connecting" && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
              </span>
            )}
            <button
              onClick={toggleSettings}
              title="Call Settings"
              className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                showSettings ? "bg-white/30 text-white" : "bg-white/20 text-white hover:bg-white/30"
              }`}
            >
              <Settings size={13} />
            </button>
          </div>

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

                <div className="relative">
                  <button
                    onClick={() => setShowKeypad((value) => !value)}
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
                    <DtmfKeypad onDigit={(digit) => sendDigits(digit)} onClose={() => setShowKeypad(false)} />
                  )}
                </div>

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

      {showSettings && (
        <div className="absolute bottom-full right-0 mb-2">
          <CallSettingsPopover
            audioOutputs={audioOutputs}
            audioInputs={audioInputs}
            selectedOutput={selectedOutput}
            selectedInput={selectedInput}
            onOutputChange={handleOutputChange}
            onInputChange={handleInputChange}
            onClose={() => setShowSettings(false)}
          />
        </div>
      )}
    </div>
  );
}


