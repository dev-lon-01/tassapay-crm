import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/sync/logs
 *
 * Returns the 30 most recent entries from sync_log. Admin-only.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, started_at, type, finished_at,
              records_fetched, records_inserted, records_updated,
              status, error_message
       FROM   sync_log
       ORDER  BY started_at DESC
       LIMIT  30`
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
