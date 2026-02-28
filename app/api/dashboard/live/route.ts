import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence, buildTransferFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/dashboard/live
 *
 * Live operational pulse for the command-centre dashboard.
 * Protected: Admin and Manager roles only.
 *
 * Returns:
 *   health   – SLA breach counts + last transfer ingestion timestamp
 *   pipeline – KYC, new zero-transfer users, dormant users
 *   velocity – interactions today, attributed transfers today
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin" && !auth.can_view_dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const conn = await pool.getConnection();
    try {
      // Build fences once for this request
      const isAdmin = auth.role === "Admin";
      const regions = auth.allowed_regions ?? ["UK", "EU"];
      const cFence  = buildCountryFence(regions, isAdmin);   // for customers table
      const tFence  = buildTransferFence(regions, isAdmin);  // for transfers table
      const cAnd    = cFence ? ` AND ${cFence.sql}` : "";
      const tAnd    = tFence ? ` AND ${tFence.sql}` : "";
      const cParams = cFence?.params ?? [];
      const tParams = tFence?.params ?? [];

      // ── Health ────────────────────────────────────────────────────────────

      // Somalia transfers pending > 15 minutes
      const [[{ somaliaBreached }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS somaliaBreached
        FROM   transfers
        WHERE  destination_country = 'Somalia'
          AND  status NOT IN ('Completed', 'Deposited', 'Cancel')
          AND  created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
          ${tAnd}
      `, tParams);

      // Standard transfers pending > 24 hours
      const [[{ standardBreached }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS standardBreached
        FROM   transfers
        WHERE  status NOT IN ('Completed', 'Deposited', 'Cancel')
          AND  created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          ${tAnd}
      `, tParams);

      // Last transfer ingested (no fence — global freshness indicator)
      const [[{ lastIngestedAt }]] = await conn.query<RowDataPacket[]>(`
        SELECT MAX(created_at) AS lastIngestedAt
        FROM   transfers
      `);

      // ── Pipeline ──────────────────────────────────────────────────────────

      // Customers with no KYC completion
      const [[{ pendingKyc }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS pendingKyc
        FROM   customers
        WHERE  kyc_completion_date IS NULL
          ${cAnd}
      `, cParams);

      // Customers registered in last 7 days with zero transfers
      const [[{ newZeroTransfer }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS newZeroTransfer
        FROM   customers
        WHERE  registration_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND  total_transfers = 0
          ${cAnd}
      `, cParams);

      // Dormant: last transfer > 40 days ago (or never transferred)
      const [[{ dormantUsers }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS dormantUsers
        FROM   customers c
        WHERE  (
          SELECT MAX(t.created_at)
          FROM   transfers t
          WHERE  t.customer_id = c.customer_id
        ) <= DATE_SUB(NOW(), INTERVAL 40 DAY)
          ${cAnd}
      `, cParams);

      // ── Velocity ──────────────────────────────────────────────────────────

      // Agent interactions logged today (fenced via customer join)
      const [[{ interactionsToday }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS interactionsToday
        FROM   interactions i
        WHERE  i.created_at >= CURDATE()
          ${cFence ? `AND i.customer_id IN (SELECT customer_id FROM customers WHERE ${cFence.sql})` : ""}
      `, cParams);

      // Transfers with an attributed agent created today
      const [[{ conversionsToday }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS conversionsToday
        FROM   transfers
        WHERE  attributed_agent_id IS NOT NULL
          AND  created_at >= CURDATE()
          ${tAnd}
      `, tParams);

      return NextResponse.json({
        health: {
          somaliaBreached:  Number(somaliaBreached),
          standardBreached: Number(standardBreached),
          lastIngestedAt:   lastIngestedAt ?? null,
        },
        pipeline: {
          pendingKyc:      Number(pendingKyc),
          newZeroTransfer: Number(newZeroTransfer),
          dormantUsers:    Number(dormantUsers),
        },
        velocity: {
          interactionsToday: Number(interactionsToday),
          conversionsToday:  Number(conversionsToday),
        },
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/dashboard/live]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
