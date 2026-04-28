import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET /api/todos/[id]/comments
 *
 * Returns all comments for a task, ordered chronologically.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const taskId = parseInt(params.id, 10);
  if (!taskId || isNaN(taskId)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         tc.id, tc.task_id, tc.agent_id, tc.comment, tc.created_at,
         u.name AS agent_name
       FROM task_comments tc
       LEFT JOIN users u ON u.id = tc.agent_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId]
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/todos/[id]/comments]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/todos/[id]/comments
 *
 * Add an action log comment to a task.
 *
 * Body (JSON):
 *   comment  string  (required)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const taskId = parseInt(params.id, 10);
  if (!taskId || isNaN(taskId)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { comment } = body ?? {};

    if (!comment || typeof comment !== "string" || !comment.trim()) {
      return NextResponse.json({ error: "comment is required" }, { status: 400 });
    }

    // Verify task exists
    const [taskRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM tasks WHERE id = ?`,
      [taskId]
    );
    if (!taskRows.length) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO task_comments (task_id, agent_id, comment) VALUES (?, ?, ?)`,
      [taskId, auth.id, comment.trim()]
    );

    const [newRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         tc.id, tc.task_id, tc.agent_id, tc.comment, tc.created_at,
         u.name AS agent_name
       FROM task_comments tc
       LEFT JOIN users u ON u.id = tc.agent_id
       WHERE tc.id = ?`,
      [result.insertId]
    );

    return NextResponse.json(newRows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/todos/[id]/comments]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
