import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { ResultSetHeader } from "mysql2";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const { ids, all } = body as { ids?: unknown; all?: unknown };

    if (all === true) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
        [auth.id]
      );
      return NextResponse.json({ marked: result.affectedRows });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ marked: 0 });
    }

    const numericIds = ids
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (numericIds.length === 0) {
      return NextResponse.json({ marked: 0 });
    }

    const placeholders = numericIds.map(() => "?").join(", ");
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE notifications SET is_read = 1
       WHERE user_id = ? AND id IN (${placeholders}) AND is_read = 0`,
      [auth.id, ...numericIds]
    );

    return NextResponse.json({ marked: result.affectedRows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/notifications/mark-read]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
