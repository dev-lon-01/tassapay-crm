import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence, getAllowedCountries } from "@/src/lib/regionFence";
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

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const stage = searchParams.get("stage");
  const country = searchParams.get("country");
  const assignedAgent = searchParams.get("assigned_agent");
  const search = searchParams.get("search");
  const labelsParam = searchParams.get("labels");
  const showDead = searchParams.get("show_dead") === "1";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const offset = (page - 1) * limit;

  const conditions: string[] = ["is_lead = 1"];
  const params: (string | number)[] = [];

  if (stage && stage !== "all") {
    if (stage === "New") {
      conditions.push("(lead_stage IS NULL OR lead_stage = 'New')");
    } else {
      conditions.push("lead_stage = ?");
      params.push(stage);
    }
  } else if (!showDead) {
    conditions.push("(lead_stage IS NULL OR lead_stage != 'Dead')");
  }

  if (country) {
    conditions.push("country = ?");
    params.push(country);
  }

  if (assignedAgent && assignedAgent !== "all") {
    conditions.push("assigned_agent_id = ?");
    params.push(Number(assignedAgent));
  }

  if (search) {
    conditions.push("(full_name LIKE ? OR phone_number LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (labelsParam) {
    const labels = labelsParam.split(",").map((label) => label.trim()).filter(Boolean);
    if (labels.length > 0) {
      const labelConditions = labels.map(() => "JSON_CONTAINS(labels, JSON_QUOTE(?))");
      conditions.push(`(${labelConditions.join(" OR ")})`);
      params.push(...labels);
    }
  }

  const fence = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
  if (fence) {
    conditions.push(fence.sql);
    params.push(...fence.params);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [[{ total }]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM customers c ${where}`,
      params
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.customer_id, c.full_name, c.phone_number, c.email, c.country,
              c.is_lead, c.lead_stage, c.assigned_agent_id, c.labels, c.created_at,
              u.name AS assigned_agent_name
       FROM   customers c
       LEFT JOIN users u ON u.id = c.assigned_agent_id
       ${where}
       ORDER BY
         FIELD(c.lead_stage, 'New', 'Contacted', 'Follow-up', 'Converted', 'Dead'),
         c.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return NextResponse.json({
      data: rows,
      total: Number(total),
      page,
      limit,
      pages: Math.ceil(Number(total) / limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/leads]", message);
    return jsonError(message, 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = ensureObject(parseJsonText(await req.text()));
    const name = requireString(body.name, "name", { maxLength: 255 });
    const phone = requireString(body.phone, "phone", { maxLength: 50 });
    const country = requireString(body.country, "country", { maxLength: 100 });
    const email = optionalString(body.email, "email", { maxLength: 255, emptyToNull: true }) ?? null;
    const assignedAgentId = optionalInteger(body.assigned_agent_id, "assigned_agent_id") ?? null;
    const labels = optionalStringArray(body.labels, "labels") ?? [];

    if (auth.role !== "Admin") {
      const allowedCountries = getAllowedCountries(auth.allowed_regions ?? ["UK", "EU"]);
      if (!allowedCountries.includes(country)) {
        return jsonError("Forbidden", 403);
      }
    }

    const phoneNormalized = normalizePhoneValue(phone);
    const phoneLast9 = getPhoneLast9(phone);
    if (!phoneNormalized || !phoneLast9) {
      return jsonError("Phone is required", 400);
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id, is_lead, full_name
       FROM   customers
       WHERE  phone_normalized = ?
          OR  phone_last9 = ?
          OR  REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
          OR  RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
       LIMIT 1`,
      [phoneNormalized, phoneLast9, phoneNormalized, phoneLast9]
    );

    if (existing.length > 0) {
      const rec = existing[0] as RowDataPacket;
      const msg = rec.is_lead
        ? `This phone number is already registered to a lead: ${rec.full_name ?? rec.customer_id}.`
        : `This phone number is already registered to a customer: ${rec.full_name ?? rec.customer_id}.`;
      return jsonError(msg, 409);
    }

    const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const rnd = Math.floor(Math.random() * 9000 + 1000);
    const customerId = `LEAD-${ts}-${rnd}`;

    await pool.execute(
      `INSERT INTO customers
         (customer_id, full_name, phone_number, phone_normalized, phone_last9, email, country,
          assigned_agent_id, is_lead, lead_stage, labels, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'New', ?, NOW(), NOW())`,
      [
        customerId,
        name,
        phone.trim(),
        phoneNormalized,
        phoneLast9,
        email,
        country,
        assignedAgentId,
        labels.length > 0 ? JSON.stringify(labels) : null,
      ]
    );

    const [[lead]] = await pool.execute<RowDataPacket[]>(
      `SELECT c.customer_id, c.full_name, c.phone_number, c.email, c.country,
              c.is_lead, c.lead_stage, c.assigned_agent_id, c.labels, c.created_at,
              u.name AS assigned_agent_name
       FROM   customers c
       LEFT JOIN users u ON u.id = c.assigned_agent_id
       WHERE  c.customer_id = ?`,
      [customerId]
    );

    return NextResponse.json(lead, { status: 201 });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/leads]", message);
    return jsonError(message, 500);
  }
}

