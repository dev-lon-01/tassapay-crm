import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence, getAllowedCountries, REGION_MAP } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/activity/agents
 *
 * Returns the most recent agent interactions across all customers,
 * fenced to the caller's allowed regions.
 *
 * Query params (all optional):
 *   ?region=UK|EU   – further filter to a single region (must be within caller's allowed_regions)
 *   ?limit=50        – max records (default 50, max 200)
 *
 * Response: Array of {
 *   id, type, outcome, note, created_at,
 *   agent_name, customer_name, customer_country
 * }
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const regionParam = searchParams.get("region");
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));

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
    const fenceClause = fence ? `AND c.country IN (${fence.params.map(() => "?").join(",")})` : "";
    const fenceParams = fence?.params ?? [];

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         i.id,
         i.type,
         i.outcome,
         i.note,
         i.created_at,
         u.name  AS agent_name,
         c.full_name AS customer_name,
         c.country   AS customer_country
       FROM   interactions i
       JOIN   customers c ON c.customer_id = i.customer_id
       LEFT JOIN users u  ON u.id = i.agent_id
       WHERE  i.agent_id IS NOT NULL
         ${fenceClause}
       ORDER BY i.created_at DESC
       LIMIT ${limit}`,
      fenceParams,
    );

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/activity/agents]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
