/**
 * src/services/slaAlertService.ts
 *
 * SLA breach detection and alert dispatch for Somalia transfers.
 *
 * Triggers on any Somalia transfer that:
 *   – is NOT in a terminal state (Completed / Deposited / Cancel)
 *   – was created more than 15 minutes ago
 *   – has NOT already triggered an alert (sla_alert_sent_at IS NULL)
 *
 * For each late transfer, it looks up the matching alert_routings rule
 * (keyed on send_currency) and fires Twilio SMS + SendGrid emails.
 * Immediately after dispatch, sla_alert_sent_at is stamped to prevent
 * duplicate alerts (spam lock).
 */

import twilio from "twilio";
import sgMail from "@sendgrid/mail";
import { pool } from "@/src/lib/db";
import { sendPushoverAlert } from "@/src/lib/pushover";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

// ─── types ────────────────────────────────────────────────────────────────────

interface LateTransfer extends RowDataPacket {
  id: number;
  transaction_ref: string;
  send_amount: number | null;
  send_currency: string | null;
  destination_country: string | null;
}

interface AlertRouting extends RowDataPacket {
  id: number;
  alert_emails: string | null;
  alert_phones: string | null;
  pushover_sound: string;
  pushover_priority: number;
  pushover_enabled: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildMessage(t: LateTransfer): string {
  return (
    `🚨 TassaPay URGENT: Somalia transfer delayed. ` +
    `Ref: ${t.transaction_ref}. ` +
    `Amount: ${t.send_amount ?? "?"} ${t.send_currency ?? ""}. ` +
    `Please check QA Dashboard.`
  );
}

function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── main engine ──────────────────────────────────────────────────────────────

export async function checkAndFireSlaAlerts(): Promise<void> {
  // ── 1. Find late Somalia transfers that haven't fired an alert yet ────────
  const [lateTransfers] = await pool.execute<LateTransfer[]>(
    `SELECT id, transaction_ref, send_amount, send_currency, destination_country
     FROM   transfers
     WHERE  destination_country = 'Somalia'
       AND  status NOT IN ('Completed', 'Deposited', 'Cancel')
       AND  created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       AND  sla_alert_sent_at IS NULL`
  );

  if (!lateTransfers.length) return;

  // Initialise clients once
  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  );
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

  for (const transfer of lateTransfers) {
    if (!transfer.send_currency) continue;

    // ── 2. Find the active routing rule for this currency ──────────────────
    const [routingRows] = await pool.execute<AlertRouting[]>(
      `SELECT id, alert_emails, alert_phones, pushover_sound, pushover_priority, pushover_enabled
       FROM   alert_routings
       WHERE  destination_country = 'Somalia'
         AND  source_currency = ?
         AND  is_active = 1
       LIMIT 1`,
      [transfer.send_currency]
    );

    if (!routingRows.length) continue; // no rule configured → skip

    const routing = routingRows[0];
    const message = buildMessage(transfer);
    const phones  = splitList(routing.alert_phones);
    const emails  = splitList(routing.alert_emails);

    const dispatchPromises: Promise<unknown>[] = [];

    // ── 3a. Twilio SMS ─────────────────────────────────────────────────────
    for (const phone of phones) {
      dispatchPromises.push(
        twilioClient.messages
          .create({
            body: message,
            from: process.env.TWILIO_FROM_NUMBER!,
            to: phone,
          })
          .catch((err: Error) =>
            console.error(
              `[SLA] SMS to ${phone} for ${transfer.transaction_ref} failed:`,
              err.message
            )
          )
      );
    }

    // ── 3b. SendGrid emails ────────────────────────────────────────────────
    for (const email of emails) {
      dispatchPromises.push(
        sgMail
          .send({
            to: email,
            from: {
              email: process.env.SENDGRID_FROM_EMAIL!,
              name:  process.env.SENDGRID_FROM_NAME ?? "TassaPay",
            },
            subject: `🚨 Urgent: Somalia Transfer Delayed — ${transfer.transaction_ref}`,
            text: message,
          })
          .catch((err: Error) =>
            console.error(
              `[SLA] Email to ${email} for ${transfer.transaction_ref} failed:`,
              err.message
            )
          )
      );
    }

    // ── 3c. Pushover ───────────────────────────────────────────────────────
    const pushoverUserKey = process.env.PUSHOVER_USER_KEY;
    if (pushoverUserKey && routing.pushover_enabled) {
      const pushoverMsg = `🚨 SLA Breach: Transfer ${transfer.transaction_ref} is delayed. Amount: ${transfer.send_amount ?? "?"} ${transfer.send_currency ?? ""}.`;
      dispatchPromises.push(
        sendPushoverAlert(
          [pushoverUserKey],
          pushoverMsg,
          "TassaPay SLA Breach",
          routing.pushover_priority ?? 0,
          routing.pushover_sound ?? "pushover"
        ).catch((err: Error) =>
          console.error(
            `[SLA] Pushover for ${transfer.transaction_ref} failed:`,
            err.message
          )
        )
      );
    }

    // Fire all dispatches concurrently, then stamp the spam lock
    await Promise.all(dispatchPromises);

    // ── 4. Spam lock: stamp sla_alert_sent_at immediately after dispatch ───
    await pool.execute<ResultSetHeader>(
      "UPDATE transfers SET sla_alert_sent_at = NOW() WHERE id = ?",
      [transfer.id]
    );

    console.log(
      `[SLA] Alert fired for ${transfer.transaction_ref} ` +
      `(${transfer.send_currency}) → ${phones.length} SMS, ${emails.length} email(s), ${process.env.PUSHOVER_USER_KEY ? 1 : 0} push`
    );
  }
}
