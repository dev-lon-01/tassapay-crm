import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence, REGION_MAP } from "@/src/lib/regionFence";

interface ActivityReportRow extends RowDataPacket {
  day: string;
  first_activity: string | null;
  last_activity: string | null;
  wall_clock_span: string | null;
  active_working_time: string | null;
  total_activities: number;
  calls: number;
  sms: number;
  notes: number;
  emails: number;
  unique_customers: number;
  total_call_time: string | null;
  connected_calls: number;
  no_answer_calls: number;
  session_breaks: number;
  agent_id: number;
  agent_name: string | null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: isoDate(start), to: isoDate(now) };
}

/**
 * GET /api/activity/report
 *
 * Returns a daily activity summary report derived from interactions, using the
 * same gap-based active time logic as the ad-hoc SQL report.
 *
 * Query params:
 *   ?region=UK|EU
 *   ?agentId=123           - required for Admin, ignored for non-Admin callers
 *   ?from=YYYY-MM-DD
 *   ?to=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const regionParam = searchParams.get("region");
  const requestedAgentId = searchParams.get("agentId");
  const requestedFrom = searchParams.get("from");
  const requestedTo = searchParams.get("to");

  if (requestedFrom && !isIsoDate(requestedFrom)) {
    return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
  }
  if (requestedTo && !isIsoDate(requestedTo)) {
    return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
  }

  const defaults = getDefaultRange();
  const from = requestedFrom ?? defaults.from;
  const to = requestedTo ?? defaults.to;

  if (from > to) {
    return NextResponse.json({ error: "From date must be before to date" }, { status: 400 });
  }

  const callerRegions = auth.allowed_regions ?? ["UK", "EU"];
  let effectiveRegions: string[];

  if (regionParam) {
    if (!callerRegions.includes(regionParam) && auth.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    effectiveRegions = [regionParam];
  } else {
    effectiveRegions = auth.role === "Admin" ? Object.keys(REGION_MAP) : callerRegions;
  }

  const isAdmin = auth.role === "Admin" && !regionParam;
  const fence = buildCountryFence(effectiveRegions, isAdmin);

  let agentId: number;
  if (auth.role === "Admin") {
    if (!requestedAgentId) {
      return NextResponse.json({ error: "Select an agent to run this report" }, { status: 400 });
    }
    agentId = Number(requestedAgentId);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }
  } else {
    agentId = auth.id;
  }

  try {
    const fenceClause = fence ? `AND (c.country IN (${fence.params.map(() => "?").join(",")}) OR i.customer_id IS NULL)` : "";
    const fenceParams = fence?.params ?? [];

    const [rows] = await pool.execute<ActivityReportRow[]>(
      `WITH ordered AS (
         SELECT
           DATE(i.created_at) AS day,
           i.created_at AS ts,
           i.type,
           i.call_duration_seconds,
           i.customer_id,
           i.agent_id,
           u.name AS agent_name,
           LAG(i.created_at) OVER (
             PARTITION BY DATE(i.created_at)
             ORDER BY i.created_at
           ) AS prev_ts
         FROM interactions i
         LEFT JOIN customers c ON c.customer_id = i.customer_id
         LEFT JOIN users u ON u.id = i.agent_id
         WHERE i.agent_id = ?
           AND i.created_at >= ?
           AND i.created_at < DATE_ADD(?, INTERVAL 1 DAY)
           ${fenceClause}
       ),
       gaps AS (
         SELECT
           day,
           ts,
           type,
           call_duration_seconds,
           customer_id,
           agent_id,
           agent_name,
           TIMESTAMPDIFF(SECOND, prev_ts, ts) AS gap_seconds,
           CASE
             WHEN prev_ts IS NULL THEN 0
             WHEN TIMESTAMPDIFF(MINUTE, prev_ts, ts) <= 30 THEN TIMESTAMPDIFF(SECOND, prev_ts, ts)
             ELSE 0
           END AS active_seconds
         FROM ordered
       )
       SELECT
         DATE_FORMAT(day, '%Y-%m-%d') AS day,
         TIME_FORMAT(MIN(ts), '%H:%i:%s') AS first_activity,
         TIME_FORMAT(MAX(ts), '%H:%i:%s') AS last_activity,
         TIME_FORMAT(TIMEDIFF(MAX(ts), MIN(ts)), '%H:%i:%s') AS wall_clock_span,
         TIME_FORMAT(SEC_TO_TIME(SUM(active_seconds)), '%H:%i:%s') AS active_working_time,
         COUNT(*) AS total_activities,
         SUM(type = 'Call') AS calls,
         SUM(type = 'SMS') AS sms,
         SUM(type = 'Note') AS notes,
         SUM(type = 'Email') AS emails,
         COUNT(DISTINCT customer_id) AS unique_customers,
         TIME_FORMAT(SEC_TO_TIME(SUM(COALESCE(call_duration_seconds, 0))), '%H:%i:%s') AS total_call_time,
         SUM(CASE WHEN type = 'Call' AND call_duration_seconds > 0 THEN 1 ELSE 0 END) AS connected_calls,
         SUM(CASE WHEN type = 'Call' AND COALESCE(call_duration_seconds, 0) = 0 THEN 1 ELSE 0 END) AS no_answer_calls,
         SUM(CASE WHEN gap_seconds > 1800 THEN 1 ELSE 0 END) AS session_breaks,
         MAX(agent_id) AS agent_id,
         MAX(agent_name) AS agent_name
       FROM gaps
       GROUP BY day
       ORDER BY day ASC`,
      [agentId, from, to, ...fenceParams],
    );

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/activity/report]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
