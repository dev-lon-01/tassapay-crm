import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

/**
 * POST /api/leads/validate-bulk
 *
 * Checks a list of phone numbers against the database.
 * Returns the phones that already exist (duplicates).
 *
 * Body: { phones: string[] }
 * Response: { duplicates: string[] }  — phones found in DB
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: { phones?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phones = body.phones;
  if (!Array.isArray(phones) || phones.length === 0) {
    return NextResponse.json({ duplicates: [] });
  }

  const normalised = (phones as string[]).map((p) =>
    p.replace(/[\s\-+]/g, "")
  );

  const placeholders = normalised.map(() => "?").join(",");

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT phone_number
       FROM   customers
       WHERE  REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') IN (${placeholders})`,
      normalised
    );

    const found = new Set(
      rows.map((r) => r.phone_number.replace(/[\s\-+]/g, ""))
    );

    const duplicates = (phones as string[]).filter((p) =>
      found.has(p.replace(/[\s\-+]/g, ""))
    );

    return NextResponse.json({ duplicates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
