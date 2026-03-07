import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import {
  authorizeCustomerWriteAccess,
  resolveActorAgentId,
} from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";
import {
  ensureObject,
  optionalInteger,
  optionalNumber,
  optionalString,
  parseJsonText,
  RequestValidationError,
  requireString,
} from "@/src/lib/requestValidation";
import {
  getCallInteractionBySids,
  getInteractionById,
  upsertCallInteraction,
} from "@/src/lib/voiceCallState";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const ALLOWED_TYPES = new Set(["Call", "Email", "Note", "System", "SMS"]);

interface CreateInteractionPayload {
  customerId: string;
  agentId: number;
  type: string;
  outcome?: string | null;
  note?: string | null;
  twilioCallSid?: string | null;
  callDurationSeconds?: number | null;
  recordingUrl?: string | null;
  callStatus?: string | null;
}

function validateCreatePayload(rawBody: string, auth: Parameters<typeof resolveActorAgentId>[0]): CreateInteractionPayload {
  const body = ensureObject(parseJsonText(rawBody));
  const type = requireString(body.type, "type", { maxLength: 50 });
  if (!ALLOWED_TYPES.has(type)) {
    throw new RequestValidationError("Invalid request payload", [
      { field: "type", message: "Invalid interaction type" },
    ]);
  }

  return {
    customerId: requireString(body.customerId, "customerId", { maxLength: 50 }),
    agentId: resolveActorAgentId(auth, body.agentId),
    type,
    outcome: optionalString(body.outcome, "outcome", { maxLength: 255, emptyToNull: true }),
    note: optionalString(body.note, "note", { maxLength: 10000, emptyToNull: true }),
    twilioCallSid: optionalString(body.twilio_call_sid, "twilio_call_sid", { maxLength: 64, emptyToNull: true }),
    callDurationSeconds: optionalNumber(body.call_duration_seconds, "call_duration_seconds"),
    recordingUrl: optionalString(body.recording_url, "recording_url", { maxLength: 500, emptyToNull: true }),
    callStatus: optionalString(body.call_status, "call_status", { maxLength: 50, emptyToNull: true }),
  };
}

function validatePatchPayload(rawBody: string, auth: Parameters<typeof resolveActorAgentId>[0]) {
  const body = ensureObject(parseJsonText(rawBody));
  return {
    id: optionalInteger(body.id, "id"),
    customerId: optionalString(body.customerId, "customerId", { maxLength: 50, emptyToNull: true }),
    agentId: resolveActorAgentId(auth, body.agentId),
    outcome: optionalString(body.outcome, "outcome", { maxLength: 255, emptyToNull: true }),
    note: optionalString(body.note, "note", { maxLength: 10000, emptyToNull: true }),
    twilioCallSid: optionalString(body.twilio_call_sid, "twilio_call_sid", { maxLength: 64, emptyToNull: true }),
    callDurationSeconds: optionalNumber(body.call_duration_seconds, "call_duration_seconds"),
    recordingUrl: optionalString(body.recording_url, "recording_url", { maxLength: 500, emptyToNull: true }),
  };
}

async function authorizeRowAccess(customerId: string | null | undefined, auth: Parameters<typeof resolveActorAgentId>[0]) {
  if (!customerId) return null;
  const access = await authorizeCustomerWriteAccess(customerId, auth);
  return access instanceof NextResponse ? access : null;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const payload = validateCreatePayload(await req.text(), auth);
    const access = await authorizeCustomerWriteAccess(payload.customerId, auth);
    if (access instanceof NextResponse) return access;

    if (payload.type === "Call" || payload.twilioCallSid) {
      const interaction = await upsertCallInteraction({
        lookupSids: payload.twilioCallSid ? [payload.twilioCallSid] : [],
        twilioCallSid: payload.twilioCallSid ?? null,
        customerId: payload.customerId,
        agentId: payload.agentId,
        outcome: payload.outcome ?? null,
        callStatus: payload.callStatus ?? null,
        note: payload.note ?? null,
        direction: null,
        callDurationSeconds: payload.callDurationSeconds ?? null,
        recordingUrl: payload.recordingUrl ?? null,
        metadata: { updatedFrom: "interactions-post" },
      });

      if (!interaction) {
        return jsonError("Failed to create interaction", 500);
      }

      return NextResponse.json(interaction, { status: 201 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions (customer_id, agent_id, type, outcome, note)
       VALUES (?, ?, ?, ?, ?)`,
      [
        payload.customerId,
        payload.agentId,
        payload.type,
        payload.outcome ?? null,
        payload.note ?? null,
      ]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.call_status, i.note,
              i.twilio_call_sid, i.call_duration_seconds, i.recording_url,
              i.created_at, u.name AS agent_name
       FROM   interactions i
       LEFT JOIN users u ON u.id = i.agent_id
       WHERE  i.id = ?`,
      [result.insertId]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/interactions]", message);
    return jsonError(message, 500);
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const interactionId = searchParams.get("id");
    const twilioCallSid = searchParams.get("twilio_call_sid");

    if (!interactionId && !twilioCallSid) {
      return jsonError("id or twilio_call_sid is required", 400);
    }

    const row = interactionId
      ? await getInteractionById(Number(interactionId))
      : await getCallInteractionBySids([twilioCallSid ?? ""]);

    if (!row) {
      return jsonError("Interaction not found", 404);
    }

    const accessError = await authorizeRowAccess(row.customer_id, auth);
    if (accessError) return accessError;

    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/interactions]", message);
    return jsonError(message, 500);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const payload = validatePatchPayload(await req.text(), auth);

    if (!payload.id && !payload.twilioCallSid) {
      return jsonError("id or twilio_call_sid is required", 400);
    }

    const existing = payload.id
      ? await getInteractionById(Number(payload.id))
      : await getCallInteractionBySids([String(payload.twilioCallSid)]);

    const accessError = await authorizeRowAccess(payload.customerId ?? existing?.customer_id, auth);
    if (accessError) return accessError;

    const resolvedCallSid = payload.twilioCallSid ?? existing?.twilio_call_sid ?? null;
    const updated = await upsertCallInteraction({
      lookupSids: resolvedCallSid ? [resolvedCallSid] : [],
      twilioCallSid: resolvedCallSid,
      customerId:
        payload.customerId !== undefined
          ? payload.customerId
          : existing?.customer_id,
      agentId: payload.agentId ?? existing?.agent_id ?? auth.id,
      outcome: payload.outcome !== undefined ? payload.outcome : existing?.outcome,
      note: payload.note !== undefined ? payload.note : existing?.note,
      direction: (existing?.direction as "inbound" | "outbound" | null | undefined) ?? null,
      callDurationSeconds:
        payload.callDurationSeconds !== undefined
          ? payload.callDurationSeconds
          : existing?.call_duration_seconds,
      recordingUrl:
        payload.recordingUrl !== undefined
          ? payload.recordingUrl
          : existing?.recording_url,
      metadata: { updatedFrom: "post-call-modal" },
    });

    if (!updated) {
      return jsonError("Interaction not found", 404);
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/interactions]", message);
    return jsonError(message, 500);
  }
}

