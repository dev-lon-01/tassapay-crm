import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { jsonError, xmlResponse } from "@/src/lib/httpResponses";
import {
  buildExpectedWebhookUrl,
  findCustomerIdByPhone,
  parseTwilioFormBody,
  validateTwilioWebhook,
} from "@/src/lib/voiceCallState";
import type { ResultSetHeader } from "mysql2";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const params = parseTwilioFormBody(rawBody);
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const expectedUrl = buildExpectedWebhookUrl(`${req.nextUrl.pathname}${req.nextUrl.search}`);

    if (!validateTwilioWebhook(signature, expectedUrl, params)) {
      return jsonError("Forbidden", 403);
    }

    const from = params.From ?? "";
    const body = params.Body ?? "";
    const customerId = await findCustomerIdByPhone(from);

    await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions (customer_id, agent_id, type, direction, note, metadata)
       VALUES (?, NULL, 'SMS', 'inbound', ?, ?)`,
      [
        customerId,
        body || null,
        JSON.stringify({
          from: from || null,
          messageSid: params.MessageSid ?? null,
          smsStatus: params.SmsStatus ?? null,
          accountSid: params.AccountSid ?? null,
        }),
      ]
    );

    console.log(
      `[POST /api/webhooks/sms] from=${from} customerId=${customerId ?? "unknown"} body="${body.slice(0, 80)}"`
    );

    return xmlResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/webhooks/sms]", message);
    return xmlResponse(undefined, 500);
  }
}

