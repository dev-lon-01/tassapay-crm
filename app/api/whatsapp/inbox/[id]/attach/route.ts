import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { pool } from "@/src/lib/db";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { publish } from "@/src/lib/realtime/bus";
import { REALTIME_EVENTS } from "@/src/lib/realtime/events";

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: string })?.code === "ER_DUP_ENTRY";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { customer_id?: string };
  const customerId =
    typeof body.customer_id === "string" ? body.customer_id.trim() : "";
  if (!customerId) {
    return NextResponse.json(
      { error: "customer_id is required" },
      { status: 400 }
    );
  }

  const [inboxRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, wamid, from_phone, message_type, body, media_url, attached_task_id
     FROM whatsapp_inbox WHERE id = ? LIMIT 1`,
    [id]
  );
  if (inboxRows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const row = inboxRows[0];
  if (row.attached_task_id) {
    return NextResponse.json({
      ok: true,
      taskId: Number(row.attached_task_id),
      alreadyAttached: true,
    });
  }

  const [taskRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM tasks
     WHERE customer_id = ? AND status IN ('Open','In_Progress')
     ORDER BY created_at DESC LIMIT 1`,
    [customerId]
  );

  let taskId: number;
  if (taskRows.length > 0) {
    taskId = Number(taskRows[0].id);
  } else {
    const titlePreview = String(row.body ?? `[${row.message_type}]`).slice(0, 200);
    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO tasks (customer_id, title, category, priority, status, created_by)
       VALUES (?, ?, 'Query', 'Medium', 'Open', ?)`,
      [customerId, `WhatsApp: ${titlePreview}`, auth.id]
    );
    taskId = ins.insertId;
  }

  try {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO task_comments
         (task_id, agent_id, comment, kind, source, media_url, external_message_id)
       VALUES (?, NULL, ?, 'user', 'WhatsApp', ?, ?)`,
      [
        taskId,
        row.body ?? `[${row.message_type}]`,
        row.media_url,
        row.wamid,
      ]
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }

  await pool.execute(
    `UPDATE whatsapp_inbox
        SET attached_task_id = ?, attached_at = NOW(), attached_by = ?
      WHERE id = ?`,
    [taskId, auth.id, id]
  );

  publish(REALTIME_EVENTS.WHATSAPP_MESSAGE, {
    wamid: row.wamid,
    customerId,
    taskId,
    body: row.body,
    mediaUrl: row.media_url,
    from: row.from_phone,
    attached: true,
  });

  return NextResponse.json({ ok: true, taskId });
}
