import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
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
  if (auth.role !== "Admin" && auth.role !== "Manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const conn = await pool.getConnection();
    try {
      // ── Health ────────────────────────────────────────────────────────────

      // Somalia transfers pending > 15 minutes
      const [[{ somaliaBreached }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS somaliaBreached
        FROM   transfers
        WHERE  destination_country = 'Somalia'
          AND  status NOT IN ('Completed', 'Deposited', 'Cancel')
          AND  created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
      `);

      // Standard transfers pending > 24 hours
      const [[{ standardBreached }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS standardBreached
        FROM   transfers
        WHERE  status NOT IN ('Completed', 'Deposited', 'Cancel')
          AND  created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      // Last transfer ingested
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
      `);

      // Customers registered in last 7 days with zero transfers
      const [[{ newZeroTransfer }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS newZeroTransfer
        FROM   customers
        WHERE  registration_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND  total_transfers = 0
      `);

      // Dormant: last transfer > 40 days ago (or never transferred, with account > 40 days old)
      const [[{ dormantUsers }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS dormantUsers
        FROM   customers c
        WHERE  (
          SELECT MAX(t.created_at)
          FROM   transfers t
          WHERE  t.customer_id = c.customer_id
        ) <= DATE_SUB(NOW(), INTERVAL 40 DAY)
      `);

      // ── Velocity ──────────────────────────────────────────────────────────

      // Agent interactions logged today
      const [[{ interactionsToday }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS interactionsToday
        FROM   interactions
        WHERE  created_at >= CURDATE()
      `);

      // Transfers with an attributed agent created today
      const [[{ conversionsToday }]] = await conn.query<RowDataPacket[]>(`
        SELECT COUNT(*) AS conversionsToday
        FROM   transfers
        WHERE  attributed_agent_id IS NOT NULL
          AND  created_at >= CURDATE()
      `);

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
