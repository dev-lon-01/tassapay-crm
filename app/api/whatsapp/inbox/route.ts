import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { pool } from "@/src/lib/db";
import type { RowDataPacket } from "mysql2";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const showAttached = searchParams.get("all") === "1";
  const where = showAttached ? "" : "WHERE attached_task_id IS NULL";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, wamid, from_phone, message_type, body, media_url,
            attached_task_id, attached_at, received_at
     FROM whatsapp_inbox
     ${where}
     ORDER BY received_at ASC
     LIMIT 200`
  );

  return NextResponse.json(rows);
}
