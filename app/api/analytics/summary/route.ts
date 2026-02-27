import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/analytics/summary
 *
 * Query params (all optional):
 *   ?startDate=  ISO date string  (default: 7 days ago)
 *   ?endDate=    ISO date string  (default: now)
 *
 * Response:
 *   { totalActivities, kycConversions, transferConversions }
 *
 * Note: The schema has no attribution columns, so:
 *   - kycConversions   = customers whose kyc_completion_date falls in range
 *   - transferConversions = distinct customers who made a transfer in range
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const defaultEnd   = new Date();
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 7);

    const startDate = searchParams.get("startDate") ?? defaultStart.toISOString().slice(0, 10);
    const endDate   = searchParams.get("endDate")   ?? defaultEnd.toISOString().slice(0, 10);

    // Include the full endDate day (up to 23:59:59)
    const startStr = `${startDate} 00:00:00`;
    const endStr   = `${endDate} 23:59:59`;

    const [[activities], [kyc], [transfers]] = await Promise.all([
      pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM interactions WHERE created_at BETWEEN ? AND ?`,
        [startStr, endStr]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM customers
         WHERE kyc_completion_date BETWEEN ? AND ?`,
        [startStr, endStr]
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT customer_id) AS total FROM transfers
         WHERE created_at BETWEEN ? AND ?`,
        [startStr, endStr]
      ),
    ]);

    return NextResponse.json({
      totalActivities:      Number((activities[0] as RowDataPacket).total),
      kycConversions:       Number((kyc[0] as RowDataPacket).total),
      transferConversions:  Number((transfers[0] as RowDataPacket).total),
      startDate,
      endDate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/analytics/summary]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
