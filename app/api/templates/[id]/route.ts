import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * PUT    /api/templates/:id  – update template
 * DELETE /api/templates/:id  – delete template
 */

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { name, channel, subject, body } = await req.json();

    if (!name?.trim() || !channel || !body?.trim()) {
      return NextResponse.json(
        { error: "name, channel, and body are required" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE templates SET name = ?, channel = ?, subject = ?, body = ? WHERE id = ?",
      [name.trim(), channel, subject?.trim() || null, body.trim(), params.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM templates WHERE id = ?",
      [params.id]
    );

    return NextResponse.json(rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PUT /api/templates/${params.id}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(_req);
  if (auth instanceof NextResponse) return auth;
  try {
    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM templates WHERE id = ?",
      [params.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DELETE /api/templates/${params.id}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
