import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { authorizeLeadWriteAccess } from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";
import { getPhoneLast9, normalizePhoneValue } from "@/src/lib/phoneUtils";
import {
  ensureObject,
  optionalInteger,
  optionalString,
  optionalStringArray,
  parseJsonText,
  RequestValidationError,
  requireString,
} from "@/src/lib/requestValidation";
import type { RowDataPacket } from "mysql2";

const VALID_STAGES = ["New", "Contacted", "Follow-up", "Converted", "Dead"] as const;

async function fetchLead(customerId: string) {
  const [[lead]] = await pool.execute<RowDataPacket[]>(
    `SELECT c.customer_id, c.full_name, c.phone_number, c.email, c.country,
            c.is_lead, c.lead_stage, c.assigned_agent_id, c.labels, c.created_at,
            u.name AS assigned_agent_name
     FROM   customers c
     LEFT JOIN users u ON u.id = c.assigned_agent_id
     WHERE  c.customer_id = ?`,
    [customerId]
  );
  return lead ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const access = await authorizeLeadWriteAccess(params.customerId, auth);
    if (access instanceof NextResponse) return access;

    const body = ensureObject(parseJsonText(await req.text()));
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.lead_stage !== undefined) {
      const leadStage = requireString(body.lead_stage, "lead_stage", { maxLength: 50 });
      if (!VALID_STAGES.includes(leadStage as (typeof VALID_STAGES)[number])) {
        return jsonError("Invalid lead_stage", 400);
      }
      sets.push("lead_stage = ?");
      values.push(leadStage);
    }

    if (body.assigned_agent_id !== undefined) {
      sets.push("assigned_agent_id = ?");
      values.push(optionalInteger(body.assigned_agent_id, "assigned_agent_id") ?? null);
    }

    if (body.labels !== undefined) {
      const labels = optionalStringArray(body.labels, "labels") ?? [];
      sets.push("labels = ?");
      values.push(labels.length > 0 ? JSON.stringify(labels) : null);
    }

    if (sets.length === 0) {
      return jsonError("Nothing to update", 400);
    }

    values.push(params.customerId);

    const [result] = await pool.execute(
      `UPDATE customers SET ${sets.join(", ")} WHERE customer_id = ? AND is_lead = 1`,
      values
    );

    const affectedRows = (result as { affectedRows: number }).affectedRows;
    if (affectedRows === 0) {
      return jsonError("Lead not found", 404);
    }

    return NextResponse.json(await fetchLead(params.customerId));
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PATCH /api/leads/${params.customerId}]`, message);
    return jsonError(message, 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const access = await authorizeLeadWriteAccess(params.customerId, auth);
    if (access instanceof NextResponse) return access;

    const body = ensureObject(parseJsonText(await req.text()));
    const name = requireString(body.name, "name", { maxLength: 255 });
    const phone = requireString(body.phone, "phone", { maxLength: 50 });
    const country = requireString(body.country, "country", { maxLength: 100 });
    const email = optionalString(body.email, "email", { maxLength: 255, emptyToNull: true }) ?? null;
    const assignedAgentId = optionalInteger(body.assigned_agent_id, "assigned_agent_id") ?? null;
    const labels = optionalStringArray(body.labels, "labels") ?? [];

    const phoneNormalized = normalizePhoneValue(phone);
    const phoneLast9 = getPhoneLast9(phone);
    if (!phoneNormalized || !phoneLast9) {
      return jsonError("Phone is required", 400);
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id, is_lead, full_name
       FROM   customers
       WHERE  customer_id != ?
         AND (
              phone_normalized = ?
           OR phone_last9 = ?
           OR REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
           OR RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
         )
       LIMIT 1`,
      [params.customerId, phoneNormalized, phoneLast9, phoneNormalized, phoneLast9]
    );

    if (existing.length > 0) {
      const rec = existing[0] as RowDataPacket;
      const msg = rec.is_lead
        ? `This phone is already registered to a lead: ${rec.full_name ?? rec.customer_id}.`
        : `This phone is already registered to a customer: ${rec.full_name ?? rec.customer_id}.`;
      return jsonError(msg, 409);
    }

    await pool.execute(
      `UPDATE customers
       SET    full_name = ?,
              phone_number = ?,
              phone_normalized = ?,
              phone_last9 = ?,
              email = ?,
              country = ?,
              assigned_agent_id = ?,
              labels = ?
       WHERE  customer_id = ? AND is_lead = 1`,
      [
        name,
        phone.trim(),
        phoneNormalized,
        phoneLast9,
        email,
        country,
        assignedAgentId,
        labels.length > 0 ? JSON.stringify(labels) : null,
        params.customerId,
      ]
    );

    return NextResponse.json(await fetchLead(params.customerId));
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PUT /api/leads/${params.customerId}]`, message);
    return jsonError(message, 500);
  }
}

