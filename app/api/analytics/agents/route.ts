import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/analytics/agents
 *
 * Query params (all optional):
 *   ?startDate=  ISO date  (default: 7 days ago)
 *   ?endDate=    ISO date  (default: today)
 *
 * Response:
 *   Array of { agentId, agentName, totalActivities, kycConversions, transferConversions }
 *
 * Attribution uses direct FK columns (set by webhooks at conversion time):
 *   - totalActivities    = interactions logged by the agent in the range
 *   - kycConversions     = customers where kyc_attributed_agent_id = agent AND
 *                          kyc_completion_date falls in the range
 *   - transferConversions = transfers where attributed_agent_id = agent AND
 *                          transfer created_at falls in the range
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

    const startStr = `${startDate} 00:00:00`;
    const endStr   = `${endDate} 23:59:59`;

    const sql = `
      SELECT
        u.id   AS agentId,
        u.name AS agentName,

        /* Total interactions logged by this agent in the range */
        (
          SELECT COUNT(*)
          FROM   interactions i
          WHERE  i.agent_id   = u.id
            AND  i.created_at BETWEEN ? AND ?
        ) AS totalActivities,

        /* KYC completions directly attributed to this agent */
        (
          SELECT COUNT(*)
          FROM   customers c
          WHERE  c.kyc_attributed_agent_id = u.id
            AND  c.kyc_completion_date BETWEEN ? AND ?
        ) AS kycConversions,

        /* First transfers directly attributed to this agent */
        (
          SELECT COUNT(*)
          FROM   transfers t
          WHERE  t.attributed_agent_id = u.id
            AND  t.created_at BETWEEN ? AND ?
        ) AS transferConversions

      FROM users u
      WHERE u.role = 'Agent'
      ORDER BY transferConversions DESC, kycConversions DESC, totalActivities DESC
    `;

    // 2 params per subquery × 3 subqueries = 6 total
    const params = [
      startStr, endStr,  // totalActivities
      startStr, endStr,  // kycConversions
      startStr, endStr,  // transferConversions
    ];

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/analytics/agents]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
