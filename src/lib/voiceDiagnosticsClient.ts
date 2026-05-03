import { apiFetch } from "@/src/lib/apiFetch";

export type DiagSeverity = "info" | "warn" | "error";

export interface ClientDiagEvent {
  eventType: string;
  severity: DiagSeverity;
  callSid?: string | null;
  direction?: "inbound" | "outbound" | null;
  errorCode?: string | number | null;
  message?: string | null;
  phoneMasked?: string | null;
  payload?: unknown;
}

function getConnectionType(): string | null {
  if (typeof navigator === "undefined") return null;
  const conn = (navigator as unknown as {
    connection?: { effectiveType?: string };
  }).connection;
  return conn?.effectiveType ?? null;
}

export function logDiagnostic(event: ClientDiagEvent): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({
      ...event,
      connectionType: getConnectionType(),
    });
    apiFetch("/api/voice/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    } as RequestInit).catch(() => {});
  } catch {
    /* swallow */
  }
}

export function maskPhoneClient(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}
