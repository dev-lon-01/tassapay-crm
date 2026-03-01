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
 */
export function useAudioDevices() {
  const [audioOutputs, setAudioOutputs] = useState<AudioDevice[]>([]);
  const [audioInputs,  setAudioInputs]  = useState<AudioDevice[]>([]);

  const enumerate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputs(
        devices
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
