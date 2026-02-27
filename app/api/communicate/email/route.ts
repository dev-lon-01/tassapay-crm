import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/communicate/email
 *
 * Payload: { customerId, agentId?, subject, message }
 *
 * 1. Look up customer email from DB
 * 2. Send transactional email via SendGrid
 * 3. INSERT interaction (type='Email', outcome='Delivered', note='Subject: …\n\nBody: …')
 * 4. Return the new interaction row (for immediate timeline update)
 */

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { customerId, agentId = null, overrideEmail, subject, message } = body as {
      customerId: string;
      agentId?: number | null;
      overrideEmail?: string;
      subject: string;
      message: string;
    };

    if (!customerId || !subject?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: "customerId, subject, and message are required" },
        { status: 400 }
      );
    }

    // ── 1. Fetch customer email ──────────────────────────────────────────────
    const [customerRows] = await pool.execute<RowDataPacket[]>(
      "SELECT email, full_name FROM customers WHERE customer_id = ? LIMIT 1",
      [customerId]
    );

    if (!customerRows.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const email = overrideEmail?.trim() || (customerRows[0].email as string | null);

    if (!email) {
      return NextResponse.json(
        { error: "Customer has no email address on record" },
        { status: 422 }
      );
    }

    const fullName = (customerRows[0].full_name as string | null) ?? "";

    // ── 2. Send via SendGrid ──────────────────────────────────────────────
    const htmlBody = `<p style="font-family:sans-serif;white-space:pre-wrap;line-height:1.6">${message
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>")}</p>`;

    await sgMail.send({
      to: { email, name: fullName },
      from: {
        email: process.env.SENDGRID_FROM_EMAIL!,
        name: process.env.SENDGRID_FROM_NAME ?? "TassaPay",
      },
      subject: subject.trim(),
      text: message.trim(),
      html: htmlBody,
    });

    // ── 3. Log interaction ───────────────────────────────────────────────────
    const note = `Subject: ${subject.trim()}\n\nBody: ${message.trim()}`;

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO interactions (customer_id, agent_id, type, outcome, note)
       VALUES (?, ?, 'Email', 'Delivered', ?)`,
      [customerId, agentId, note]
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
    console.error("[POST /api/communicate/email]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
