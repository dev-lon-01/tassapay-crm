/**
 * scripts/sla-alert-worker.mjs
 *
 * Standalone cron worker — runs independently of the Next.js dev/prod server.
 * Checks for SLA-breached Somalia transfers every 5 minutes and fires alerts.
 *
 * Usage:
 *   node scripts/sla-alert-worker.mjs
 *
 * In production, run this alongside the Next.js process, e.g. via PM2:
 *   pm2 start scripts/sla-alert-worker.mjs --name sla-worker
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import https from "https";
const require = createRequire(import.meta.url);

// ── Load .env.local ───────────────────────────────────────────────────────────
const envLines = readFileSync(".env.local", "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [key, ...rest] = trimmed.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

// ── Imports (CJS interop) ─────────────────────────────────────────────────────
const cron   = require("node-cron");
const twilio = require("twilio");
const sgMail = require("@sendgrid/mail");
const mysql  = require("mysql2/promise");

// ── DB pool ───────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST     ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME     ?? "tassapay_crm",
  waitForConnections: true,
  connectionLimit:    5,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildMessage(t) {
  return (
    `🚨 TassaPay URGENT: Somalia transfer delayed. ` +
    `Ref: ${t.transaction_ref}. ` +
    `Amount: ${t.send_amount ?? "?"} ${t.send_currency ?? ""}. ` +
    `Please check QA Dashboard.`
  );
}

function splitList(raw) {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── Core engine ───────────────────────────────────────────────────────────────
async function checkAndFireSlaAlerts() {
  const [lateTransfers] = await pool.execute(
    `SELECT id, transaction_ref, send_amount, send_currency
     FROM   transfers
     WHERE  destination_country = 'Somalia'
       AND  status NOT IN ('Completed', 'Deposited', 'Cancel')
       AND  created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       AND  sla_alert_sent_at IS NULL`
  );

  if (!lateTransfers.length) {
    console.log(`[SLA ${new Date().toISOString()}] No late transfers found.`);
    return;
  }

  console.log(`[SLA ${new Date().toISOString()}] ${lateTransfers.length} late transfer(s) found.`);

  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  // Collect transfers per pushover routing key for a single summary push at end
  const pushoverSummaries = new Map(); // routingKey → { routing, transfers[] }

  for (const transfer of lateTransfers) {
    if (!transfer.send_currency) continue;

    const [routingRows] = await pool.execute(
      `SELECT alert_emails, alert_phones, pushover_sound, pushover_priority
       FROM   alert_routings
       WHERE  destination_country = 'Somalia'
         AND  source_currency = ?
         AND  is_active = 1
       LIMIT 1`,
      [transfer.send_currency]
    );

    if (!routingRows.length) {
      console.log(`[SLA] No active rule for currency ${transfer.send_currency} — skipping ${transfer.transaction_ref}`);
      continue;
    }

    const routing  = routingRows[0];
    const message  = buildMessage(transfer);
    const phones   = splitList(routing.alert_phones);
    const emails   = splitList(routing.alert_emails);
    const promises = [];

    for (const phone of phones) {
      promises.push(
        twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_FROM_NUMBER,
          to:   phone,
        }).catch((err) =>
          console.error(`[SLA] SMS to ${phone} failed:`, err.message)
        )
      );
    }

    for (const email of emails) {
      promises.push(
        sgMail.send({
          to:      email,
          from:    { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME ?? "TassaPay" },
          subject: `🚨 Urgent: Somalia Transfer Delayed — ${transfer.transaction_ref}`,
          text:    message,
        }).catch((err) =>
          console.error(`[SLA] Email to ${email} failed:`, err.message)
        )
      );
    }

    await Promise.all(promises);

    // Spam lock — stamp immediately after dispatch
    await pool.execute(
      "UPDATE transfers SET sla_alert_sent_at = NOW() WHERE id = ?",
      [transfer.id]
    );

    console.log(
      `[SLA] ✓ Alert fired: ${transfer.transaction_ref} (${transfer.send_currency}) → ${phones.length} SMS, ${emails.length} email(s)`
    );

    // Collect for single summary Pushover at end of run
    if (process.env.PUSHOVER_USER_KEY) {
      const routingKey = `${routing.pushover_sound}:${routing.pushover_priority}`;
      if (!pushoverSummaries.has(routingKey)) {
        pushoverSummaries.set(routingKey, { routing, transfers: [] });
      }
      pushoverSummaries.get(routingKey).transfers.push(transfer);
    }
  }

  // ── Send one Pushover summary per unique routing ──────────────────────────
  for (const { routing, transfers } of pushoverSummaries.values()) {
    const pushoverKeys = [process.env.PUSHOVER_USER_KEY].filter(Boolean);
    const count    = transfers.length;
    const priority = routing.pushover_priority ?? 0;
    const summaryMsg = count === 1
      ? `🚨 SLA Breach: Transfer ${transfers[0].transaction_ref} is delayed. Amount: ${transfers[0].send_amount ?? "?"} ${transfers[0].send_currency ?? ""}.`
      : `🚨 SLA Breach: ${count} transfers are overdue.\nLatest: ${transfers[0].transaction_ref} (+${count - 1} more).\nPlease check QA Dashboard.`;

    for (const user of pushoverKeys) {
      const pushBody = {
        token:    process.env.PUSHOVER_APP_TOKEN,
        user,
        message:  summaryMsg,
        title:    "TassaPay SLA Breach",
        priority,
        sound:    routing.pushover_sound ?? "pushover",
        ...(priority === 2 ? { retry: 60, expire: 3600 } : {}),
      };
      await new Promise((resolve) => {
        const payload = JSON.stringify(pushBody);
        const req = https.request(
          { hostname: "api.pushover.net", path: "/1/messages.json", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
          (res) => { res.resume(); res.on("end", resolve); }
        );
        req.on("error", (err) => { console.error(`[SLA] Pushover to ${user} failed:`, err.message); resolve(); });
        req.write(payload); req.end();
      });
    }

    console.log(`[SLA] ✓ Pushover summary sent: ${count} transfer(s) → ${pushoverKeys.length} push`);
  }
}

// ── Cron schedule: every 5 minutes ───────────────────────────────────────────
cron.schedule("*/5 * * * *", async () => {
  try {
    await checkAndFireSlaAlerts();
  } catch (err) {
    console.error("[SLA] Fatal error in cron tick:", err);
  }
});

console.log("[SLA Worker] Started — checking every 5 minutes.");

// Run once immediately on startup
checkAndFireSlaAlerts().catch((err) =>
  console.error("[SLA] Startup check failed:", err)
);
