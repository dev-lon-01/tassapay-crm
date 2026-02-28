import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/dashboard
 *
 * Returns headline counts for the CRM dashboard:
 *   totalUsers     – all customers in the DB
 *   pendingKyc     – customers whose KYC has not been completed
 *   zeroTransfers  – customers who have never sent a transfer
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const conn = await pool.getConnection();
    try {
      // Build region fence once for all 3 queries
      const fence = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
      const fenceClause = fence ? `WHERE ${fence.sql}` : "";
      const fenceParams = fence?.params ?? [];

      const [[{ totalUsers }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS totalUsers FROM customers ${fenceClause}`,
        fenceParams,
      );
      const [[{ pendingKyc }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS pendingKyc FROM customers WHERE kyc_completion_date IS NULL${fence ? ` AND ${fence.sql}` : ""}`,
        fenceParams,
      );
      const [[{ zeroTransfers }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS zeroTransfers FROM customers WHERE total_transfers = 0${fence ? ` AND ${fence.sql}` : ""}`,
        fenceParams,
      );

      return NextResponse.json({
        totalUsers: Number(totalUsers),
        pendingKyc: Number(pendingKyc),
        zeroTransfers: Number(zeroTransfers),
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/dashboard]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
