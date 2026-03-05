import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/leads/labels
 *
 * Returns a deduplicated, sorted list of all label values
 * used across all leads in the database.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT labels
     FROM   customers
     WHERE  is_lead = 1
       AND  labels IS NOT NULL
       AND  JSON_LENGTH(labels) > 0`
  );

  const labelSet = new Set<string>();
  for (const row of rows) {
    try {
      const labels =
        typeof row.labels === "string" ? JSON.parse(row.labels) : row.labels;
      if (Array.isArray(labels)) {
        labels.forEach((l: unknown) => {
          if (typeof l === "string" && l.trim()) labelSet.add(l.trim());
        });
      }
    } catch {
      // skip malformed JSON
    }
  }

  return NextResponse.json({ labels: [...labelSet].sort() });
}
