import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { pool } from "@/src/lib/db";
import { normalizePhone } from "@/src/lib/phoneUtils";
import { requireAuth } from "@/src/lib/auth";
import {
  authorizeCustomerWriteAccess,
  resolveActorAgentId,
} from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";
import {
  ensureObject,
  optionalString,
  parseJsonText,
  RequestValidationError,
  requireString,
  requireUuid,
} from "@/src/lib/requestValidation";
import {
  getInteractionById,
  getInteractionByRequestId,
} from "@/src/lib/voiceCallState";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

interface SmsPayload {
  customerId: string;
  requestId: string;
  actorAgentId: number;
  overridePhone: string | null;
  message: string;
}

function validatePayload(rawBody: string, auth: Parameters<typeof resolveActorAgentId>[0]): SmsPayload {
  const body = ensureObject(parseJsonText(rawBody));

  return {
    customerId: requireString(body.customerId, "customerId", { maxLength: 50 }),
    requestId: requireUuid(body.requestId, "requestId"),
    actorAgentId: resolveActorAgentId(auth, body.agentId),
    overridePhone: optionalString(body.overridePhone, "overridePhone", { maxLength: 50, emptyToNull: true }) ?? null,
    message: requireString(body.message, "message", { maxLength: 1600 }),
  };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.text();
    const payload = validatePayload(rawBody, auth);

    const access = await authorizeCustomerWriteAccess(payload.customerId, auth);
    if (access instanceof NextResponse) return access;

    const existing = await getInteractionByRequestId(payload.requestId);
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    const [customerRows] = await pool.execute<RowDataPacket[]>(
      "SELECT phone_number, country FROM customers WHERE customer_id = ? LIMIT 1",
      [payload.customerId]
    );

    if (!customerRows.length) {
      return jsonError("Customer not found", 404);
    }

    const rawPhone = payload.overridePhone || (customerRows[0].phone_number as string | null);
    if (!rawPhone) {
      return jsonError("Customer has no phone number on record", 422);
    }

    const toNumber = normalizePhone(rawPhone, customerRows[0].country as string | null);
    const alphaPrefixes = ["+44", "+33"];
    const fromSender = alphaPrefixes.some((prefix) => toNumber.startsWith(prefix))
      ? "TASSAPAY"
      : process.env.TWILIO_FROM_NUMBER!;

    let interactionId: number;
    try {
      const [insertResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO interactions (customer_id, agent_id, type, direction, outcome, note, metadata, request_id)
         VALUES (?, ?, 'SMS', 'outbound', 'Queued', ?, ?, ?)`,
        [
          payload.customerId,
          payload.actorAgentId,
          payload.message,
          JSON.stringify({ channel: "sms", to: toNumber, from: fromSender }),
          payload.requestId,
        ]
      );
      interactionId = insertResult.insertId;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ER_DUP_ENTRY") {
        const duplicate = await getInteractionByRequestId(payload.requestId);
        if (duplicate) {
          return NextResponse.json(duplicate, { status: 200 });
        }
      }
      throw err;
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    try {
      const message = await client.messages.create({
        body: payload.message,
        from: fromSender,
        to: toNumber,
      });

      await pool.execute(
        `UPDATE interactions
         SET outcome = 'Delivered', provider_message_id = ?
         WHERE id = ?`,
        [message.sid, interactionId]
      );
    } catch (err) {
      await pool.execute(
        `UPDATE interactions
         SET outcome = 'Failed'
         WHERE id = ?`,
        [interactionId]
      );
      throw err;
    }

    const interaction = await getInteractionById(interactionId);
    if (!interaction) {
      return jsonError("Interaction not found", 500);
    }

    return NextResponse.json(interaction, { status: 201 });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/communicate/sms]", message);
    return jsonError(message, 500);
  }
}

