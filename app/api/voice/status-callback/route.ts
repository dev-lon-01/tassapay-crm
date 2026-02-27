import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { pool } from "@/src/lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/voice/status-callback
 *
 * Webhook called by Twilio when a call ends (action URL from <Dial>) and when a
 * recording becomes available (recordingStatusCallback).
 *
 * Handles two cases:
 *  1. Missed inbound call (DialCallStatus = no-answer | busy | failed) →
 *     INSERT "Missed Inbound Call" interaction row
 *  2. Recording ready (RecordingUrl present) →
 *     UPDATE existing interaction SET recording_url WHERE twilio_call_sid
 */
export async function POST(req: NextRequest) {
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text).entries()) {
    params[k] = v;
  }

  // Validate Twilio signature
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const baseUrl   = process.env.APP_BASE_URL!;
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url       = `${baseUrl}/api/voice/status-callback`;

  const isDev = process.env.NODE_ENV === "development";
  const isValid = isDev || twilio.validateRequest(authToken, signature, url, params);
  if (!isValid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const callSid        = params["CallSid"]        ?? params["ParentCallSid"] ?? "";
  const recordingUrl   = params["RecordingUrl"]   ?? "";

  // ── Case 1: Recording ready ─────────────────────────────────────────────────
  if (recordingUrl) {
    const finalUrl = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
    await pool.execute<ResultSetHeader>(
      `UPDATE interactions SET recording_url = ? WHERE twilio_call_sid = ?`,
      [finalUrl, callSid]
    ).catch((err: unknown) => {
      console.error("[status-callback] recording update failed", err);
    });
    return new NextResponse(null, { status: 204 });
  }

  // ── Case 2: Missed inbound call ─────────────────────────────────────────────
  const dialStatus  = params["DialCallStatus"] ?? params["CallStatus"] ?? "";
  const direction   = params["Direction"]      ?? "";
  const fromNumber  = params["From"]           ?? params["Called"]    ?? "";

  const isMissed =
    direction === "inbound" &&
    (dialStatus === "no-answer" || dialStatus === "busy" || dialStatus === "failed");

  if (isMissed && fromNumber) {
    // Try to look up customer by phone number
    let customerId: string | null = null;
    const normalized = fromNumber.replace(/\s/g, "");
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id FROM customers
       WHERE  REPLACE(phone_number, ' ', '') = ?
          OR  REPLACE(phone_number, ' ', '') = ?
       LIMIT 1`,
      [normalized, normalized.replace(/^\+/, "")]
    ).catch(() => [[]]);

    if (Array.isArray(rows) && rows.length > 0) {
      customerId = (rows as RowDataPacket[])[0].customer_id as string;
    }

    if (customerId) {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO interactions
           (customer_id, agent_id, type, outcome, note, twilio_call_sid)
         VALUES (?, NULL, 'Call', 'Missed Inbound Call', ?, ?)`,
        [
          customerId,
          `Inbound from ${fromNumber} — not answered`,
          callSid || null,
        ]
      ).catch((err: unknown) => {
        console.error("[status-callback] missed call insert failed", err);
      });
    }
  }

  return new NextResponse(null, { status: 204 });
}
