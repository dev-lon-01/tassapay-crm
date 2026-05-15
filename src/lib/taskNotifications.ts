import { Resend } from "resend";
import { pool } from "@/src/lib/db";
import { sendPushoverAlert } from "@/src/lib/pushover";
import { TaskAssignedEmail } from "@/emails/TaskAssignedEmail";
import type { RowDataPacket } from "mysql2";

const FROM = `${process.env.RESEND_FROM_NAME ?? "TassaPay"} <${process.env.RESEND_FROM_EMAIL ?? "noreply@tassapay.com"}>`;
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://crm.tassapay.com";

export type TaskAssignmentEventType = "assigned" | "reassigned";

export interface TaskAssignmentNotificationInput {
  taskId: number;
  recipientUserId: number;
  actorUserId: number;
  eventType: TaskAssignmentEventType;
}

interface RecipientRow extends RowDataPacket {
  id: number;
  name: string | null;
  email: string | null;
  pushover_user_key: string | null;
  notify_task_assignment_pushover: number;
  notify_task_assignment_email: number;
  notify_self_assignments: number;
}

interface ActorRow extends RowDataPacket {
  name: string | null;
}

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  transfer_reference: string | null;
  customer_name: string | null;
  customer_id: string;
}

function firstName(full: string | null): string {
  if (!full) return "there";
  return full.split(/\s+/)[0] || "there";
}

export async function notifyAssignee(input: TaskAssignmentNotificationInput): Promise<void> {
  const { taskId, recipientUserId, actorUserId, eventType } = input;

  try {
  const [recipRows] = await pool.execute<RecipientRow[]>(
    `SELECT id, name, email, pushover_user_key,
            notify_task_assignment_pushover,
            notify_task_assignment_email,
            notify_self_assignments
     FROM users WHERE id = ? LIMIT 1`,
    [recipientUserId]
  );
  const recipient = recipRows[0];
  if (!recipient) {
    console.warn(`[notifyAssignee] recipient user ${recipientUserId} not found`);
    return;
  }

  if (recipientUserId === actorUserId && recipient.notify_self_assignments === 0) {
    return;
  }

  const [actorRows] = await pool.execute<ActorRow[]>(
    `SELECT name FROM users WHERE id = ? LIMIT 1`,
    [actorUserId]
  );
  const actorName = actorRows[0]?.name ?? "A teammate";

  const [taskRows] = await pool.execute<TaskRow[]>(
    `SELECT t.id, t.title, t.description, t.category, t.priority,
            t.transfer_reference, t.customer_id,
            c.full_name AS customer_name
     FROM tasks t
     LEFT JOIN customers c ON c.customer_id = t.customer_id
     WHERE t.id = ? LIMIT 1`,
    [taskId]
  );
  const task = taskRows[0];
  if (!task) {
    console.warn(`[notifyAssignee] task ${taskId} not found`);
    return;
  }

  const taskUrl = `${APP_BASE_URL}/to-do?taskId=${task.id}`;
  const customerLabel = task.customer_name ?? task.customer_id;
  const verb = eventType === "reassigned" ? "Reassigned" : "New";
  const pushoverTitle = `${verb} task: ${task.title}`.slice(0, 80);
  const pushoverMessage = `${customerLabel} — ${task.priority} — assigned by ${actorName}`;

  const pushoverEnabled =
    recipient.notify_task_assignment_pushover === 1 &&
    !!recipient.pushover_user_key;
  const emailEnabled =
    recipient.notify_task_assignment_email === 1 &&
    !!recipient.email;

  const jobs: Promise<unknown>[] = [];

  if (pushoverEnabled && recipient.pushover_user_key) {
    jobs.push(
      sendPushoverAlert(
        [recipient.pushover_user_key],
        pushoverMessage,
        pushoverTitle,
        0,
        "pushover",
        taskUrl,
        "Open task"
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[notifyAssignee] pushover failed for user ${recipientUserId}: ${msg}`);
      })
    );
  }

  if (emailEnabled && recipient.email) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(`[notifyAssignee] RESEND_API_KEY missing — skipping email for user ${recipientUserId}`);
    } else {
      const resend = new Resend(apiKey);
      jobs.push(
        resend.emails
          .send({
            from: FROM,
            to: recipient.email,
            subject: `${verb} task: ${task.title}`,
            react: TaskAssignedEmail({
              recipientFirstName: firstName(recipient.name),
              actorName,
              taskTitle: task.title,
              taskDescription: task.description,
              category: task.category,
              priority: task.priority,
              customerName: customerLabel,
              transferReference: task.transfer_reference,
              taskUrl,
            }),
          })
          .then((res) => {
            if (res.error) {
              console.error(`[notifyAssignee] email send error for user ${recipientUserId}:`, res.error);
            }
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[notifyAssignee] email failed for user ${recipientUserId}: ${msg}`);
          })
      );
    }
  }

  await Promise.all(jobs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notifyAssignee] unexpected error for task ${taskId} / user ${recipientUserId}: ${msg}`);
  }
}
