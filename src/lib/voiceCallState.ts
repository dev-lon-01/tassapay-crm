import twilio from "twilio";
import { pool } from "@/src/lib/db";
import { getPhoneLast9, normalizePhoneValue } from "@/src/lib/phoneUtils";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

type JsonObject = Record<string, unknown>;

export interface VoiceInteractionRow extends RowDataPacket {
  id: number;
  customer_id: string | null;
  agent_id: number | null;
  type: string;
  outcome: string | null;
  call_status: string | null;
  note: string | null;
  direction: string | null;
  metadata: unknown;
  twilio_call_sid: string | null;
  call_duration_seconds: number | null;
  recording_url: string | null;
  request_id: string | null;
  provider_message_id: string | null;
  created_at: string;
  agent_name?: string | null;
}

export interface UpsertCallInteractionInput {
  lookupSids?: string[];
  twilioCallSid?: string | null;
  customerId?: string | null;
  agentId?: number | null;
  outcome?: string | null;
  callStatus?: string | null;
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

const INTERACTION_SELECT_SQL = `
SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.call_status, i.note,
       i.direction, i.metadata, i.twilio_call_sid, i.call_duration_seconds,
       i.recording_url, i.request_id, i.provider_message_id, i.created_at,
       u.name AS agent_name
FROM   interactions i
LEFT JOIN users u ON u.id = i.agent_id
`;

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

  const normalized = normalizePhoneValue(phone);
  const last9 = getPhoneLast9(phone);
  if (!normalized || !last9) return null;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT customer_id
     FROM   customers
     WHERE  phone_normalized = ?
        OR  phone_last9 = ?
        OR  REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
        OR  RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
     LIMIT 1`,
    [normalized, last9, normalized, last9]
  );

  return rows.length > 0 ? String(rows[0].customer_id) : null;
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
    `${INTERACTION_SELECT_SQL}
     WHERE  i.id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] ?? null;
}

export async function getInteractionByRequestId(requestId: string): Promise<VoiceInteractionRow | null> {
  const [rows] = await pool.execute<VoiceInteractionRow[]>(
    `${INTERACTION_SELECT_SQL}
     WHERE  i.request_id = ?
     LIMIT 1`,
    [requestId]
  );

  return rows[0] ?? null;
}

export async function getCallInteractionBySids(sids: string[]): Promise<VoiceInteractionRow | null> {
  const uniqueSids = [...new Set(sids.filter(Boolean))];
  if (uniqueSids.length === 0) return null;

  const [rows] = await pool.execute<VoiceInteractionRow[]>(
    `${INTERACTION_SELECT_SQL}
     WHERE  ${buildSidLookupSql("i", uniqueSids.length)}
     ORDER BY i.id DESC
     LIMIT 1`,
    buildSidLookupParams(uniqueSids)
  );

  return rows[0] ?? null;
}

export async function persistVoiceWebhookEvent(input: {
  source: string;
  canonicalSid?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `INSERT INTO voice_webhook_events (source, canonical_sid, event_type, payload)
     VALUES (?, ?, ?, ?)`,
    [
      input.source,
      input.canonicalSid ?? null,
      input.eventType,
      JSON.stringify(input.payload),
    ]
  );
}

export async function upsertCallInteraction(input: UpsertCallInteractionInput): Promise<VoiceInteractionRow | null> {
  const incomingMetadata = cleanMetadata(input.metadata);
  const lookupSids = [...new Set([...(input.lookupSids ?? []), input.twilioCallSid ?? ""].filter(Boolean))];

  const existing = lookupSids.length > 0
    ? await getCallInteractionBySids(lookupSids)
    : null;

  const canonicalSid = input.twilioCallSid ?? existing?.twilio_call_sid ?? lookupSids[0] ?? null;
  const metadataJson = Object.keys(incomingMetadata).length > 0
    ? JSON.stringify(incomingMetadata)
    : null;

  if (!canonicalSid && !existing) {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions
         (customer_id, agent_id, type, outcome, call_status, note, direction, metadata,
          twilio_call_sid, call_duration_seconds, recording_url)
       VALUES (?, ?, 'Call', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        input.customerId ?? null,
        input.agentId ?? null,
        input.outcome ?? null,
        input.callStatus ?? null,
        input.note ?? null,
        input.direction ?? null,
        metadataJson,
        input.callDurationSeconds ?? null,
        input.recordingUrl ?? null,
      ]
    );
    return getInteractionById(result.insertId);
  }

  await pool.execute<ResultSetHeader>(
    `INSERT INTO interactions
       (customer_id, agent_id, type, outcome, call_status, note, direction, metadata,
        twilio_call_sid, call_duration_seconds, recording_url)
     VALUES (?, ?, 'Call', ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       customer_id = COALESCE(VALUES(customer_id), customer_id),
       agent_id = COALESCE(VALUES(agent_id), agent_id),
       outcome = COALESCE(VALUES(outcome), outcome),
       call_status = COALESCE(VALUES(call_status), call_status),
       note = COALESCE(VALUES(note), note),
       direction = COALESCE(VALUES(direction), direction),
       metadata = CASE
         WHEN VALUES(metadata) IS NULL THEN metadata
         WHEN metadata IS NULL THEN VALUES(metadata)
         ELSE JSON_MERGE_PATCH(metadata, VALUES(metadata))
       END,
       call_duration_seconds = COALESCE(VALUES(call_duration_seconds), call_duration_seconds),
       recording_url = COALESCE(VALUES(recording_url), recording_url)`,
    [
      input.customerId ?? existing?.customer_id ?? null,
      input.agentId ?? existing?.agent_id ?? null,
      input.outcome ?? existing?.outcome ?? null,
      input.callStatus ?? existing?.call_status ?? null,
      input.note ?? existing?.note ?? null,
      input.direction ?? (existing?.direction as "inbound" | "outbound" | null | undefined) ?? null,
      metadataJson,
      canonicalSid,
      input.callDurationSeconds ?? existing?.call_duration_seconds ?? null,
      input.recordingUrl ?? existing?.recording_url ?? null,
    ]
  );

  return canonicalSid ? getCallInteractionBySids([canonicalSid, ...lookupSids]) : existing;
}

export async function getFreshVoiceAgentRows(ttlSeconds: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, sip_username
     FROM   users
     WHERE  voice_available = 1
       AND  voice_last_seen_at IS NOT NULL
       AND  voice_last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)
     ORDER BY id ASC`,
    [ttlSeconds]
  );
  return rows;
}




