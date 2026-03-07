import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import {
  getCallInteractionBySids,
  getInteractionById,
  upsertCallInteraction,
} from "@/src/lib/voiceCallState";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/interactions
 *
 * Logs a new agent interaction against a customer.
 *
 * Request body:
 *   {
 *     customerId : "3146",        // required – must match customers.customer_id
 *     agentId    : 1,             // optional – FK to users.id
 *     type       : "Call",        // required – 'Call' | 'Email' | 'Note' | 'System'
 *     outcome    : "Left Voicemail",
 *     note       : "Will try again tomorrow"
 *   }
 *
 * Returns the newly created interaction row (201 Created).
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { customerId, agentId, type, outcome, note, twilio_call_sid, call_duration_seconds, recording_url } = body ?? {};

    if (!customerId || !type) {
      return NextResponse.json(
        { error: "customerId and type are required" },
        { status: 400 }
      );
    }

    // Insert
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions (customer_id, agent_id, type, outcome, note, twilio_call_sid, call_duration_seconds, recording_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(customerId),
        agentId != null ? Number(agentId) : null,
        String(type),
        outcome != null ? String(outcome) : null,
        note    != null ? String(note)    : null,
        twilio_call_sid        != null ? String(twilio_call_sid)        : null,
        call_duration_seconds  != null ? Number(call_duration_seconds)  : null,
        recording_url          != null ? String(recording_url)          : null,
      ]
    );

    // Return the full row so the client can optimistically append it
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.note,
              i.twilio_call_sid, i.call_duration_seconds, i.recording_url,
              i.created_at, u.name AS agent_name
       FROM   interactions i
       LEFT JOIN users u ON u.id = i.agent_id
       WHERE  i.id = ?`,
      [result.insertId]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/interactions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
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
      return NextResponse.json(
        { error: "id or twilio_call_sid is required" },
        { status: 400 }
      );
    }

    const row = interactionId
      ? await getInteractionById(Number(interactionId))
      : await getCallInteractionBySids([twilioCallSid ?? ""]);

    if (!row) {
      return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/interactions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const {
      id,
      customerId,
      agentId,
      outcome,
      note,
      twilio_call_sid,
      call_duration_seconds,
      recording_url,
    } = body ?? {};

    if (!id && !twilio_call_sid) {
      return NextResponse.json(
        { error: "id or twilio_call_sid is required" },
        { status: 400 }
      );
    }

    const existing = id
      ? await getInteractionById(Number(id))
      : await getCallInteractionBySids([String(twilio_call_sid)]);

    const resolvedCallSid = twilio_call_sid != null
      ? String(twilio_call_sid)
      : (existing?.twilio_call_sid ?? null);

    const updated = await upsertCallInteraction({
      lookupSids: resolvedCallSid ? [resolvedCallSid] : [],
      twilioCallSid: resolvedCallSid,
      customerId: customerId !== undefined ? (customerId != null ? String(customerId) : null) : existing?.customer_id,
      agentId: agentId !== undefined ? (agentId != null ? Number(agentId) : null) : (existing?.agent_id ?? auth.id),
      outcome: outcome !== undefined ? (outcome != null ? String(outcome) : null) : existing?.outcome,
      note: note !== undefined ? (note != null ? String(note) : null) : existing?.note,
      direction: (existing?.direction as "inbound" | "outbound" | null | undefined) ?? null,
      callDurationSeconds:
        call_duration_seconds !== undefined
          ? (call_duration_seconds != null ? Number(call_duration_seconds) : null)
          : existing?.call_duration_seconds,
      recordingUrl:
        recording_url !== undefined
          ? (recording_url != null ? String(recording_url) : null)
          : existing?.recording_url,
      metadata: { updatedFrom: "post-call-modal" },
    });

    if (!updated) {
      return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/interactions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
