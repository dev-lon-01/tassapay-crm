#!/usr/bin/env node
/**
 * Automation worker -- runs on a cron schedule (e.g. every hour).
 *
 * Fetches active rules from `automation_rules`, executes the hardcoded
 * logic for each trigger_key, and logs every send to `communications_log`
 * so the same user never receives the same rule email twice.
 *
 * Usage:  node scripts/automation-worker.js
 */
const path = require("path");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// Polyfill fetch/Headers for Node 16 (Resend SDK needs them)
if (typeof globalThis.fetch === "undefined") {
  const nodeFetch = require("node-fetch");
  globalThis.fetch = nodeFetch.default || nodeFetch;
  globalThis.Headers = nodeFetch.Headers;
  globalThis.Request = nodeFetch.Request;
  globalThis.Response = nodeFetch.Response;
}

// Dynamic import for ESM-only Resend SDK
let Resend;

async function initResend() {
  const mod = await import("resend");
  Resend = mod.Resend;
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const ACTIVE_RULES_SQL = `
  SELECT * FROM automation_rules WHERE is_active = TRUE
`;

/**
 * NUDGE_FIRST_TRANSFER:
 * Users who registered > delay_hours ago, have 0 transfers,
 * and have NOT already been sent this rule.
 */
const NUDGE_FIRST_TRANSFER_SQL = `
  SELECT
    c.id   AS internal_id,
    c.customer_id,
    c.email,
    c.full_name,
    c.assigned_user_id
  FROM customers c
  LEFT JOIN transfers t
    ON t.customer_id = c.customer_id
  LEFT JOIN communications_log cl
    ON cl.customer_id = c.id AND cl.rule_id = ?
  WHERE c.registration_date <= DATE_SUB(NOW(), INTERVAL ? HOUR)
    AND c.email IS NOT NULL
    AND c.email != ''
    AND t.id IS NULL
    AND cl.id IS NULL
`;

const INSERT_LOG_SQL = `
  INSERT IGNORE INTO communications_log (id, customer_id, rule_id) VALUES (?, ?, ?)
`;

// ─── email helpers ────────────────────────────────────────────────────────────

function buildFrom(agentName) {
  const name = agentName ?? process.env.RESEND_FROM_NAME ?? "TassaPay";
  const email = process.env.RESEND_FROM_EMAIL ?? "noreply@tassapay.com";
  return `${name} <${email}>`;
}

async function sendEmail(resend, { to, from, subject, templateId, customerName }) {
  // For now all templates use a simple HTML body.
  // When react-email templates are wired up, switch on templateId.
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 16px">${subject}</h2>
      <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 24px">
        Hi ${customerName || "there"},<br><br>
        We noticed you haven't made your first transfer yet.
        Getting started is quick and easy -- and your first transfer is free!
      </p>
      <a href="https://app.tassapay.com" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Make Your First Transfer
      </a>
      <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">
        If you have any questions, just reply to this email.
      </p>
    </div>
  `;

  const { error } = await resend.emails.send({ from, to: [to], subject, html });
  if (error) {
    throw new Error(error.message);
  }
}

// ─── rule handlers ────────────────────────────────────────────────────────────

async function handleNudgeFirstTransfer(pool, resend, rule) {
  const [users] = await pool.execute(NUDGE_FIRST_TRANSFER_SQL, [
    rule.id,
    rule.delay_hours,
  ]);

  if (users.length === 0) {
    console.log(`  [${rule.trigger_key}] No eligible users found.`);
    return 0;
  }

  console.log(`  [${rule.trigger_key}] ${users.length} eligible user(s) found.`);

  // Pre-fetch agent names for dynamic sender
  const agentIds = [...new Set(users.map((u) => u.assigned_user_id).filter(Boolean))];
  const agentMap = new Map();
  if (agentIds.length > 0) {
    const placeholders = agentIds.map(() => "?").join(",");
    const [agents] = await pool.execute(
      `SELECT id, name FROM users WHERE id IN (${placeholders})`,
      agentIds
    );
    for (const a of agents) agentMap.set(a.id, a.name);
  }

  let sent = 0;
  for (const user of users) {
    const logId = crypto.randomUUID();
    const agentName = agentMap.get(user.assigned_user_id) || null;
    const from = buildFrom(agentName);

    try {
      await sendEmail(resend, {
        to: user.email,
        from,
        subject: rule.email_subject,
        templateId: rule.email_template_id,
        customerName: user.full_name,
      });

      // Immediately log so we never double-send
      await pool.execute(INSERT_LOG_SQL, [logId, user.internal_id, rule.id]);
      sent += 1;
      console.log(`    Sent to ${user.email} (from: ${agentName || "default"})`);
    } catch (err) {
      console.error(`    Failed for ${user.email}: ${err.message}`);
    }

    // Rate limit: 2 requests/sec max for Resend API
    await new Promise((r) => setTimeout(r, 600));
  }

  return sent;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "tassapay_crm",
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    const [rules] = await pool.execute(ACTIVE_RULES_SQL);

    if (rules.length === 0) {
      console.log("[automation] No active rules. Exiting.");
      return;
    }

    // Only load Resend when we actually have rules to process
    await initResend();
    const resend = new Resend(process.env.RESEND_API_KEY);

    console.log(`[automation] ${rules.length} active rule(s) found.`);

    for (const rule of rules) {
      console.log(`[automation] Processing: ${rule.rule_name} (${rule.trigger_key})`);

      switch (rule.trigger_key) {
        case "NUDGE_FIRST_TRANSFER": {
          const sent = await handleNudgeFirstTransfer(pool, resend, rule);
          console.log(`  => ${sent} email(s) sent.`);
          break;
        }
        default:
          console.warn(`  [WARN] Unknown trigger_key: ${rule.trigger_key} -- skipping.`);
      }
    }
  } finally {
    await pool.end();
  }

  console.log("[automation] Done.");
}

run().catch((err) => {
  console.error("[automation] Worker failed:", err.message);
  process.exit(1);
});
