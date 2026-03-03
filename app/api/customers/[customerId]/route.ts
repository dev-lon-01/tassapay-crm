import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { getAllowedCountries } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/customers/:customerId
 *
 * Returns the full 360° profile for a single customer:
 *   customer  – all fields from the customers table
 *   timeline  – interaction history joined with the agent's name, newest first
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const auth = requireAuth(_req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { customerId } = params;

    // 1. Customer record
    const [customerRows] = await pool.execute<RowDataPacket[]>(
      `SELECT *,
              (SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) AS total_transfers
       FROM customers WHERE customer_id = ? LIMIT 1`,
      [customerId]
    );

    if (!customerRows.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Region fence: non-Admin users may only view customers in their allowed regions
    if (auth.role !== "Admin") {
      const allowed = getAllowedCountries(auth.allowed_regions ?? ["UK", "EU"]);
      if (!allowed.includes(customerRows[0].country)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // 2. Interaction timeline (joined with agent name)
    const [timeline] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.note,
              i.twilio_call_sid, i.call_duration_seconds, i.recording_url,
              i.created_at, u.name AS agent_name
       FROM   interactions i
       LEFT JOIN users u ON u.id = i.agent_id
       WHERE  i.customer_id = ?
       ORDER BY i.created_at DESC`,
      [customerId]
    );

    return NextResponse.json({
      customer: customerRows[0],
      timeline,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GET /api/customers/${params.customerId}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
