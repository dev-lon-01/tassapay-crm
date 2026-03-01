"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Call, Device } from "@twilio/voice-sdk";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallState = "idle" | "connecting" | "active" | "incoming";

export interface EndedCall {
  callSid: string | null;
  durationSeconds: number;
  callerInfo: string;
  customerId: string | null;
}

interface TwilioVoiceContextValue {
  callState: CallState;
  callerInfo: string | null;
  callDuration: number;
  isMuted: boolean;
  deviceError: string | null;
  deviceReady: boolean;
  lastEndedCall: EndedCall | null;
  makeCall: (phoneNumber: string, displayName?: string, customerId?: string | null) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
  clearLastEndedCall: () => void;
  setOutputDevice: (deviceId: string) => void;
  setInputDevice:  (deviceId: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const TwilioVoiceContext = createContext<TwilioVoiceContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TwilioVoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token: authToken } = useAuth();

  const deviceRef             = useRef<Device | null>(null);
  const activeCallRef         = useRef<Call | null>(null);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);
  const callDurationRef          = useRef(0);   // parallel ref to avoid stale closures
  const callSidRef               = useRef<string | null>(null);
  const callerInfoRef            = useRef<string | null>(null);
  const activeCallCustomerIdRef  = useRef<string | null>(null);
  const ringAudioRef             = useRef<HTMLAudioElement | null>(null);

  const [callState, setCallState]         = useState<CallState>("idle");
  const [callerInfo, setCallerInfo]       = useState<string | null>(null);
  const [callDuration, setCallDuration]   = useState(0);
  const [isMuted, setIsMuted]             = useState(false);
  const [deviceError, setDeviceError]     = useState<string | null>(null);
  const [deviceReady, setDeviceReady]     = useState(false);
  const [lastEndedCall, setLastEndedCall] = useState<EndedCall | null>(null);

  // ─── Helper: keep callerInfo in sync between ref and state ─────────────────
  function updateCallerInfo(info: string | null) {
    callerInfoRef.current = info;
    setCallerInfo(info);
  }

  // ─── Ring audio helpers ─────────────────────────────────────────────────────
  function startRing() {
    if (typeof window === "undefined") return;
    if (!ringAudioRef.current) {
      ringAudioRef.current = new Audio("/ring.mp3");
      ringAudioRef.current.loop = true;
    }
    ringAudioRef.current.currentTime = 0;
    ringAudioRef.current.play().catch(() => {});
  }
  function stopRing() {
    if (ringAudioRef.current) {
      ringAudioRef.current.pause();
      ringAudioRef.current.currentTime = 0;
    }
  }

  // ─── Timer helpers ──────────────────────────────────────────────────────────
  function startTimer() {
    callDurationRef.current = 0;
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      callDurationRef.current += 1;
      setCallDuration((s) => s + 1);
    }, 1000);
  }
  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // ─── Screen pop: look up customer by phone number ──────────────────────────
  async function screenPop(fromNumber: string): Promise<string | null> {
    try {
      const encoded = encodeURIComponent(fromNumber);
      const res = await apiFetch(`/api/customers?phone=${encoded}`);
      if (!res.ok) return null;
      const data = await res.json() as { customer_id?: string };
      return data.customer_id ?? null;
    } catch {
      return null;
    }
  }

  // ─── Attach listeners to a Call object ─────────────────────────────────────
  function attachCallListeners(call: Call) {
    activeCallRef.current = call;

    call.on("accept", (acceptedCall: Call) => {
      stopRing();
      // Capture CallSid from the accepted call parameters
      const sid =
        (acceptedCall as unknown as { parameters?: Record<string, string> })
          .parameters?.CallSid ?? null;
      callSidRef.current = sid;
      setCallState("active");
      setIsMuted(false);
      startTimer();
    });

    call.on("disconnect", () => {
      stopRing();
      // Snapshot before zeroing — callDurationRef stays accurate in the closure
      const durationSnap = callDurationRef.current;
      const callerSnap   = callerInfoRef.current ?? "Unknown";
      const sidSnap      = callSidRef.current;
      const cidSnap      = activeCallCustomerIdRef.current;

      stopTimer();
      callDurationRef.current = 0;
      callSidRef.current = null;
      activeCallCustomerIdRef.current = null;
      activeCallRef.current = null;

      setCallState("idle");
      updateCallerInfo(null);
      setIsMuted(false);
      setCallDuration(0);

      // Surface the ended call so PostCallModal can log it
      setLastEndedCall({
        callSid: sidSnap,
        durationSeconds: durationSnap,
        callerInfo: callerSnap,
        customerId: cidSnap,
      });

      // Mark agent available again
      apiFetch("/api/voice/available", {
        method: "PATCH",
        body: JSON.stringify({ available: true }),
      }).catch(() => {});
    });

    call.on("cancel", () => {
      stopRing();
      stopTimer();
      callDurationRef.current = 0;
      callSidRef.current = null;
      activeCallCustomerIdRef.current = null;
      activeCallRef.current = null;
      setCallState("idle");
      updateCallerInfo(null);
      setCallDuration(0);
    });

    call.on("error", (err: Error) => {
      stopRing();
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
    // Don't initialize until the user is authenticated
    if (!authToken) return;

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
        // Auto-apply saved audio device preferences after permissions are granted
        if (typeof window !== "undefined") {
          const savedOutput = localStorage.getItem("tp_crm_output_device");
          const savedInput  = localStorage.getItem("tp_crm_input_device");
          if (savedOutput) {
            (device.audio as any)?.speakerDevices?.set(savedOutput);
            (device.audio as any)?.ringtoneDevices?.set(savedOutput);
          }
          if (savedInput) {
            (device.audio as any)?.setInputDevice?.(savedInput).catch(() => {});
          }
        }
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

      device.on("incoming", async (call: Call) => {
        const from = call.parameters?.From ?? "";
        setCallState("incoming");
        updateCallerInfo(from || "Unknown Caller");
        startRing();
        attachCallListeners(call);

        // Screen pop: navigate to customer profile if the number matches
        if (from && !destroyed) {
          const customerId = await screenPop(from);
          if (!destroyed) {
            if (customerId) {
              activeCallCustomerIdRef.current = customerId;
              router.push(`/customer/${customerId}`);
            } else {
              activeCallCustomerIdRef.current = null;
              updateCallerInfo("Unknown Caller");
            }
          }
        }
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
      stopRing();
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
  }, [authToken]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const makeCall = useCallback((phoneNumber: string, displayName?: string, customerId?: string | null) => {
    if (!deviceRef.current || callState !== "idle") return;
    activeCallCustomerIdRef.current = customerId ?? null;
    setCallState("connecting");
    updateCallerInfo(displayName ?? phoneNumber);

    deviceRef.current
      .connect({ params: { To: phoneNumber } })
      .then((call: Call) => {
        attachCallListeners(call);
      })
      .catch((err: Error) => {
        setCallState("idle");
        updateCallerInfo(null);
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
      stopRing();
      activeCallRef.current.reject();
      setCallState("idle");
      updateCallerInfo(null);
      activeCallCustomerIdRef.current = null;
      activeCallRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const clearLastEndedCall = useCallback(() => {
    setLastEndedCall(null);
  }, []);

  const setOutputDevice = useCallback((deviceId: string) => {
    if (!deviceRef.current?.audio) return;
    (deviceRef.current.audio as any).speakerDevices?.set(deviceId).catch?.(() => {});
    (deviceRef.current.audio as any).ringtoneDevices?.set(deviceId).catch?.(() => {});
  }, []);

  const setInputDevice = useCallback((deviceId: string) => {
    if (!deviceRef.current?.audio) return;
    (deviceRef.current.audio as any).setInputDevice?.(deviceId).catch?.(() => {});
  }, []);

  return (
    <TwilioVoiceContext.Provider
      value={{
        callState,
        callerInfo,
        callDuration,
        isMuted,
        deviceError,
        deviceReady,
        lastEndedCall,
        makeCall,
        acceptCall,
        rejectCall,
        hangUp,
        toggleMute,
        sendDigits,
        clearLastEndedCall,
        setOutputDevice,
        setInputDevice,
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
