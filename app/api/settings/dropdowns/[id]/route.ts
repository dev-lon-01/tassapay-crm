import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { ResultSetHeader } from "mysql2";

/**
 * PUT /api/settings/dropdowns/:id
 *   Body: { label?, sort_order?, is_active? }
 *   Updates a dropdown item.  No DELETE — use is_active=0 for soft-delete.
 *   Auth: Admin only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { label?: string; sort_order?: number; is_active?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.label !== undefined) {
    const trimmed = body.label.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      return NextResponse.json({ error: "Label must be 1–100 characters" }, { status: 400 });
    }
    updates.push("label = ?");
    values.push(trimmed);
  }

  if (body.sort_order !== undefined) {
    updates.push("sort_order = ?");
    values.push(Number(body.sort_order));
  }

  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  values.push(id);

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE system_dropdowns SET ${updates.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PUT /api/settings/dropdowns/:id]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
