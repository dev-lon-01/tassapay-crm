import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { notifyAssignee } from "@/src/lib/taskNotifications";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET /api/todos/[id]
 *
 * Returns a single task with its full comment list.
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
    const [taskRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         t.id, t.customer_id, t.transfer_reference, tr.id AS transfer_id,
         t.title, t.description, t.category, t.priority,
         t.status, t.assigned_agent_id, t.created_by, t.created_at, t.updated_at,
         c.full_name AS customer_name,
         u.name      AS assigned_agent_name,
         cb.name     AS created_by_name
       FROM tasks t
       LEFT JOIN customers c  ON c.customer_id  = t.customer_id
       LEFT JOIN transfers tr ON tr.transaction_ref = t.transfer_reference
       LEFT JOIN users     u  ON u.id           = t.assigned_agent_id
       LEFT JOIN users     cb ON cb.id          = t.created_by
       WHERE t.id = ?`,
      [taskId]
    );

    if (!taskRows.length) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const [commentRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         tc.id, tc.task_id, tc.agent_id, tc.comment, tc.created_at,
         u.name AS agent_name
       FROM task_comments tc
       LEFT JOIN users u ON u.id = tc.agent_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId]
    );

    return NextResponse.json({ task: taskRows[0], comments: commentRows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/todos/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/todos/[id]
 *
 * Update a task. Any combination of the following fields may be sent:
 *   title?              string
 *   description?        string | null
 *   category?           Query | Action | KYC | Payment_Issue
 *   priority?           Low | Medium | High | Urgent
 *   status?             Open | In_Progress | Pending | Closed
 *   assigned_agent_id?  number | null
 *   resolution_comment? string   (required when status === "Closed")
 *
 * When status is changed to "Closed" a task_comment is automatically
 * inserted with the resolution_comment text.
 */
export async function PATCH(
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
    const {
      customer_id,
      title,
      description,
      category,
      priority,
      status,
      assigned_agent_id,
      resolution_comment,
      transfer_reference,
    } = body ?? {};

    // Enforce resolution comment when closing
    if (status === "Closed") {
      if (
        !resolution_comment ||
        typeof resolution_comment !== "string" ||
        !resolution_comment.trim()
      ) {
        return NextResponse.json(
          { error: "A resolution comment is required to close a task." },
          { status: 400 }
        );
      }
    }

    // Build SET clause dynamically from only the fields provided
    const VALID_CATEGORY = new Set(["Query", "Action", "KYC", "Payment_Issue"]);
    const VALID_PRIORITY  = new Set(["Low", "Medium", "High", "Urgent"]);
    const VALID_STATUS    = new Set(["Open", "In_Progress", "Pending", "Closed"]);

    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (customer_id !== undefined) {
      if (!customer_id || typeof customer_id !== "string" || !customer_id.trim()) {
        return NextResponse.json({ error: "customer_id cannot be empty" }, { status: 400 });
      }
      sets.push("`customer_id` = ?");
      values.push(customer_id.trim());
    }
    if (title !== undefined) {
      if (!title || typeof title !== "string" || !title.trim()) {
        return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      }
      sets.push("`title` = ?");
      values.push(title.trim());
    }
    if (description !== undefined) {
      sets.push("`description` = ?");
      values.push(description?.trim() || null);
    }
    if (category !== undefined) {
      if (!VALID_CATEGORY.has(category)) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      }
      sets.push("`category` = ?");
      values.push(category);
    }
    if (priority !== undefined) {
      if (!VALID_PRIORITY.has(priority)) {
        return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
      }
      sets.push("`priority` = ?");
      values.push(priority);
    }
    if (status !== undefined) {
      if (!VALID_STATUS.has(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      sets.push("`status` = ?");
      values.push(status);
      if (status === "Closed") {
        sets.push("`closed_by` = ?", "`closed_at` = NOW()");
        values.push(auth.id);
      } else {
        sets.push("`closed_by` = NULL", "`closed_at` = NULL");
      }
    }
    if (assigned_agent_id !== undefined) {
      sets.push("`assigned_agent_id` = ?");
      values.push(typeof assigned_agent_id === "number" ? assigned_agent_id : null);
    }
    if (transfer_reference !== undefined) {
      sets.push("`transfer_reference` = ?");
      values.push(transfer_reference?.trim() || null);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    let oldAssigneeId: number | null = null;
    if (assigned_agent_id !== undefined) {
      const [currentRows] = await pool.execute<RowDataPacket[]>(
        `SELECT assigned_agent_id FROM tasks WHERE id = ? LIMIT 1`,
        [taskId]
      );
      if (currentRows.length === 0) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      oldAssigneeId = (currentRows[0] as { assigned_agent_id: number | null }).assigned_agent_id;
    }

    values.push(taskId);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Auto-insert resolution comment when closing
    if (status === "Closed" && resolution_comment?.trim()) {
      await pool.execute(
        `INSERT INTO task_comments (task_id, agent_id, comment, kind) VALUES (?, ?, ?, 'close_resolution')`,
        [taskId, auth.id, resolution_comment.trim()]
      );
    }

    // Return updated task with joined names
    const [taskRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         t.id, t.customer_id, t.transfer_reference, tr.id AS transfer_id,
         t.title, t.description, t.category, t.priority,
         t.status, t.assigned_agent_id, t.created_by, t.created_at, t.updated_at,
         c.full_name AS customer_name,
         u.name      AS assigned_agent_name,
         cb.name     AS created_by_name
       FROM tasks t
       LEFT JOIN customers c  ON c.customer_id  = t.customer_id
       LEFT JOIN transfers tr ON tr.transaction_ref = t.transfer_reference
       LEFT JOIN users     u  ON u.id           = t.assigned_agent_id
       LEFT JOIN users     cb ON cb.id          = t.created_by
       WHERE t.id = ?`,
      [taskId]
    );

    if (assigned_agent_id !== undefined) {
      const newAssigneeId = typeof assigned_agent_id === "number" ? assigned_agent_id : null;
      if (newAssigneeId !== null && newAssigneeId !== oldAssigneeId) {
        notifyAssignee({
          taskId,
          recipientUserId: newAssigneeId,
          actorUserId: auth.id,
          eventType: "reassigned",
        }).catch((err) => console.error("[PATCH /api/todos/:id] notify failed:", err));
      }
    }

    return NextResponse.json(taskRows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/todos/[id]]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
