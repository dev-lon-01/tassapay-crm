import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const FILE_PREFIX = "voice-diagnostics-";
const FILE_SUFFIX = ".log";
const MAX_MESSAGE_LEN = 500;
const MAX_PAYLOAD_BYTES = 4096;
const RETENTION_DAYS = parsePositiveInt(process.env.VOICE_DIAG_RETENTION_DAYS, 14);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function logPathFor(stamp: string): string {
  return path.join(LOG_DIR, `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`);
}

let stream: fs.WriteStream | null = null;
let streamStamp: string | null = null;

function purgeOldLogs(): void {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of files) {
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
      const stamp = name.slice(FILE_PREFIX.length, name.length - FILE_SUFFIX.length);
      const ts = Date.parse(`${stamp}T00:00:00Z`);
      if (Number.isFinite(ts) && ts < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, name));
      }
    }
  } catch {
    /* swallow — purge is best-effort */
  }
}

function getStream(): fs.WriteStream | null {
  const stamp = todayStamp();
  if (stream && streamStamp === stamp) return stream;

  if (stream && streamStamp !== stamp) {
    try { stream.end(); } catch { /* ignore */ }
    stream = null;
  }

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const next = fs.createWriteStream(logPathFor(stamp), { flags: "a", encoding: "utf8" });
    next.on("error", (err) => {
      console.error("[voiceDiagnostics] stream error:", err);
      if (stream === next) {
        stream = null;
        streamStamp = null;
      }
    });
    stream = next;
    streamStamp = stamp;
    purgeOldLogs();
    return stream;
  } catch (err) {
    console.error("[voiceDiagnostics] failed to open log:", err);
    return null;
  }
}

function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

function clampPayload(payload: unknown): unknown {
  if (payload == null) return null;
  try {
    const json = JSON.stringify(payload);
    if (json.length <= MAX_PAYLOAD_BYTES) return payload;
    return { _truncated: true, preview: json.slice(0, MAX_PAYLOAD_BYTES) };
  } catch {
    return { _unserializable: true };
  }
}

export type VoiceDiagSeverity = "info" | "warn" | "error";
export type VoiceDiagSource = "client" | "server";

export interface VoiceDiagnosticEntry {
  source: VoiceDiagSource;
  eventType: string;
  severity: VoiceDiagSeverity;
  agentId?: number | null;
  callSid?: string | null;
  direction?: "inbound" | "outbound" | null;
  errorCode?: string | number | null;
  message?: string | null;
  userAgent?: string | null;
  connectionType?: string | null;
  phoneMasked?: string | null;
  payload?: unknown;
}

export function recordVoiceDiagnostic(entry: VoiceDiagnosticEntry): void {
  try {
    const s = getStream();
    if (!s) return;
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        src: entry.source,
        ev: entry.eventType,
        sev: entry.severity,
        agentId: entry.agentId ?? null,
        callSid: entry.callSid ?? null,
        direction: entry.direction ?? null,
        errorCode: entry.errorCode ?? null,
        message: entry.message ? String(entry.message).slice(0, MAX_MESSAGE_LEN) : null,
        ua: entry.userAgent ?? null,
        connType: entry.connectionType ?? null,
        phone: entry.phoneMasked ?? null,
        payload: clampPayload(entry.payload),
      }) + "\n";
    s.write(line);
  } catch (err) {
    console.error("[voiceDiagnostics] record failed:", err);
  }
}

export const voiceDiagnostics = {
  record: recordVoiceDiagnostic,
  maskPhone,
};
