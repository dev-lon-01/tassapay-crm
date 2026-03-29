import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildTransferFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

const VALID_DAYS = new Set([1, 2, 7, 14, 30, 60]);

/**
 * GET /api/dashboard/sla?days=3
 *
 * Returns three pipeline bottleneck metrics for the SLA command-centre bar.
 * Protected: Admin and Manager roles only.
 *
 * Query params:
 *   days  – lookback window: 3 (default) | 7 | 14 | 30 | 60
 *
 * Response:
 *   processedNotPaid            – [{destination_country, count}] – provider side
 *   paymentReceivedNotProcessed – number – internal bottleneck
 *   canceled                    – number – lost revenue
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin" && !auth.can_view_dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const daysParam = Number(searchParams.get("days") ?? "3");
  const days = VALID_DAYS.has(daysParam) ? daysParam : 1;

  try {
    const conn = await pool.getConnection();
    try {
      // Build transfer fence once for this request
      const tFence  = buildTransferFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
      const tAnd    = tFence ? ` AND ${tFence.sql}` : "";
      const tParams = tFence?.params ?? [];

      // Metric 1: Processed but Not Paid - grouped by destination country
      const [processedRows] = await conn.query<RowDataPacket[]>(
        `SELECT destination_country, COUNT(*) AS count
         FROM   transfers
         WHERE  status = 'Processed'
           AND  created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           ${tAnd}
         GROUP  BY destination_country
         ORDER  BY count DESC`,
        [days, ...tParams],
      );

      // Metric 2: Payment Received but Not Processed
      const [[{ count: prnp }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count
         FROM   transfers
         WHERE  payment_status = 'Received'
           AND  status NOT IN ('Completed', 'Deposited', 'Cancel')
           AND  created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           ${tAnd}`,
        [days, ...tParams],
      );

      // Metric 3: Canceled Transactions
      const [[{ count: canceled }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count
         FROM   transfers
         WHERE  status = 'Cancel'
           AND  created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           ${tAnd}`,
        [days, ...tParams],
      );

      return NextResponse.json({
        processedNotPaid: processedRows.map((r) => ({
          destination_country: r.destination_country as string,
          count: Number(r.count),
        })),
        paymentReceivedNotProcessed: Number(prnp),
        canceled: Number(canceled),
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/dashboard/sla]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
