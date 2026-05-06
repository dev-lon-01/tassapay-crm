import { pool } from "@/src/lib/db";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { findCustomerIdByPhone } from "@/src/lib/voiceCallState";
import { publish } from "@/src/lib/realtime/bus";
import { REALTIME_EVENTS } from "@/src/lib/realtime/events";
import { getWhatsAppConfig } from "./config";
import { getMediaMetadata, downloadMedia } from "./client";
import { saveMedia } from "./storage";
import type { WhatsAppMessage, WhatsAppValue } from "./types";

interface ProcessResult {
  handled: boolean;
  reason?: string;
}

function extractContent(msg: WhatsAppMessage): {
  body: string | null;
  mediaId: string | null;
} {
  switch (msg.type) {
    case "text":
      return { body: msg.text?.body ?? null, mediaId: null };
    case "image":
      return { body: msg.image?.caption ?? null, mediaId: msg.image?.id ?? null };
    case "document":
      return {
        body: msg.document?.caption ?? msg.document?.filename ?? null,
        mediaId: msg.document?.id ?? null,
      };
    case "audio":
      return { body: null, mediaId: msg.audio?.id ?? null };
    case "video":
      return { body: msg.video?.caption ?? null, mediaId: msg.video?.id ?? null };
    case "sticker":
      return { body: "[sticker]", mediaId: msg.sticker?.id ?? null };
    default:
      return { body: `[${msg.type}]`, mediaId: null };
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: string })?.code === "ER_DUP_ENTRY";
}

export async function processIncomingMessage(
  msg: WhatsAppMessage,
  _value: WhatsAppValue
): Promise<ProcessResult> {
  const wamid = msg.id;
  const from = msg.from;

  // Pre-check for duplicates
  const [dupRows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM task_comments WHERE external_message_id = ? LIMIT 1`,
    [wamid]
  );
  if (dupRows.length > 0) return { handled: true, reason: "duplicate-comment" };
  const [dupInbox] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM whatsapp_inbox WHERE wamid = ? LIMIT 1`,
    [wamid]
  );
  if (dupInbox.length > 0) return { handled: true, reason: "duplicate-inbox" };

  const { body, mediaId } = extractContent(msg);

  // Best-effort media download. If it fails, still log the message.
  let mediaUrl: string | null = null;
  if (mediaId) {
    try {
      const meta = await getMediaMetadata(mediaId);
      const dl = await downloadMedia(meta.url);
      const saved = saveMedia(wamid, dl.buffer, meta.mime_type ?? dl.mimeType);
      mediaUrl = saved.servedUrl;
    } catch (err) {
      console.error("[whatsapp ingest] media download failed", wamid, err);
    }
  }

  const customerId = await findCustomerIdByPhone(`+${from}`);

  if (!customerId) {
    try {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO whatsapp_inbox (wamid, from_phone, message_type, body, media_url, raw_payload)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [wamid, from, msg.type, body, mediaUrl, JSON.stringify(msg)]
      );
      publish(REALTIME_EVENTS.WHATSAPP_UNLINKED, {
        wamid,
        from,
        body,
        mediaUrl,
        messageType: msg.type,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
    return { handled: true, reason: "unlinked" };
  }

  const cfg = getWhatsAppConfig();
  if (!cfg.systemUserId) {
    console.error("[whatsapp ingest] SYSTEM_USER_ID env var not set; cannot create task");
    return { handled: false, reason: "no-system-user" };
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
    const titlePreview = (body ?? `[${msg.type}]`).slice(0, 200);
    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO tasks (customer_id, title, category, priority, status, created_by)
       VALUES (?, ?, 'Query', 'Medium', 'Open', ?)`,
      [customerId, `WhatsApp: ${titlePreview}`, cfg.systemUserId]
    );
    taskId = ins.insertId;
  }

  try {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO task_comments
         (task_id, agent_id, comment, kind, source, media_url, external_message_id)
       VALUES (?, NULL, ?, 'user', 'WhatsApp', ?, ?)`,
      [taskId, body ?? `[${msg.type}]`, mediaUrl, wamid]
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }

  publish(REALTIME_EVENTS.WHATSAPP_MESSAGE, {
    wamid,
    customerId,
    taskId,
    body,
    mediaUrl,
    from,
    messageType: msg.type,
  });

  return { handled: true, reason: "matched" };
}
