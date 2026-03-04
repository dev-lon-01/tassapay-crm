import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/webhooks/sms
 *
 * Receives incoming SMS from Twilio (application/x-www-form-urlencoded).
 * Matches the sender against customers.phone_number and logs to interactions.
 *
 * IMPORTANT: Must return 200 + <Response></Response> or Twilio fires Error 12300.
 * No auth guard — this is a Twilio webhook, not a browser request.
 */
export async function POST(req: NextRequest) {
  const XML_EMPTY = "<Response></Response>";
  const xmlHeaders = { "Content-Type": "text/xml" };

  try {
    const form = await req.formData();
    const from = (form.get("From") as string | null) ?? "";
    const body = (form.get("Body") as string | null) ?? "";

    // Normalize phone for DB lookup — same logic as voice status-callback
    const normalized = from.replace(/[\s\-+]/g, "");
    const last9 = normalized.slice(-9);

    const [customerRows] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id FROM customers
       WHERE REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
          OR RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
       LIMIT 1`,
      [normalized, last9],
    );

    const customerId: string | null =
      customerRows.length > 0 ? (customerRows[0].customer_id as string) : null;

    await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions (customer_id, agent_id, type, direction, note, metadata)
       VALUES (?, NULL, 'SMS', 'inbound', ?, ?)`,
      [customerId, body || null, JSON.stringify({ from })],
    );

    console.log(
      `[POST /api/webhooks/sms] from=${from} customerId=${customerId ?? "unknown"} body="${body.slice(0, 80)}"`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/webhooks/sms]", msg);
    // Always return 200 + empty <Response> so Twilio does not retry or log Error 12300
  }

  return new NextResponse(XML_EMPTY, { status: 200, headers: xmlHeaders });
}
