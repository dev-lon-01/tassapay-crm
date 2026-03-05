import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/leads
 *
 * Returns leads (customers where is_lead = 1).
 * Query params:
 *   ?stage=          – lead_stage value (or 'all')
 *   ?country=        – exact country match
 *   ?assigned_agent= – agent id (int), or 'all'
 *   ?search=         – LIKE on full_name or phone_number
 *   ?labels=         – comma-separated labels to filter by (JSON_CONTAINS)
 *   ?show_dead=      – '1' to include Dead stage
 *
 * POST /api/leads
 *
 * Creates a new lead record.
 * Body: { name, phone, country, assigned_agent_id }
 */

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const stage          = searchParams.get("stage");
  const country        = searchParams.get("country");
  const assignedAgent  = searchParams.get("assigned_agent");
  const search         = searchParams.get("search");
  const labelsParam    = searchParams.get("labels");
  const showDead       = searchParams.get("show_dead") === "1";

  const conditions: string[] = ["is_lead = 1"];
  const params: (string | number)[] = [];

  if (stage && stage !== "all") {
    conditions.push("lead_stage = ?");
    params.push(stage);
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
    const labels = labelsParam.split(",").map((l) => l.trim()).filter(Boolean);
    if (labels.length > 0) {
      const labelConditions = labels.map(() => "JSON_CONTAINS(labels, JSON_QUOTE(?))");
      conditions.push(`(${labelConditions.join(" OR ")})`);
      params.push(...labels);
    }
  }

  // Region fence for non-admins
  const fence = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
  if (fence) {
    conditions.push(fence.sql);
    params.push(...fence.params);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.customer_id, c.full_name, c.phone_number, c.email, c.country,
              c.is_lead, c.lead_stage, c.assigned_agent_id, c.labels, c.created_at,
              u.name AS assigned_agent_name
       FROM   customers c
       LEFT JOIN users u ON u.id = c.assigned_agent_id
       ${where}
       ORDER BY
         FIELD(c.lead_stage, 'New', 'Contacted', 'Follow-up', 'Converted', 'Dead'),
         c.created_at DESC`,
      params
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/leads]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: { name?: string; phone?: string; country?: string; assigned_agent_id?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, phone, country, assigned_agent_id } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!phone?.trim()) return NextResponse.json({ error: "Phone is required" }, { status: 400 });
  if (!country?.trim()) return NextResponse.json({ error: "Country is required" }, { status: 400 });

  // Normalize phone for duplicate check
  const phoneNorm = phone.replace(/[\s\-]/g, "");
  const phoneNoPlus = phoneNorm.replace("+", "");
  const phoneLast9 = phoneNoPlus.slice(-9);

  try {
    // Duplicate phone check
    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id, is_lead, full_name
       FROM   customers
       WHERE  REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
          OR  RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
       LIMIT 1`,
      [phoneNoPlus, phoneLast9]
    );

    if (existing.length > 0) {
      const rec = existing[0] as RowDataPacket;
      const msg = rec.is_lead
        ? `This phone number is already registered to a lead: ${rec.full_name ?? rec.customer_id}.`
        : `This phone number is already registered to a customer: ${rec.full_name ?? rec.customer_id}.`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    // Generate a unique customer_id for the new lead
    const ts  = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const rnd = Math.floor(Math.random() * 9000 + 1000);
    const customerId = `LEAD-${ts}-${rnd}`;

    await pool.execute(
      `INSERT INTO customers
         (customer_id, full_name, phone_number, country, assigned_agent_id, is_lead, lead_stage, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, 1, 'New', NOW(), NOW())`,
      [customerId, name.trim(), phoneNorm, country.trim(), assigned_agent_id ?? null]
    );

    // Fetch the created record
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
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/leads]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
