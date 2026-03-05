import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * PATCH /api/leads/[customerId]
 *
 * Updates mutable lead fields.
 * Body (all optional):
 *   { lead_stage, assigned_agent_id, labels }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: {
    lead_stage?: string;
    assigned_agent_id?: number | null;
    labels?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { customerId } = params;
  const VALID_STAGES = ["New", "Contacted", "Follow-up", "Converted", "Dead"];

  const sets: string[] = [];
  const values: (string | number | string[] | null)[] = [];

  if (body.lead_stage !== undefined) {
    if (!VALID_STAGES.includes(body.lead_stage)) {
      return NextResponse.json({ error: "Invalid lead_stage" }, { status: 400 });
    }
    sets.push("lead_stage = ?");
    values.push(body.lead_stage);
  }

  if (body.assigned_agent_id !== undefined) {
    sets.push("assigned_agent_id = ?");
    values.push(body.assigned_agent_id ?? null);
  }

  if (body.labels !== undefined) {
    sets.push("labels = ?");
    values.push(Array.isArray(body.labels) ? JSON.stringify(body.labels) : null);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  values.push(customerId);

  try {
    const [result] = await pool.execute(
      `UPDATE customers SET ${sets.join(", ")} WHERE customer_id = ? AND is_lead = 1`,
      values
    );

    const affectedRows = (result as { affectedRows: number }).affectedRows;
    if (affectedRows === 0) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Return the updated record
    const [[lead]] = await pool.execute<RowDataPacket[]>(
      `SELECT c.customer_id, c.full_name, c.phone_number, c.email, c.country,
              c.is_lead, c.lead_stage, c.assigned_agent_id, c.labels, c.created_at,
              u.name AS assigned_agent_name
       FROM   customers c
       LEFT JOIN users u ON u.id = c.assigned_agent_id
       WHERE  c.customer_id = ?`,
      [customerId]
    );

    return NextResponse.json(lead);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PATCH /api/leads/${customerId}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
