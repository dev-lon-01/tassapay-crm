import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { BeneficiaryIssueEmail } from "@/emails/BeneficiaryIssueEmail";
import { GeneralEmail } from "@/emails/GeneralEmail";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/communicate/email
 *
 * Payload: { customerId, agentId?, overrideEmail?, subject, message,
 *            templateId?, templateData? }
 *
 * 1. Look up customer email from DB
 * 2. Send transactional email via Resend
 *    – templateId === 6 ("Beneficiary Information Update Required"):
 *        renders BeneficiaryIssueEmail React component with templateData
 *    – all other templates: wraps message in safe HTML
 * 3. INSERT interaction (type='Email', outcome='Delivered', note='Subject: …\n\nBody: …')
 * 4. Return the new interaction row + Resend message id
 */

// Template id: 6 = "Beneficiary Information Update Required"
const BENEFICIARY_TEMPLATE_ID = 6;

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM = `${process.env.RESEND_FROM_NAME ?? "TassaPay"} <${process.env.RESEND_FROM_EMAIL ?? "noreply@tassapay.com"}>`;

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const {
      customerId,
      agentId = null,
      overrideEmail,
      subject,
      message,
      templateId,
      templateData,
    } = body as {
      customerId: string;
      agentId?: number | null;
      overrideEmail?: string;
      subject: string;
      message: string;
      templateId?: number;
      templateData?: { transferId?: string; amount?: string };
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

    // ── 2. Send via Resend ───────────────────────────────────────────────────
    const isBeneficiaryTemplate = templateId === BENEFICIARY_TEMPLATE_ID;

    const sendPayload = isBeneficiaryTemplate
      ? {
          from: FROM,
          to: [email],
          subject: subject.trim(),
          react: BeneficiaryIssueEmail({
            customerName: fullName || "Valued Customer",
            transferId: templateData?.transferId ?? "[Transfer ID]",
            amount: templateData?.amount ?? "[Amount]",
          }),
        }
      : {
          from: FROM,
          to: [email],
          subject: subject.trim(),
          react: GeneralEmail({ subject: subject.trim(), message: message.trim() }),
        };

    const { data, error: sendError } = await resend.emails.send(sendPayload);

    if (sendError) {
      console.error("[POST /api/communicate/email] Resend error:", sendError);
      return NextResponse.json({ error: sendError.message }, { status: 502 });
    }

    const messageId = data?.id ?? null;

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

    return NextResponse.json({ ...interactionRows[0], messageId }, { status: 201 });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/communicate/email]", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
