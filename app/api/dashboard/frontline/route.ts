import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/dashboard/frontline
 *
 * Agent's personal gamified dashboard KPIs:
 *   myActivities       — interactions logged by this agent (period)
 *   myKycConversions    — KYC completions attributed to this agent (period)
 *   myTransferConversions — first transfers attributed to this agent (period)
 *   myPortfolioSize     — total customers assigned to this agent
 *   myCommissions       — { pending, approved, paid, totalEarned }
 *   leaderboardRank     — agent's rank by transfer conversions this period
 *   leaderboardTotal    — total agents on leaderboard
 *
 * Query params:
 *   ?days=7  (default 7, whitelist: 1,7,14,30)
 */
const VALID_DAYS = new Set([1, 7, 14, 30]);

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const daysParam = Number(searchParams.get("days") ?? "7");
  const days = VALID_DAYS.has(daysParam) ? daysParam : 7;

  const agentId = auth.id;

  try {
    const conn = await pool.getConnection();
    try {
      // My interactions for the period
      const [[{ myActivities }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS myActivities FROM interactions
         WHERE agent_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [agentId, days],
      );

      // Activity breakdown by type
      const [breakdownRows] = await conn.query<RowDataPacket[]>(
        `SELECT type, COUNT(*) AS count FROM interactions
         WHERE agent_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY type`,
        [agentId, days],
      );
      const activityBreakdown: Record<string, number> = {};
      for (const r of breakdownRows) {
        activityBreakdown[r.type as string] = Number(r.count);
      }

      // Total talk time + meaningful calls (> 2 min)
      const [[{ totalTalkTimeSeconds, meaningfulCalls }]] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(call_duration_seconds), 0) AS totalTalkTimeSeconds,
                SUM(CASE WHEN call_duration_seconds > 120 THEN 1 ELSE 0 END) AS meaningfulCalls
         FROM interactions
         WHERE agent_id = ? AND type = 'Call'
           AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [agentId, days],
      );

      // My KYC conversions (customers whose kyc_attributed_agent_id = me, KYC in period)
      const [[{ myKycConversions }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS myKycConversions FROM customers
         WHERE kyc_attributed_agent_id = ?
           AND kyc_completion_date >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [agentId, days],
      );

      // My transfer conversions (first transfers attributed to me, in period)
      const [[{ myTransferConversions }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS myTransferConversions FROM transfers
         WHERE attributed_agent_id = ?
           AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [agentId, days],
      );

      // My portfolio size
      const [[{ myPortfolioSize }]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS myPortfolioSize FROM customers
         WHERE assigned_agent_id = ? OR assigned_user_id = ?`,
        [agentId, agentId],
      );

      // My commissions breakdown
      const [commRows] = await conn.query<RowDataPacket[]>(
        `SELECT status, COUNT(*) AS cnt, SUM(commission_amount) AS total
         FROM commissions WHERE agent_id = ? GROUP BY status`,
        [agentId],
      );
      const commMap: Record<string, { cnt: number; total: number }> = {};
      for (const r of commRows) {
        commMap[r.status as string] = { cnt: Number(r.cnt), total: Number(r.total ?? 0) };
      }

      // Leaderboard rank (by transfer conversions this period)
      const [leaderboard] = await conn.query<RowDataPacket[]>(
        `SELECT u.id AS agentId,
                (SELECT COUNT(*) FROM transfers t
                 WHERE t.attributed_agent_id = u.id
                   AND t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS conversions
         FROM users u WHERE u.role = 'Agent' AND u.is_active = 1
         ORDER BY conversions DESC`,
        [days],
      );
      let myRank = 0;
      for (let i = 0; i < leaderboard.length; i++) {
        if (Number(leaderboard[i].agentId) === agentId) {
          myRank = i + 1;
          break;
        }
      }

      return NextResponse.json({
        myActivities:          Number(myActivities),
        activityBreakdown,
        totalTalkTimeSeconds:  Number(totalTalkTimeSeconds),
        meaningfulCalls:       Number(meaningfulCalls ?? 0),
        myKycConversions:      Number(myKycConversions),
        myTransferConversions: Number(myTransferConversions),
        myPortfolioSize:       Number(myPortfolioSize),
        myCommissions: {
          pending:     commMap["pending_approval"]?.cnt ?? 0,
          approved:    commMap["approved"]?.cnt ?? 0,
          paid:        commMap["paid"]?.cnt ?? 0,
          totalEarned: (commMap["approved"]?.total ?? 0) + (commMap["paid"]?.total ?? 0),
        },
        leaderboardRank:  myRank,
        leaderboardTotal: leaderboard.length,
        days,
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/dashboard/frontline]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
