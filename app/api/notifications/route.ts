import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

interface NotificationRow extends RowDataPacket {
  id: number;
  type: "mention" | "task_assigned" | "task_reassigned" | "comment_on_assigned";
  task_id: number;
  task_title: string | null;
  actor_name: string | null;
  excerpt: string | null;
  is_read: number;
  created_at: string;
}

interface UnreadCountRow extends RowDataPacket {
  unread_count: number;
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const [rows] = await pool.execute<NotificationRow[]>(
      `SELECT n.id, n.type, n.task_id, n.is_read, n.excerpt, n.created_at,
              t.title AS task_title,
              u.name  AS actor_name
       FROM notifications n
       LEFT JOIN tasks t ON t.id = n.task_id
       LEFT JOIN users u ON u.id = n.actor_user_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 30`,
      [auth.id]
    );

    const [countRows] = await pool.execute<UnreadCountRow[]>(
      `SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [auth.id]
    );
    const unreadCount = countRows[0]?.unread_count ?? 0;

    return NextResponse.json({ unread_count: Number(unreadCount), data: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/notifications]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
