import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import {
  authorizeCustomerWriteAccess,
  resolveActorAgentId,
} from "@/src/lib/authorization";
import { BeneficiaryIssueEmail } from "@/emails/BeneficiaryIssueEmail";
import { GeneralEmail } from "@/emails/GeneralEmail";
import { jsonError } from "@/src/lib/httpResponses";
import {
  ensureObject,
  optionalInteger,
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

const BENEFICIARY_TEMPLATE_ID = 6;

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM = `${process.env.RESEND_FROM_NAME ?? "TassaPay"} <${process.env.RESEND_FROM_EMAIL ?? "noreply@tassapay.com"}>`;

interface EmailPayload {
  customerId: string;
  requestId: string;
  actorAgentId: number;
  overrideEmail: string | null;
  subject: string;
  message: string;
  templateId: number | null;
  templateData: { transferId?: string; amount?: string } | null;
}

function validatePayload(rawBody: string, auth: Parameters<typeof resolveActorAgentId>[0]): EmailPayload {
  const body = ensureObject(parseJsonText(rawBody));
  const templateDataValue = body.templateData;
  let templateData: { transferId?: string; amount?: string } | null = null;

  if (templateDataValue !== undefined && templateDataValue !== null) {
    const parsedTemplateData = ensureObject(templateDataValue, "templateData");
    templateData = {
      transferId: optionalString(parsedTemplateData.transferId, "templateData.transferId", { maxLength: 100 }) ?? undefined,
      amount: optionalString(parsedTemplateData.amount, "templateData.amount", { maxLength: 100 }) ?? undefined,
    };
  }

  return {
    customerId: requireString(body.customerId, "customerId", { maxLength: 50 }),
    requestId: requireUuid(body.requestId, "requestId"),
    actorAgentId: resolveActorAgentId(auth, body.agentId),
    overrideEmail: optionalString(body.overrideEmail, "overrideEmail", { maxLength: 255, emptyToNull: true }) ?? null,
    subject: requireString(body.subject, "subject", { maxLength: 255 }),
    message: requireString(body.message, "message", { maxLength: 10000 }),
    templateId: optionalInteger(body.templateId, "templateId") ?? null,
    templateData,
  };
}

async function getCustomerEmailContext(customerId: string) {
  const [customerRows] = await pool.execute<RowDataPacket[]>(
    "SELECT email, full_name FROM customers WHERE customer_id = ? LIMIT 1",
    [customerId]
  );

  if (!customerRows.length) {
    return null;
  }

  return {
    email: (customerRows[0].email as string | null) ?? null,
    fullName: (customerRows[0].full_name as string | null) ?? "",
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
      return NextResponse.json(
        { ...existing, messageId: existing.provider_message_id },
        { status: 200 }
      );
    }

    // 2-hour cooldown between outbound messages to the same customer
    const [recentRows] = await pool.execute<RowDataPacket[]>(
      `SELECT created_at FROM interactions
       WHERE customer_id = ? AND type IN ('SMS','Email') AND direction = 'outbound'
       ORDER BY created_at DESC LIMIT 1`,
      [payload.customerId]
    );
    if (recentRows.length > 0) {
      const lastSentAt = new Date(recentRows[0].created_at).getTime();
      const msSince = Date.now() - lastSentAt;
      const cooldownMs = 2 * 60 * 60 * 1000;
      if (msSince < cooldownMs) {
        const minsLeft = Math.ceil((cooldownMs - msSince) / 60000);
        const display = minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`;
        return jsonError(
          `This customer was contacted recently. Please wait ${display} before sending another message.`,
          429
        );
      }
    }

    const customer = await getCustomerEmailContext(payload.customerId);
    if (!customer) {
      return jsonError("Customer not found", 404);
    }

    const email = payload.overrideEmail || customer.email;
    if (!email) {
      return jsonError("Customer has no email address on record", 422);
    }

    const isBeneficiaryTemplate = payload.templateId === BENEFICIARY_TEMPLATE_ID;
    const note = `Subject: ${payload.subject}\n\nBody: ${payload.message}`;
    const metadata = JSON.stringify({
      channel: "email",
      to: email,
      subject: payload.subject,
      templateId: payload.templateId,
    });

    let interactionId: number;
    try {
      const [insertResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO interactions (customer_id, agent_id, type, outcome, note, metadata, request_id)
         VALUES (?, ?, 'Email', 'Queued', ?, ?, ?)`,
        [
          payload.customerId,
          payload.actorAgentId,
          note,
          metadata,
          payload.requestId,
        ]
      );
      interactionId = insertResult.insertId;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ER_DUP_ENTRY") {
        const duplicate = await getInteractionByRequestId(payload.requestId);
        if (duplicate) {
          return NextResponse.json(
            { ...duplicate, messageId: duplicate.provider_message_id },
            { status: 200 }
          );
        }
      }
      throw err;
    }

    const sendPayload = isBeneficiaryTemplate
      ? {
          from: FROM,
          to: [email],
          subject: payload.subject,
          react: BeneficiaryIssueEmail({
            customerName: customer.fullName || "Valued Customer",
            transferId: payload.templateData?.transferId ?? "[Transfer ID]",
            amount: payload.templateData?.amount ?? "[Amount]",
          }),
        }
      : {
          from: FROM,
          to: [email],
          subject: payload.subject,
          react: GeneralEmail({ subject: payload.subject, message: payload.message }),
        };

    const { data, error: sendError } = await resend.emails.send(sendPayload);

    if (sendError) {
      await pool.execute(
        `UPDATE interactions
         SET outcome = 'Failed'
         WHERE id = ?`,
        [interactionId]
      );
      console.error("[POST /api/communicate/email] Resend error:", sendError);
      return jsonError(sendError.message, 502);
    }

    const messageId = data?.id ?? null;

    await pool.execute(
      `UPDATE interactions
       SET outcome = 'Delivered', provider_message_id = ?
       WHERE id = ?`,
      [messageId, interactionId]
    );

    const interaction = await getInteractionById(interactionId);
    if (!interaction) {
      return jsonError("Interaction not found", 500);
    }

    return NextResponse.json({ ...interaction, messageId }, { status: 201 });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/communicate/email]", errMsg);
    return jsonError(errMsg, 500);
  }
}



