import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/transfers/:customerId
 *
 * Returns all transfers for a customer, newest first.
 *
 * Query params:
 *   ?page=1        (default 1)
 *   ?limit=20      (default 20, max 100)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { customerId } = params;

    const { searchParams } = new URL(req.url);
    const page  = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const offset = (page - 1) * limit;

    // Total count
    const [countRows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM transfers WHERE customer_id = ?",
      [customerId]
    );
    const total = (countRows[0] as RowDataPacket).total as number;

    // Transfers page
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, transaction_ref, created_at,
              send_amount, send_currency,
              receive_amount, receive_currency,
              destination_country, beneficiary_name,
              status, hold_reason,
              payment_method, delivery_method
       FROM   transfers
       WHERE  customer_id = ?
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [customerId]
    );

    return NextResponse.json({
      data:  rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GET /api/transfers/${params.customerId}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
