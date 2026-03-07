import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { authorizeCustomerWriteAccess } from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";
import type { RowDataPacket } from "mysql2";

export async function GET(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const access = await authorizeCustomerWriteAccess(params.customerId, auth);
    if (access instanceof NextResponse) return access;

    const [customerRows] = await pool.execute<RowDataPacket[]>(
      `SELECT *,
              (SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) AS total_transfers
       FROM customers WHERE customer_id = ? LIMIT 1`,
      [params.customerId]
    );

    if (!customerRows.length) {
      return jsonError("Customer not found", 404);
    }

    const [timeline] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.customer_id, i.agent_id, i.type, i.outcome, i.call_status, i.note,
              i.direction, i.metadata,
              i.twilio_call_sid, i.call_duration_seconds, i.recording_url,
              i.created_at, u.name AS agent_name
       FROM   interactions i
       LEFT JOIN users u ON u.id = i.agent_id
       WHERE  i.customer_id = ?
       ORDER BY i.created_at DESC`,
      [params.customerId]
    );

    return NextResponse.json({
      customer: customerRows[0],
      timeline,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GET /api/customers/${params.customerId}]`, message);
    return jsonError(message, 500);
  }
}

