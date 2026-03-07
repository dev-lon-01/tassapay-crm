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

export type CallState = "idle" | "connecting" | "active" | "incoming";
export type ConnectionState = "starting" | "ready" | "lost" | "mic-blocked";

export interface EndedCall {
  callSid: string | null;
  durationSeconds: number;
  callerInfo: string;
  customerId: string | null;
  phone: string | null;
  direction: "inbound" | "outbound";
}

interface VoiceTokenResponse {
  token: string;
  identity: string;
  ttlSeconds: number;
  expiresAt: number;
  heartbeatIntervalSeconds: number;
  agentTtlSeconds: number;
}

interface TwilioVoiceContextValue {
  callState: CallState;
  connectionState: ConnectionState;
  connectionMessage: string | null;
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
  setInputDevice: (deviceId: string) => void;
}

const TwilioVoiceContext = createContext<TwilioVoiceContextValue | null>(null);

export function TwilioVoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token: authToken } = useAuth();

  const deviceRef = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRequestRef = useRef<Promise<VoiceTokenResponse | null> | null>(null);
  const callDurationRef = useRef(0);
  const callSidRef = useRef<string | null>(null);
  const callerInfoRef = useRef<string | null>(null);
  const activeCallCustomerIdRef = useRef<string | null>(null);
  const activeCallPhoneRef = useRef<string | null>(null);
  const activeCallDirectionRef = useRef<"inbound" | "outbound">("inbound");
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);
  const availabilityRef = useRef<boolean | null>(null);
  const heartbeatIntervalMsRef = useRef(20000);
  const callStateRef = useRef<CallState>("idle");
  const connectionStateRef = useRef<ConnectionState>("starting");

  const [callState, setCallState] = useState<CallState>("idle");
  const [connectionState, setConnectionState] = useState<ConnectionState>("starting");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [callerInfo, setCallerInfo] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [lastEndedCall, setLastEndedCall] = useState<EndedCall | null>(null);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const setConnection = useCallback((state: ConnectionState, message: string | null = null) => {
    setConnectionState(state);
    setConnectionMessage(message);
    setDeviceReady(state === "ready");
    if (state === "mic-blocked") {
      setDeviceError("MIC_BLOCKED");
    } else if (state === "ready") {
      setDeviceError(null);
    } else {
      setDeviceError(message ?? null);
    }
  }, []);

  function updateCallerInfo(info: string | null) {
    callerInfoRef.current = info;
    setCallerInfo(info);
  }

  const updateVoiceAvailability = useCallback((available: boolean, options?: { force?: boolean }) => {
    if (!authToken) return;
    if (!options?.force && availabilityRef.current === available) return;
    availabilityRef.current = available;
    apiFetch("/api/voice/available", {
      method: "PATCH",
      body: JSON.stringify({ available }),
    }).catch(() => {
      if (available) {
        availabilityRef.current = null;
      }
    });
  }, [authToken]);

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

  function startTimer() {
    callDurationRef.current = 0;
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      callDurationRef.current += 1;
      setCallDuration((seconds) => seconds + 1);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

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

  function attachCallListeners(call: Call) {
    activeCallRef.current = call;

    const earlyParams = (call as unknown as { parameters?: Record<string, string> }).parameters;
    if (earlyParams?.CallSid) {
      callSidRef.current = earlyParams.CallSid;
    }

    call.on("accept", (acceptedCall: Call) => {
      stopRing();
      const sid = acceptedCall.parameters?.CallSid ?? null;
      if (sid) callSidRef.current = sid;
      setCallState("active");
      setIsMuted(false);
      updateVoiceAvailability(false);
      startTimer();
    });

    call.on("disconnect", () => {
      stopRing();
      const durationSnap = callDurationRef.current;
      const callerSnap = callerInfoRef.current ?? "Unknown";
      const sidSnap = callSidRef.current;
      const customerIdSnap = activeCallCustomerIdRef.current;
      const phoneSnap = activeCallPhoneRef.current;
      const directionSnap = activeCallDirectionRef.current;

      stopTimer();
      callDurationRef.current = 0;
      callSidRef.current = null;
      activeCallCustomerIdRef.current = null;
      activeCallPhoneRef.current = null;
      activeCallDirectionRef.current = "inbound";
      activeCallRef.current = null;

      setCallState("idle");
      updateCallerInfo(null);
      setIsMuted(false);
      setCallDuration(0);

      setLastEndedCall({
        callSid: sidSnap,
        durationSeconds: durationSnap,
        callerInfo: callerSnap,
        customerId: customerIdSnap,
        phone: phoneSnap,
        direction: directionSnap,
      });
    });

    call.on("cancel", () => {
      stopRing();
      stopTimer();
      callDurationRef.current = 0;
      callSidRef.current = null;
      activeCallCustomerIdRef.current = null;
      activeCallPhoneRef.current = null;
      activeCallDirectionRef.current = "inbound";
      activeCallRef.current = null;
      setCallState("idle");
      updateCallerInfo(null);
      setCallDuration(0);
    });

    call.on("error", (err: Error) => {
      stopRing();
      setConnection("lost", err.message || "Connection Lost");
      updateVoiceAvailability(false, { force: true });
    });
  }

  const fetchVoiceToken = useCallback(async (): Promise<VoiceTokenResponse | null> => {
    if (tokenRequestRef.current) {
      return tokenRequestRef.current;
    }

    tokenRequestRef.current = (async () => {
      try {
        const res = await apiFetch("/api/voice/token");
        if (!res.ok) return null;
        const data = await res.json() as VoiceTokenResponse;
        heartbeatIntervalMsRef.current = Math.max(10000, (data.heartbeatIntervalSeconds || 20) * 1000);
        return data;
      } catch {
        return null;
      } finally {
        tokenRequestRef.current = null;
      }
    })();

    return tokenRequestRef.current;
  }, []);

  const refreshTokenWithRetry = useCallback(async (attempts = 3): Promise<VoiceTokenResponse | null> => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const tokenData = await fetchVoiceToken();
      if (tokenData) return tokenData;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
    return null;
  }, [fetchVoiceToken]);

  useEffect(() => {
    if (!authToken) {
      setConnection("starting", null);
      return;
    }

    let destroyed = false;

    async function init() {
      setConnection("starting", "Connecting...");
      const tokenData = await refreshTokenWithRetry();
      if (!tokenData || destroyed) {
        if (!destroyed) setConnection("lost", "Connection Lost");
        return;
      }

      const { Device: TwilioDevice } = await import("@twilio/voice-sdk");
      if (destroyed) return;

      const device = new TwilioDevice(tokenData.token, {
        codecPreferences: ["opus", "pcmu"] as unknown as string[],
      } as unknown as Record<string, unknown>);

      deviceRef.current = device;

      device.on("registering", () => {
        if (!destroyed) setConnection("starting", "Connecting...");
      });

      device.on("registered", () => {
        if (destroyed) return;
        setConnection("ready", null);
        if (typeof window !== "undefined") {
          const savedOutput = localStorage.getItem("tp_crm_output_device");
          const savedInput = localStorage.getItem("tp_crm_input_device");
          if (savedOutput) {
            (device.audio as any)?.speakerDevices?.set(savedOutput);
            (device.audio as any)?.ringtoneDevices?.set(savedOutput);
          }
          if (savedInput) {
            (device.audio as any)?.setInputDevice?.(savedInput).catch(() => {});
          }
        }
        if (callStateRef.current === "idle") {
          updateVoiceAvailability(true, { force: true });
        }
      });

      device.on("unregistered", () => {
        if (destroyed) return;
        setConnection("lost", "Connection Lost");
        updateVoiceAvailability(false, { force: true });
      });

      device.on("error", (err: Error) => {
        const message = err.message ?? String(err);
        if (
          message.includes("NotAllowedError") ||
          message.includes("Permission denied") ||
          message.includes("PermissionDeniedError")
        ) {
          setConnection("mic-blocked", "Microphone blocked");
        } else {
          setConnection("lost", message || "Connection Lost");
        }
        updateVoiceAvailability(false, { force: true });
      });

      (device as unknown as { on?: (event: string, handler: () => void) => void }).on?.("offline", () => {
        if (destroyed) return;
        setConnection("lost", "Connection Lost");
        updateVoiceAvailability(false, { force: true });
      });

      device.on("incoming", async (call: Call) => {
        const from = call.parameters?.From ?? "";
        setCallState("incoming");
        updateCallerInfo(from || "Unknown Caller");
        activeCallPhoneRef.current = from || null;
        activeCallDirectionRef.current = "inbound";
        updateVoiceAvailability(false, { force: true });
        startRing();
        attachCallListeners(call);

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
        const refreshed = await refreshTokenWithRetry();
        if (refreshed && !destroyed) {
          await device.updateToken(refreshed.token);
          if (connectionStateRef.current !== "ready" && callStateRef.current === "idle") {
            device.register();
          }
        } else if (!destroyed) {
          setConnection("lost", "Connection Lost");
        }
      });

      device.register();
    }

    function handleBrowserOffline() {
      setConnection("lost", "Connection Lost");
      updateVoiceAvailability(false, { force: true });
    }

    function handleBrowserOnline() {
      setConnection("starting", "Reconnecting...");
      deviceRef.current?.register();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("offline", handleBrowserOffline);
      window.addEventListener("online", handleBrowserOnline);
    }

    init().catch(() => {
      if (!destroyed) {
        setConnection("lost", "Connection Lost");
        updateVoiceAvailability(false, { force: true });
      }
    });

    return () => {
      destroyed = true;
      stopTimer();
      stopRing();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", handleBrowserOffline);
        window.removeEventListener("online", handleBrowserOnline);
      }
      if (deviceRef.current) {
        updateVoiceAvailability(false, { force: true });
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
  }, [authToken, refreshTokenWithRetry, router, setConnection, updateVoiceAvailability]);

  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    const shouldHeartbeat = authToken && connectionState === "ready" && callState === "idle";
    if (!shouldHeartbeat) {
      if (authToken) {
        updateVoiceAvailability(false);
      }
      return;
    }

    updateVoiceAvailability(true, { force: true });
    heartbeatRef.current = setInterval(() => {
      updateVoiceAvailability(true, { force: true });
    }, heartbeatIntervalMsRef.current);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [authToken, callState, connectionState, updateVoiceAvailability]);

  const makeCall = useCallback((phoneNumber: string, displayName?: string, customerId?: string | null) => {
    if (!deviceRef.current || callState !== "idle" || connectionState !== "ready") return;
    activeCallCustomerIdRef.current = customerId ?? null;
    activeCallPhoneRef.current = phoneNumber;
    activeCallDirectionRef.current = "outbound";
    setCallState("connecting");
    setDeviceError(null);
    setConnectionMessage(null);
    updateCallerInfo(displayName ?? phoneNumber);
    updateVoiceAvailability(false, { force: true });

    deviceRef.current
      .connect({ params: { To: phoneNumber } })
      .then((call: Call) => {
        attachCallListeners(call);
      })
      .catch((err: Error) => {
        setCallState("idle");
        updateCallerInfo(null);
        setDeviceError(err.message || "Call failed");
        setConnectionMessage(err.message || "Call failed");
        updateVoiceAvailability(false, { force: true });
      });
  }, [callState, connectionState, setConnection, updateVoiceAvailability]);

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
        connectionState,
        connectionMessage,
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

export function useTwilioVoice(): TwilioVoiceContextValue {
  const ctx = useContext(TwilioVoiceContext);
  if (!ctx) throw new Error("useTwilioVoice must be used inside <TwilioVoiceProvider>");
  return ctx;
}




