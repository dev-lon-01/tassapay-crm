import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildTransferFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

const VALID_DAYS = new Set([3, 7, 14, 30, 60]);

/**
 * GET /api/dashboard/stats?days=3
 *
 * Returns transfer volume broken down by:
 *   byCurrency    – send_currency, total_transfers, total_revenue
 *   byDestination – destination_country, total_transfers, total_revenue
 *
 * Respects agent allowed_regions RLS fence and ?days= lookback window.
 * Protected: Admin and Manager roles only.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin" && !auth.can_view_dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const daysParam = Number(searchParams.get("days") ?? "3");
  const days = VALID_DAYS.has(daysParam) ? daysParam : 3;

  const tFence  = buildTransferFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
  const tAnd    = tFence ? ` AND ${tFence.sql}` : "";
  const tParams = tFence?.params ?? [];

  try {
    const conn = await pool.getConnection();
    try {
      const [byCurrency] = await conn.query<RowDataPacket[]>(
        `SELECT   send_currency,
                  COUNT(*)         AS total_transfers,
                  SUM(send_amount) AS total_revenue
         FROM     transfers
         WHERE    created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                  ${tAnd}
         GROUP BY send_currency
         ORDER BY total_revenue DESC`,
        [days, ...tParams],
      );

      const [byDestination] = await conn.query<RowDataPacket[]>(
        `SELECT   destination_country,
                  COUNT(*)         AS total_transfers,
                  SUM(send_amount) AS total_revenue
         FROM     transfers
         WHERE    created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                  ${tAnd}
         GROUP BY destination_country
         ORDER BY total_revenue DESC`,
        [days, ...tParams],
      );

      return NextResponse.json({
        byCurrency: byCurrency.map((r) => ({
          currency:        r.send_currency as string | null,
          total_transfers: Number(r.total_transfers),
          total_revenue:   Number(r.total_revenue ?? 0),
        })),
        byDestination: byDestination.map((r) => ({
          destination:     r.destination_country as string | null,
          total_transfers: Number(r.total_transfers),
          total_revenue:   Number(r.total_revenue ?? 0),
        })),
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/dashboard/stats]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
