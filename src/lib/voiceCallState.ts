import twilio from "twilio";
import { pool } from "@/src/lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

type JsonObject = Record<string, unknown>;

export interface VoiceInteractionRow extends RowDataPacket {
  id: number;
  customer_id: string | null;
  agent_id: number | null;
  type: string;
  outcome: string | null;
  note: string | null;
  direction: string | null;
  metadata: unknown;
  twilio_call_sid: string | null;
  call_duration_seconds: number | null;
  recording_url: string | null;
  created_at: string;
  agent_name?: string | null;
}

export interface UpsertCallInteractionInput {
  lookupSids?: string[];
  twilioCallSid?: string | null;
  customerId?: string | null;
  agentId?: number | null;
  outcome?: string | null;
  note?: string | null;
  direction?: "inbound" | "outbound" | null;
  callDurationSeconds?: number | null;
  recordingUrl?: string | null;
  metadata?: JsonObject;
}

const JSON_SID_PATHS = [
  "$.callSid",
  "$.parentCallSid",
  "$.dialCallSid",
  "$.recordingCallSid",
  "$.legCallSid",
  "$.clientCallSid",
];

export function parseTwilioFormBody(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text).entries()) {
    params[key] = value;
  }
  return params;
}

export function validateTwilioWebhook(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) return true;
  if (!authToken || !signature || !url) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

export function buildExpectedWebhookUrl(pathnameWithSearch: string): string {
  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  return `${baseUrl}${pathnameWithSearch}`;
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}

export function extractE164FromSip(uri: string): string | null {
  if (isValidE164(uri)) return uri;
  const match = uri.match(/sip:(\+[0-9]+)@/i);
  return match ? match[1] : null;
}

export function extractClientIdentity(value: string): string | null {
  return value.startsWith("client:") ? value.slice("client:".length) : null;
}

export function extractSipUsername(value: string): string | null {
  const match = value.match(/^sip:([^@;]+)@/i);
  return match ? match[1] : null;
}

function normalizeDigits(value: string): string {
  return value.replace(/[\s\-+]/g, "");
}

function parseMetadata(value: unknown): JsonObject {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function cleanMetadata(input: JsonObject | undefined): JsonObject {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
}

function buildSidLookupSql(alias: string, sidCount: number): string {
  return Array.from({ length: sidCount }, () => {
    const jsonChecks = JSON_SID_PATHS.map(
      (path) => `JSON_UNQUOTE(JSON_EXTRACT(${alias}.metadata, '${path}')) = ?`
    );
    return [`${alias}.twilio_call_sid = ?`, ...jsonChecks].join(" OR ");
  })
    .map((group) => `(${group})`)
    .join(" OR ");
}

function buildSidLookupParams(sids: string[]): string[] {
  return sids.flatMap((sid) => [sid, ...JSON_SID_PATHS.map(() => sid)]);
}

export async function findCustomerIdByPhone(phone: string | null | undefined): Promise<string | null> {
  if (!phone) return null;

  const normalized = normalizeDigits(phone);
  if (!normalized) return null;
  const last9 = normalized.slice(-9);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT customer_id FROM customers
     WHERE  REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
        OR  RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
     LIMIT 1`,
    [normalized, last9]
  );

  return rows.length > 0 ? (rows[0].customer_id as string) : null;
}

export async function findAgentIdByIdentity(identity: string | null | undefined): Promise<number | null> {
  if (!identity) return null;

  const clientIdentity = extractClientIdentity(identity);
  if (clientIdentity?.startsWith("agent_")) {
    const numericId = Number(clientIdentity.slice("agent_".length));
    return Number.isFinite(numericId) ? numericId : null;
  }

  const sipUsername = extractSipUsername(identity) ?? identity;
  if (!sipUsername) return null;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE sip_username = ? OR email = ? LIMIT 1`,
    [sipUsername, sipUsername]
  );

  return rows.length > 0 ? Number(rows[0].id) : null;
}

export async function getInteractionById(id: number): Promise<VoiceInteractionRow | null> {
  const [rows] = await pool.execute<VoiceInteractionRow[]>(
    `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.note,
            i.direction, i.metadata, i.twilio_call_sid, i.call_duration_seconds,
            i.recording_url, i.created_at, u.name AS agent_name
     FROM   interactions i
     LEFT JOIN users u ON u.id = i.agent_id
     WHERE  i.id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] ?? null;
}

export async function getCallInteractionBySids(sids: string[]): Promise<VoiceInteractionRow | null> {
  const uniqueSids = [...new Set(sids.filter(Boolean))];
  if (uniqueSids.length === 0) return null;

  const [rows] = await pool.execute<VoiceInteractionRow[]>(
    `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.note,
            i.direction, i.metadata, i.twilio_call_sid, i.call_duration_seconds,
            i.recording_url, i.created_at, u.name AS agent_name
     FROM   interactions i
     LEFT JOIN users u ON u.id = i.agent_id
     WHERE  ${buildSidLookupSql("i", uniqueSids.length)}
     ORDER BY i.id DESC
     LIMIT 1`,
    buildSidLookupParams(uniqueSids)
  );

  return rows[0] ?? null;
}

export async function upsertCallInteraction(input: UpsertCallInteractionInput): Promise<VoiceInteractionRow | null> {
  const lookupSids = [...new Set([...(input.lookupSids ?? []), input.twilioCallSid ?? ""].filter(Boolean))];
  const existing = await getCallInteractionBySids(lookupSids);

  const incomingMetadata = cleanMetadata(input.metadata);

  if (existing) {
    const existingMetadata = parseMetadata(existing.metadata);
    const mergedMetadata = { ...existingMetadata, ...incomingMetadata };

    await pool.execute<ResultSetHeader>(
      `UPDATE interactions
       SET customer_id = ?,
           agent_id = ?,
           outcome = ?,
           note = ?,
           direction = ?,
           metadata = ?,
           twilio_call_sid = ?,
           call_duration_seconds = ?,
           recording_url = ?
       WHERE id = ?`,
      [
        input.customerId !== undefined ? input.customerId : existing.customer_id,
        input.agentId !== undefined ? input.agentId : existing.agent_id,
        input.outcome !== undefined ? input.outcome : existing.outcome,
        input.note !== undefined ? input.note : existing.note,
        input.direction !== undefined ? input.direction : existing.direction,
        Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
        input.twilioCallSid ?? existing.twilio_call_sid,
        input.callDurationSeconds !== undefined ? input.callDurationSeconds : existing.call_duration_seconds,
        input.recordingUrl !== undefined ? input.recordingUrl : existing.recording_url,
        existing.id,
      ]
    );

    return getInteractionById(existing.id);
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO interactions
       (customer_id, agent_id, type, outcome, note, direction, metadata,
        twilio_call_sid, call_duration_seconds, recording_url)
     VALUES (?, ?, 'Call', ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.customerId ?? null,
      input.agentId ?? null,
      input.outcome ?? null,
      input.note ?? null,
      input.direction ?? null,
      Object.keys(incomingMetadata).length > 0 ? JSON.stringify(incomingMetadata) : null,
      input.twilioCallSid ?? lookupSids[0] ?? null,
      input.callDurationSeconds ?? null,
      input.recordingUrl ?? null,
    ]
  );

  return getInteractionById(result.insertId);
}