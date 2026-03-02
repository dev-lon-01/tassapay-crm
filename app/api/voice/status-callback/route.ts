import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { pool } from "@/src/lib/db";

const { VoiceResponse } = twilio.twiml;
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/** Extract E.164 from sip:+447...@domain or a plain +447... string */
function extractE164FromSip(uri: string): string | null {
  if (uri.startsWith("+")) return uri;
  const match = uri.match(/sip:(\+[0-9]+)@/);
  return match ? match[1] : null;
}

/** Extract the SIP username portion from sip:abdi@domain */
function extractSipUsername(uri: string): string | null {
  const match = uri.match(/^sip:([^@;]+)@/);
  return match ? match[1] : null;
}

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

  const callSid      = params["CallSid"]      ?? params["ParentCallSid"] ?? "";
  const recordingUrl = params["RecordingUrl"] ?? "";

  // ── Case 1: Recording ready ─────────────────────────────────────────────────
  if (recordingUrl) {
    const finalUrl = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
    await pool.execute<ResultSetHeader>(
      `UPDATE interactions SET recording_url = ? WHERE twilio_call_sid = ?`,
      [finalUrl, callSid]
    ).catch((err: unknown) => {
      console.error("[status-callback] recording update failed", err);
    });
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  // ── Case 2 & 3: Inbound call completed (missed or answered) ─────────────────
  const dialStatus  = params["DialCallStatus"] ?? params["CallStatus"] ?? "";
  const direction   = params["Direction"]      ?? "";
  const fromNumber  = params["From"]           ?? params["Called"]    ?? "";
  const toParam     = params["To"]             ?? "";

  // Guard: agent-initiated calls (browser WebRTC = "client:", Zoiper SIP = "sip:")
  // must never trigger inbound voicemail / missed-call logic.
  const isFromAgent = fromNumber.startsWith("client:") || fromNumber.startsWith("sip:");

  // ── Zoiper (SIP) outbound call completed ──────────────────────────────────
  // Twilio fires the action callback with From=sip:agent@domain, To=sip:+E164@domain.
  if (fromNumber.startsWith("sip:") && (dialStatus === "completed" || dialStatus === "no-answer" || dialStatus === "busy" || dialStatus === "failed")) {
    const dialedNumber = extractE164FromSip(toParam);
    const sipUsername  = extractSipUsername(fromNumber);
    const duration     = parseInt(params["DialCallDuration"] ?? params["CallDuration"] ?? "0", 10) || 0;

    if (dialedNumber && sipUsername) {
      // Look up agent by sip_username
      const [agentRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM users WHERE sip_username = ? LIMIT 1",
        [sipUsername]
      ).catch(() => [[]] as [RowDataPacket[]]);
      const agentId = Array.isArray(agentRows) && agentRows.length > 0
        ? (agentRows as RowDataPacket[])[0].id as number
        : null;

      // Look up customer by the dialed phone number
      const normalizedDial = dialedNumber.replace(/\s/g, "");
      const [custRows] = await pool.execute<RowDataPacket[]>(
        `SELECT customer_id FROM customers
         WHERE  REPLACE(phone_number, ' ', '') = ?
            OR  REPLACE(phone_number, ' ', '') = ?
         LIMIT 1`,
        [normalizedDial, normalizedDial.replace(/^\+/, "")]
      ).catch(() => [[]] as [RowDataPacket[]]);
      const customerId = Array.isArray(custRows) && custRows.length > 0
        ? (custRows as RowDataPacket[])[0].customer_id as string
        : null;

      if (customerId) {
        const outcomeLabel = dialStatus === "completed" ? "Outbound Call" : `Outbound Call — ${dialStatus}`;
        await pool.execute<ResultSetHeader>(
          `INSERT INTO interactions
             (customer_id, agent_id, type, outcome, note, twilio_call_sid, call_duration_seconds)
           VALUES (?, ?, 'Call', ?, ?, ?, ?)`,
          [
            customerId,
            agentId,
            outcomeLabel,
            `Outbound to ${dialedNumber} via Zoiper`,
            callSid || null,
            duration || null,
          ]
        ).catch((err: unknown) => {
          console.error("[status-callback] Zoiper outbound insert failed", err);
        });
      }
    }
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const isMissed   = !isFromAgent && direction === "inbound" &&
    (dialStatus === "no-answer" || dialStatus === "busy" || dialStatus === "failed");
  const isAnswered = !isFromAgent && direction === "inbound" && dialStatus === "completed";

  if ((isMissed || isAnswered) && fromNumber) {
    // Look up customer by phone number (shared by both branches)
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

    if (isAnswered) {
      // Answered call — log interaction now; RecordingUrl UPDATE will follow separately
      const duration = parseInt(params["DialCallDuration"] ?? params["CallDuration"] ?? "0", 10) || null;
      if (customerId) {
        await pool.execute<ResultSetHeader>(
          `INSERT INTO interactions
             (customer_id, agent_id, type, outcome, note, twilio_call_sid, call_duration_seconds)
           VALUES (?, NULL, 'Call', 'Inbound Call', ?, ?, ?)`,
          [
            customerId,
            `Inbound from ${fromNumber} — answered`,
            callSid || null,
            duration,
          ]
        ).catch((err: unknown) => {
          console.error("[status-callback] answered call insert failed", err);
        });
      }
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Missed call — log interaction and offer voicemail
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

    // Offer voicemail — Twilio will POST RecordingUrl back here when ready
    const voicemailTwiml = new VoiceResponse();
    voicemailTwiml.say(
      { voice: "alice" },
      "Sorry we missed your call. Please leave a message after the tone and press hash when done."
    );
    voicemailTwiml.record({
      maxLength: 120,
      finishOnKey: "#",
      recordingStatusCallback: `${baseUrl}/api/voice/status-callback`,
      recordingStatusCallbackMethod: "POST",
      transcribe: false,
    });
    voicemailTwiml.say({ voice: "alice" }, "We did not receive a recording. Goodbye.");
    voicemailTwiml.hangup();
    return new NextResponse(voicemailTwiml.toString(), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
