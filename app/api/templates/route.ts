import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET  /api/templates           – list all (optional ?channel=SMS|Email)
 * POST /api/templates           – create new template
 */

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(req.url);
    const channel = searchParams.get("channel");

    const [rows] = channel
      ? await pool.execute<RowDataPacket[]>(
          "SELECT * FROM templates WHERE channel = ? ORDER BY id ASC",
          [channel]
        )
      : await pool.execute<RowDataPacket[]>(
          "SELECT * FROM templates ORDER BY channel ASC, id ASC"
        );

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/templates]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    if (!["SMS", "Email"].includes(channel)) {
      return NextResponse.json({ error: "channel must be SMS or Email" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO templates (name, channel, subject, body) VALUES (?, ?, ?, ?)",
      [name.trim(), channel, subject?.trim() || null, body.trim()]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM templates WHERE id = ?",
      [result.insertId]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/templates]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
