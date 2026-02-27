"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { apiFetch } from "@/src/lib/apiFetch";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallState = "idle" | "connecting" | "active" | "incoming";

interface TwilioVoiceContextValue {
  callState: CallState;
  callerInfo: string | null;
  callDuration: number;
  isMuted: boolean;
  deviceError: string | null;
  deviceReady: boolean;
  makeCall: (phoneNumber: string, displayName?: string) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const TwilioVoiceContext = createContext<TwilioVoiceContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TwilioVoiceProvider({ children }: { children: React.ReactNode }) {
  const deviceRef   = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const [callState, setCallState]     = useState<CallState>("idle");
  const [callerInfo, setCallerInfo]   = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted]         = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);

  // ─── Timer helpers ──────────────────────────────────────────────────────────
  function startTimer() {
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration((s) => s + 1), 1000);
  }
  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCallDuration(0);
  }

  // ─── Attach listeners to a Call object ─────────────────────────────────────
  function attachCallListeners(call: Call) {
    activeCallRef.current = call;

    call.on("accept", () => {
      setCallState("active");
      setIsMuted(false);
      startTimer();
    });
    call.on("disconnect", () => {
      setCallState("idle");
      setCallerInfo(null);
      setIsMuted(false);
      activeCallRef.current = null;
      stopTimer();
      // Mark agent available again
      apiFetch("/api/voice/available", {
        method: "PATCH",
        body: JSON.stringify({ available: true }),
      }).catch(() => {});
    });
    call.on("cancel", () => {
      setCallState("idle");
      setCallerInfo(null);
      activeCallRef.current = null;
      stopTimer();
    });
    call.on("error", (err: Error) => {
      setDeviceError(err.message);
    });
  }

  // ─── Token fetch helper ─────────────────────────────────────────────────────
  async function fetchToken(): Promise<string | null> {
    try {
      const res = await apiFetch("/api/voice/token");
      if (!res.ok) return null;
      const data = await res.json() as { token: string };
      return data.token;
    } catch {
      return null;
    }
  }

  // ─── Device init ───────────────────────────────────────────────────────────
  useEffect(() => {
    let destroyed = false;

    async function init() {
      const token = await fetchToken();
      if (!token || destroyed) return;

      // Lazy-import the SDK (browser-only)
      const { Device: TwilioDevice } = await import("@twilio/voice-sdk");

      const device = new TwilioDevice(token, {
        codecPreferences: ["opus", "pcmu"] as any,
      } as any);

      deviceRef.current = device;

      device.on("registered", () => {
        setDeviceReady(true);
        setDeviceError(null);
        apiFetch("/api/voice/available", {
          method: "PATCH",
          body: JSON.stringify({ available: true }),
        }).catch(() => {});
      });

      device.on("unregistered", () => {
        setDeviceReady(false);
      });

      device.on("error", (err: Error) => {
        const msg = err.message ?? String(err);
        if (msg.includes("NotAllowedError") || msg.includes("Permission denied") || msg.includes("PermissionDeniedError")) {
          setDeviceError("MIC_BLOCKED");
        } else {
          setDeviceError(msg);
        }
      });

      device.on("incoming", (call: Call) => {
        setCallState("incoming");
        setCallerInfo(call.parameters?.From ?? "Unknown");
        attachCallListeners(call);
      });

      device.on("tokenWillExpire", async () => {
        const newToken = await fetchToken();
        if (newToken) device.updateToken(newToken);
      });

      device.register();
    }

    init().catch(() => {});

    return () => {
      destroyed = true;
      stopTimer();
      if (deviceRef.current) {
        // Mark unavailable before destroying
        apiFetch("/api/voice/available", {
          method: "PATCH",
          body: JSON.stringify({ available: false }),
        }).catch(() => {});
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const makeCall = useCallback((phoneNumber: string, displayName?: string) => {
    if (!deviceRef.current || callState !== "idle") return;
    setCallState("connecting");
    setCallerInfo(displayName ?? phoneNumber);

    deviceRef.current
      .connect({ params: { To: phoneNumber } })
      .then((call: Call) => {
        attachCallListeners(call);
      })
      .catch((err: Error) => {
        setCallState("idle");
        setCallerInfo(null);
        setDeviceError(err.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState]);

  const acceptCall = useCallback(() => {
    if (activeCallRef.current && callState === "incoming") {
      activeCallRef.current.accept();
    }
  }, [callState]);

  const rejectCall = useCallback(() => {
    if (activeCallRef.current && callState === "incoming") {
      activeCallRef.current.reject();
      setCallState("idle");
      setCallerInfo(null);
      activeCallRef.current = null;
    }
  }, [callState]);

  const hangUp = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect();
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!activeCallRef.current) return;
    const next = !isMuted;
    activeCallRef.current.mute(next);
    setIsMuted(next);
  }, [isMuted]);

  const sendDigits = useCallback((digits: string) => {
    if (activeCallRef.current && callState === "active") {
      activeCallRef.current.sendDigits(digits);
    }
  }, [callState]);

  return (
    <TwilioVoiceContext.Provider
      value={{
        callState,
        callerInfo,
        callDuration,
        isMuted,
        deviceError,
        deviceReady,
        makeCall,
        acceptCall,
        rejectCall,
        hangUp,
        toggleMute,
        sendDigits,
      }}
    >
      {children}
    </TwilioVoiceContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTwilioVoice(): TwilioVoiceContextValue {
  const ctx = useContext(TwilioVoiceContext);
  if (!ctx) throw new Error("useTwilioVoice must be used inside <TwilioVoiceProvider>");
  return ctx;
}
