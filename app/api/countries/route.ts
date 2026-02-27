import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/countries
 * Returns sorted list of distinct country names in the customers table.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT country
       FROM customers
       WHERE country IS NOT NULL AND country != ''
       ORDER BY country ASC`
    );
    return NextResponse.json(rows.map((r) => r.country as string));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/countries]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
