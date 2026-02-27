/**
 * scripts/sync-worker.mjs
 *
 * Unified background worker — runs all sync + alert jobs every 5 minutes in order:
 *   1. Sync customers   (TassaPay backoffice → MySQL customers table)
 *   2. Sync transfers   (TassaPay backoffice → MySQL transfers table)
 *   3. Sync Tayo data   (TayoTransfer API → data_field_id + data_field_status)
 *   4. Fire SLA alerts  (Ready transfers grouped by currency → SMS + email)
 *
 * Usage:
 *   node scripts/sync-worker.mjs
 *
 * PM2:
 *   pm2 start scripts/sync-worker.mjs --name sync-worker
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath  = resolve(__dirname, "../.env.local");
const envLines = readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [key, ...rest] = trimmed.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

// ── CJS imports ───────────────────────────────────────────────────────────────
const cron        = require("node-cron");
const twilio      = require("twilio");
const nodemailer  = require("nodemailer");
const mysql       = require("mysql2/promise");
const fetch   = require("node-fetch");
const { syncLatestTransfers } = require("../src/services/tayoSyncService");

// ── Shared DB pool ────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST     ?? "localhost",
  port:               Number(process.env.DB_PORT ?? 3306),
  user:               process.env.DB_USER     ?? "root",
  password:           process.env.DB_PASSWORD ?? "",
  database:           process.env.DB_NAME     ?? "tassapay_crm",
  waitForConnections: true,
  connectionLimit:    5,
});

// ── Backoffice API constants ──────────────────────────────────────────────────
const BASE    = "https://tassapay.co.uk/backoffice";
const HEADERS = {
  accept:              "*/*",
  "cache-control":     "no-cache",
  origin:              "https://tassapay.co.uk",
  "user-agent":        "Mozilla/5.0",
  "x-requested-with": "XMLHttpRequest",
};

// ── Utility helpers ───────────────────────────────────────────────────────────
function fmtDate(d) {
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

/** Returns the last 2 days as a DD/MM/YYYY date range for fast recurring syncs. */
function getRecentDateRange() {
  const today = new Date();
  const from  = new Date();
  from.setDate(from.getDate() - 2);
  return { fromdate: fmtDate(from), todate: fmtDate(today) };
}

function parseSetCookies(headers) {
  const r = [];
  headers.forEach((v, n) => {
    if (n.toLowerCase() === "set-cookie") r.push(v.split(";")[0].trim());
  });
  return r;
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function stripHtml(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

function parseDateField(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim().replace(/\s+/, " ");
  const [datePart, timePart] = s.split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${timePart ?? "00:00:00"}`;
}

function splitList(raw) {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── TassaPay Backoffice Login ─────────────────────────────────────────────────
async function loginToBackoffice() {
  const lr = await fetch(`${BASE}/LoginHandler.ashx?Task=1`, {
    method:  "POST",
    headers: { ...HEADERS, "content-type": "application/json; charset=UTF-8", referer: "https://tassapay.co.uk/backoffice/login" },
    body: JSON.stringify({ Param: [{
      username:    process.env.TASSAPAY_USERNAME,
      password:    process.env.TASSAPAY_PASSWORD,
      BranchKey:   process.env.TASSAPAY_BRANCH_KEY,
      reCaptcha:   "",
      remcondition: true,
    }] }),
  });
  const ld = (await lr.json())[0];
  if (ld.Status !== "0") throw new Error(`TassaPay login failed: ${ld.ErrorMessage}`);

  const cookieHeader = [
    `username=${encodeURIComponent(ld.E_User_Nm)}`,
    `password=${encodeURIComponent(ld.E_Password)}`,
    `mtsbranchkey=${encodeURIComponent(ld.E_Branch_key)}`,
    "remember=true", "Till_ID=0",
    ...parseSetCookies(lr.headers),
  ].join("; ");

  return { ld, cookieHeader };
}

// ── sync_log helper ─────────────────────────────────────────────────────────
async function logStart(type) {
  const [r] = await pool.execute(
    "INSERT INTO sync_log (started_at, type, status) VALUES (NOW(), ?, 'running')",
    [type]
  );
  return r.insertId;
}
async function logDone(id, fetched, inserted, updated) {
  await pool.execute(
    "UPDATE sync_log SET finished_at=NOW(), records_fetched=?, records_inserted=?, records_updated=?, status='success' WHERE id=?",
    [fetched, inserted, updated, id]
  );
}
async function logError(id, err) {
  await pool.execute(
    "UPDATE sync_log SET finished_at=NOW(), status='error', error_message=? WHERE id=?",
    [String(err), id]
  );
}

// ── Step 1: Sync Customers ────────────────────────────────────────────────────
async function syncCustomers() {
  const { fromdate, todate } = getRecentDateRange();
  console.log(`[Customers] Syncing ${fromdate} → ${todate}`);
  const logId = await logStart('customers');

  const { ld, cookieHeader } = await loginToBackoffice();

  const sr = await fetch(`${BASE}/CustomerHandler.ashx/?Task=search`, {
    method:  "POST",
    headers: { ...HEADERS, "content-type": "application/json;", referer: "https://tassapay.co.uk/backoffice/customers", cookie: cookieHeader },
    body: JSON.stringify({ Param: [{
      Chk_Date: "false", latest_id: "1", CustomerName: "", WireTransfer_ReferanceNo: "",
      Email_ID: "", Post_Code: "", Mobile_Number: "", BlackList: "-1", Delete_Status: null,
      File_Ref: "", Branch_ID: -1, Client_ID: ld.Client_ID, User_ID: ld.User_ID,
      Username: ld.Name, id_verification_status: "-1", Risk_Level: "-1",
      fromdate, todate, C_User_ID: -1, ApplyUserFilter: 0, Sourse_of_Registration: "",
      Sender_DateOfBirth: "", agent_branch: ld.Agent_branch ?? "1", CommentPriority: "-1",
    }] }),
  });
  const customers = await sr.json();
  if (!Array.isArray(customers)) throw new Error(`[Customers] Unexpected response: ${JSON.stringify(customers).slice(0, 100)}`);

  const UPSERT_SQL = `
    INSERT INTO customers
      (customer_id, full_name, email, phone_number, country,
       registration_date, kyc_completion_date, risk_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      full_name           = VALUES(full_name),
      email               = VALUES(email),
      phone_number        = VALUES(phone_number),
      country             = VALUES(country),
      registration_date   = VALUES(registration_date),
      kyc_completion_date = VALUES(kyc_completion_date),
      risk_status         = VALUES(risk_status),
      synced_at           = CURRENT_TIMESTAMP
  `;

  const conn = await pool.getConnection();
  let inserted = 0, updated = 0;
  try {
    for (const c of customers) {
      if (!c.Customer_ID) continue;
      const [res] = await conn.execute(UPSERT_SQL, [
        c.Customer_ID,
        str(c.Full_Name),
        str(c.Email_ID),
        str(c.Mobile_Number1),
        str(c.sender_country),
        parseDateField(c.Record_Insert_DateTime2),
        parseDateField(c.Record_Insert_DateTime),
        str(c.Risk_status),
      ]);
      if (res.affectedRows === 1) inserted++;
      else if (res.affectedRows === 2) updated++;
    }
    await logDone(logId, customers.length, inserted, updated);
  } catch (err) {
    await logError(logId, err);
    throw err;
  } finally {
    conn.release();
  }

  console.log(`[Customers] Done — ${customers.length} fetched, ${inserted} new, ${updated} updated`);
}

// ── Step 2: Sync Transfers ────────────────────────────────────────────────────
async function syncTransfers() {
  const { fromdate, todate } = getRecentDateRange();
  console.log(`[Transfers] Syncing ${fromdate} → ${todate}`);
  const logId = await logStart('transfers');

  const { ld, cookieHeader } = await loginToBackoffice();

  const sr = await fetch(`${BASE}/Send.ashx/?Task=Transaction_Search`, {
    method:  "POST",
    headers: { ...HEADERS, "content-type": "application/json;", referer: "https://tassapay.co.uk/backoffice/transfer-history", cookie: cookieHeader },
    body: JSON.stringify({ Param: [{
      Chk_Date: "false", ID: -1, Username: ld.Name, User_ID: ld.User_ID,
      UserRole_ID: "1", Client_ID: ld.Client_ID, trn_referenceNo: "", GCCTransactionNo: "",
      WireTransfer_ReferanceNo: "", sender_name: "", Beneficiary_Name: "",
      TrnStatus: -1, payment_type: -1, payment_status: -1,
      Branch_ID1: -1, Branch_ID: -1, CountryId: -1,
      collection_type: -1, delivery_type: -1, user_id_new: -1,
      search_activity: "1", From_View_Transfers: "Yes",
      fromdate, todate,
      Coll_PointId: "-1", agent_branch: ld.Agent_branch ?? "1",
      PinNumber: "", Mobile_Number: "", Sender_DateOfBirth: "",
    }] }),
  });
  const transfers = await sr.json();
  if (!Array.isArray(transfers)) throw new Error(`[Transfers] Unexpected response: ${JSON.stringify(transfers).slice(0, 100)}`);

  const UPSERT_SQL = `
    INSERT INTO transfers
      (customer_id, transaction_ref, created_at,
       send_amount, send_currency,
       receive_amount, receive_currency,
       destination_country, beneficiary_name,
       status, hold_reason,
       payment_method, delivery_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      customer_id         = VALUES(customer_id),
      created_at          = VALUES(created_at),
      send_amount         = VALUES(send_amount),
      send_currency       = VALUES(send_currency),
      receive_amount      = VALUES(receive_amount),
      receive_currency    = VALUES(receive_currency),
      destination_country = VALUES(destination_country),
      beneficiary_name    = VALUES(beneficiary_name),
      status              = VALUES(status),
      hold_reason         = VALUES(hold_reason),
      payment_method      = VALUES(payment_method),
      delivery_method     = VALUES(delivery_method),
      synced_at           = CURRENT_TIMESTAMP
  `;

  const conn = await pool.getConnection();
  let inserted = 0, updated = 0, skipped = 0;
  try {
    for (const t of transfers) {
      if (!t.ReferenceNo || !t.Customer_ID) { skipped++; continue; }
      const [res] = await conn.execute(UPSERT_SQL, [
        String(t.Customer_ID).trim(),
        String(t.ReferenceNo).trim(),
        parseDateField(t.Date1),
        num(t.Totalamount),
        str(t.FromCurrency_Code),
        num(t.Amount_in_other_cur),
        str(t.Currency_Code),
        str(t.Country_Name),
        str(t.Reciever),
        str(t.Tx_Status),
        stripHtml(str(t.LatestCust_Comment)),
        str(t.Ptype),
        str(t.Type_Name),
      ]);
      if (res.affectedRows === 1) inserted++;
      else if (res.affectedRows === 2) updated++;
    }
    await logDone(logId, transfers.length, inserted, updated);
  } catch (err) {
    await logError(logId, err);
    throw err;
  } finally {
    conn.release();
  }

  console.log(`[Transfers] Done — ${transfers.length} fetched, ${inserted} new, ${updated} updated, ${skipped} skipped`);
}

// ── Step 3: Sync TayoTransfer data ───────────────────────────────────────────
async function syncTayo() {
  console.log("[Tayo] Syncing TayoTransfer data...");
  const logId = await logStart('tayo');
  try {
    const result = await syncLatestTransfers(pool);
    await logDone(logId, result.total, 0, result.updated);
    console.log(`[Tayo] Done — ${result.total} EFU records, ${result.updated} transfers updated`);
  } catch (err) {
    await logError(logId, err);
    throw err;
  }
}

// ── Step 4: SLA Alerts ────────────────────────────────────────────────────────
async function checkAndFireSlaAlerts() {
  // Only alert on transfers where TayoTransfer has marked them as Ready
  const [readyTransfers] = await pool.execute(
    `SELECT id, transaction_ref, send_amount, send_currency, data_field_id
     FROM   transfers
     WHERE  data_field_id IS NOT NULL
       AND  data_field_status = 'Ready'
       AND  sla_alert_sent_at IS NULL`
  );

  if (!readyTransfers.length) {
    console.log("[SLA] No ready transfers pending alert.");
    return;
  }

  console.log(`[SLA] ${readyTransfers.length} ready transfer(s) found — grouping by currency`);

  // Group transfers by currency so we send one alert per currency
  const byCurrency = {};
  for (const t of readyTransfers) {
    const cur = t.send_currency ?? "UNKNOWN";
    if (!byCurrency[cur]) byCurrency[cur] = [];
    byCurrency[cur].push(t);
  }

  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const mailer = nodemailer.createTransport({
    host:   process.env.SMTP_HOST     ?? "smtp.mailgun.org",
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  for (const [currency, group] of Object.entries(byCurrency)) {
    const [routingRows] = await pool.execute(
      `SELECT alert_emails, alert_phones
       FROM   alert_routings
       WHERE  destination_country = 'Somalia'
         AND  source_currency = ?
         AND  is_active = 1
       LIMIT 1`,
      [currency]
    );

    if (!routingRows.length) {
      console.log(`[SLA] No active rule for ${currency} — skipping ${group.length} transfer(s)`);
      continue;
    }

    const routing = routingRows[0];
    const phones  = splitList(routing.alert_phones);
    const emails  = splitList(routing.alert_emails);

    if (!phones.length && !emails.length) {
      console.log(`[SLA] Routing rule for ${currency} has no contacts configured — skipping`);
      continue;
    }

    const count   = group.length;
    const refs    = group.map((t) => t.transaction_ref).join(", ");

    const smsBody = `TassaPay: ${count} Somalia ${currency} transfer(s) are ready for payment. Please process these at your earliest convenience.`;

    const emailSubject = `TassaPay: ${count} Somalia ${currency} transfer(s) ready for payment`;
    const emailText = [
      `The following ${currency} transfer(s) to Somalia are marked Ready by TayoTransfer and require processing:`,
      "",
      ...group.map((t) => `  - Ref: ${t.transaction_ref}  |  Amount: ${t.send_amount ?? "?"} ${currency}  |  Tayo Ref: ${t.data_field_id}`),
      "",
      "Please process these at your earliest convenience.",
    ].join("\n");

    const promises = [];

    for (const phone of phones) {
      promises.push(
        twilioClient.messages.create({
          body: smsBody,
          from: process.env.TWILIO_FROM_NUMBER,
          to:   phone,
        }).catch((err) => console.error(`[SLA] SMS to ${phone} failed:`, err.message))
      );
    }

    for (const email of emails) {
      promises.push(
        mailer.sendMail({
          from:    `"${process.env.SMTP_FROM_NAME ?? "TassaPay"}" <${process.env.SMTP_FROM_EMAIL ?? "noreply@tassapay.com"}>`,
          to:      email,
          subject: emailSubject,
          text:    emailText,
        }).catch((err) => console.error(`[SLA] Email to ${email} failed:`, err.message))
      );
    }

    await Promise.all(promises);

    // Only stamp spam lock if at least one alert was dispatched
    if (promises.length > 0) {
      for (const t of group) {
        await pool.execute(
          "UPDATE transfers SET sla_alert_sent_at = NOW() WHERE id = ?",
          [t.id]
        );
      }
      console.log(`[SLA] Alerted: ${count} ${currency} transfer(s) — ${phones.length} SMS, ${emails.length} email(s)`);
    } else {
      console.log(`[SLA] No alerts dispatched for ${currency} — spam lock not applied`);
    }
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function runAllSyncs() {
  console.log(`\n[Sync Worker] === Run started ${new Date().toISOString()} ===`);
  const start = Date.now();

  const steps = [
    { name: "Customers",  fn: syncCustomers },
    { name: "Transfers",  fn: syncTransfers },
    { name: "Tayo",       fn: syncTayo },
    { name: "SLA Alerts", fn: checkAndFireSlaAlerts },
  ];

  for (const step of steps) {
    try {
      await step.fn();
    } catch (err) {
      console.error(`[Sync Worker] ${step.name} step failed:`, err.message ?? err);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Sync Worker] === Done in ${elapsed}s ===\n`);
}

// ── Cron: every 5 minutes ─────────────────────────────────────────────────────
cron.schedule("*/5 * * * *", async () => {
  try {
    await runAllSyncs();
  } catch (err) {
    console.error("[Sync Worker] Fatal error in cron tick:", err);
  }
});

console.log("[Sync Worker] Started — running every 5 minutes.");
console.log("[Sync Worker] Running initial sync now...\n");

// Run immediately on startup
runAllSyncs().catch((err) => console.error("[Sync Worker] Startup run failed:", err));
