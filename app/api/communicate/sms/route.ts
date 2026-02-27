import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { pool } from "@/src/lib/db";
import { normalizePhone } from "@/src/lib/phoneUtils";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/communicate/sms
 *
 * Payload: { customerId, agentId?, message }
 *
 * 1. Look up customer phone_number from DB
 * 2. Send SMS via Twilio
 * 3. INSERT interaction (type='SMS', outcome='Delivered', note=message)
 * 4. Return the new interaction row (for immediate timeline update)
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { customerId, agentId = null, overridePhone, message } = body as {
      customerId: string;
      agentId?: number | null;
      overridePhone?: string;
      message: string;
    };

    if (!customerId || !message?.trim()) {
      return NextResponse.json(
        { error: "customerId and message are required" },
        { status: 400 }
      );
    }

    // ── 1. Fetch customer phone ──────────────────────────────────────────────
    const [customerRows] = await pool.execute<RowDataPacket[]>(
      "SELECT phone_number, country, full_name FROM customers WHERE customer_id = ? LIMIT 1",
      [customerId]
    );

    if (!customerRows.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const rawPhone = overridePhone?.trim() || (customerRows[0].phone_number as string | null);

    if (!rawPhone) {
      return NextResponse.json(
        { error: "Customer has no phone number on record" },
        { status: 422 }
      );
    }

    // Normalise to E.164 using country-aware dial code lookup
    const toNumber = normalizePhone(rawPhone, customerRows[0].country as string | null);

    // ── 2. Send via Twilio ───────────────────────────────────────────────────
    // UK and France support alphanumeric sender IDs; all other countries use
    // the registered Twilio phone number.
    const ALPHA_PREFIXES = ["+44", "+33"];
    const fromSender = ALPHA_PREFIXES.some((p) => toNumber.startsWith(p))
      ? "TASSAPAY"
      : process.env.TWILIO_FROM_NUMBER!;

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    await client.messages.create({
      body: message.trim(),
      from: fromSender,
      to: toNumber,
    });

    // ── 3. Log interaction ───────────────────────────────────────────────────
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions (customer_id, agent_id, type, outcome, note)
       VALUES (?, ?, 'SMS', 'Delivered', ?)`,
      [customerId, agentId, message.trim()]
    );

    const [interactionRows] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.note,
              i.created_at, u.name AS agent_name
       FROM   interactions i
       LEFT JOIN users u ON u.id = i.agent_id
       WHERE  i.id = ?`,
      [result.insertId]
    );

    return NextResponse.json(interactionRows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/communicate/sms]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
