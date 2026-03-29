import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence, getAllowedCountries, REGION_MAP } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/activity/agents
 *
 * Returns agent interactions across all customers, fenced to the caller's allowed regions.
 *
 * Query params (all optional):
 *   ?region=UK|EU   – further filter to a single region (must be within caller's allowed_regions)
 *   ?type=Call|SMS|Note  – filter by interaction type
 *   ?limit=50        – records per page (default 50, max 200)
 *   ?page=1          – 1-based page number (default 1)
 *
 * Response: Array of {
 *   id, type, outcome, note, created_at,
 *   call_duration_seconds, phone_number,
 *   agent_name, customer_name, customer_country
 * }
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const regionParam = searchParams.get("region");
  const typeParam   = searchParams.get("type");   // e.g. "Call", "SMS", "Note"
  const agentIdParam = searchParams.get("agentId");
  const fromParam    = searchParams.get("from"); // ISO date string e.g. "2026-03-01"
  const toParam      = searchParams.get("to");   // ISO date string e.g. "2026-03-25"
  const limit  = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const page   = Math.max(1, Number(searchParams.get("page") ?? 1));
  const offset = (page - 1) * limit;

  // Determine effective regions: caller's allowed regions, optionally narrowed by ?region=
  const callerRegions = auth.allowed_regions ?? ["UK", "EU"];
  let effectiveRegions: string[];

  if (regionParam) {
    // Only allow narrowing to regions the caller already has access to
    if (!callerRegions.includes(regionParam) && auth.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    effectiveRegions = [regionParam];
  } else {
    effectiveRegions = auth.role === "Admin" ? Object.keys(REGION_MAP) : callerRegions;
  }

  // Build the country fence
  const isAdmin = auth.role === "Admin" && !regionParam;
  const fence = buildCountryFence(effectiveRegions, isAdmin);

  try {
    const fenceClause = fence ? `AND (c.country IN (${fence.params.map(() => "?").join(",")}) OR i.customer_id IS NULL)` : "";
    const fenceParams = fence?.params ?? [];

    const typeClause  = typeParam ? "AND i.type = ?" : "";
    const typeParams  = typeParam ? [typeParam] : [];

    const agentClause = agentIdParam ? "AND i.agent_id = ?" : "";
    const agentParams = agentIdParam ? [agentIdParam] : [];

    const fromClause = fromParam ? "AND i.created_at >= ?" : "";
    const fromParams = fromParam ? [fromParam] : [];

    const toClause = toParam ? "AND i.created_at <= ?" : "";
    const toParams = toParam ? [`${toParam} 23:59:59`] : [];

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         i.id,
         i.type,
         i.outcome,
         i.note,
         i.created_at,
         i.call_duration_seconds,
         i.direction,
         i.metadata,
         i.customer_id,
         i.recording_url,
         c.phone_number,
         u.name      AS agent_name,
         u.id        AS agent_id,
         c.full_name AS customer_name,
         c.country   AS customer_country
       FROM   interactions i
       LEFT JOIN customers c ON c.customer_id = i.customer_id
       LEFT JOIN users u  ON u.id = i.agent_id
       WHERE  (i.agent_id IS NOT NULL OR (i.type = 'SMS' AND i.direction = 'inbound'))
         ${fenceClause}
         ${typeClause}
         ${agentClause}
         ${fromClause}
         ${toClause}
       ORDER BY i.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [...fenceParams, ...typeParams, ...agentParams, ...fromParams, ...toParams],
    );

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/activity/agents]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
