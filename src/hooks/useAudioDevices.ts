"use client";

import { useCallback, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioDevice {
  deviceId: string;
  label: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Enumerates the browser's audio input/output devices.
 *
 * Labels are only populated AFTER microphone permission has been granted
 * (i.e. after the Twilio Device has been initialised and permissions accepted).
 * Call `refresh()` at that point if you need the labelled list immediately.
 *
 * iOS / Safari: setSinkId is not supported, so audioOutputs is always []
 * on those platforms. The CallWidget should hide the output selector when
 * this list is empty.
 */
export function useAudioDevices() {
  const [audioOutputs, setAudioOutputs] = useState<AudioDevice[]>([]);
  const [audioInputs,  setAudioInputs]  = useState<AudioDevice[]>([]);

  const enumerate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    // setSinkId is unsupported on iOS/Safari — skip output enumeration entirely
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes("Mac") && "ontouchend" in document);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputs(
        isIOS
          ? []   // hide output selector on iOS — setSinkId throws
          : devices
              .filter((d) => d.kind === "audiooutput")
              .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))
      );
      setAudioInputs(
        devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
      );
    } catch {
      // enumerateDevices not supported — silently ignore
    }
  }, []);

  useEffect(() => {
    enumerate();
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", enumerate);
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumerate);
  }, [enumerate]);

  return { audioOutputs, audioInputs, refresh: enumerate };
}
