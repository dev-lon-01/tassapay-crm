import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/todos/agents
 *
 * Returns the list of active agent/admin users (id + name only) for
 * use in task assignment dropdowns. Available to all authenticated users.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name FROM users WHERE is_active = 1 ORDER BY name ASC`
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/todos/agents]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
