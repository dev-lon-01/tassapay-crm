import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

/**
 * GET /api/settings/dropdowns
 *   Returns all active dropdown rows ordered by category + sort_order.
 *   Auth: any authenticated user.
 *
 * POST /api/settings/dropdowns
 *   Body: { category, label, sort_order? }
 *   Creates a new dropdown item.
 *   Auth: Admin only.
 */

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const whereClause = category ? "AND category = ?" : "";
  const params: (string | number)[] = category ? [category] : [];

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, category, label, sort_order, is_active
       FROM   system_dropdowns
       WHERE  is_active = 1 ${whereClause}
       ORDER  BY category, sort_order ASC`,
      params
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/settings/dropdowns]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { category?: string; label?: string; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { category, label, sort_order = 0 } = body;

  if (!category || !label) {
    return NextResponse.json({ error: "category and label are required" }, { status: 400 });
  }

  const ALLOWED_CATEGORIES = ["call_outcome", "focus_outcome", "note_outcome"];
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  if (label.trim().length === 0 || label.trim().length > 100) {
    return NextResponse.json({ error: "Label must be 1–100 characters" }, { status: 400 });
  }

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO system_dropdowns (category, label, sort_order) VALUES (?, ?, ?)`,
      [category, label.trim(), sort_order]
    );
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "This label already exists in this category" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/settings/dropdowns]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
