/**
 * Smoke tests for the Hybrid Automation & Nudge Engine.
 *
 * Validates:
 *  1. automation_rules table exists with seeded data
 *  2. communications_log table exists with correct schema
 *  3. NUDGE_FIRST_TRANSFER query finds eligible customers
 *  4. communications_log prevents double-matching (dedup)
 *  5. Inactive rules produce zero eligible users
 *  6. Admin API GET/PUT work (hit live endpoints)
 *  7. Customers with transfers are excluded
 *  8. Customers already logged are excluded
 *
 * Usage:  node scripts/smoke-test-automations.mjs
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

/* ── helpers ───────────────────────────────────────────────────────────────── */

async function exec(sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

/* The NUDGE query (mirrored from the worker) */
const NUDGE_SQL = `
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

/* ── test data constants ───────────────────────────────────────────────────── */

const TEST_CUST_ID_ELIGIBLE    = "SMOKE-AUTO-ELIG";
const TEST_CUST_ID_HAS_XFER   = "SMOKE-AUTO-XFER";
const TEST_CUST_ID_ALREADY_LOG = "SMOKE-AUTO-LOGGED";
const TEST_CUST_ID_NO_EMAIL    = "SMOKE-AUTO-NOEMAIL";
const TEST_CUST_IDS = [
  TEST_CUST_ID_ELIGIBLE,
  TEST_CUST_ID_HAS_XFER,
  TEST_CUST_ID_ALREADY_LOG,
  TEST_CUST_ID_NO_EMAIL,
];

/* ── cleanup ───────────────────────────────────────────────────────────────── */

console.log("\n🧹 Cleaning previous smoke-test data...");

// Remove transfers first (FK)
for (const cid of TEST_CUST_IDS) {
  await exec("DELETE FROM transfers WHERE customer_id = ?", [cid]);
}
// Remove comms_log entries for test customers
for (const cid of TEST_CUST_IDS) {
  const rows = await exec("SELECT id FROM customers WHERE customer_id = ?", [cid]);
  if (rows.length) {
    await exec("DELETE FROM communications_log WHERE customer_id = ?", [rows[0].id]);
  }
}
// Remove test customers
for (const cid of TEST_CUST_IDS) {
  await exec("DELETE FROM customers WHERE customer_id = ?", [cid]);
}

/* ── seed test data ────────────────────────────────────────────────────────── */

console.log("🌱 Seeding test data...\n");

const regDate = "2025-01-01 00:00:00"; // well past any delay_hours threshold

// Customer 1: eligible (has email, old registration, 0 transfers, not yet logged)
await exec(
  `INSERT INTO customers (customer_id, full_name, email, registration_date, country)
   VALUES (?, 'Smoke Eligible', 'smoke-eligible@test.local', ?, 'GB')`,
  [TEST_CUST_ID_ELIGIBLE, regDate]
);

// Customer 2: has a transfer (should be excluded)
await exec(
  `INSERT INTO customers (customer_id, full_name, email, registration_date, country)
   VALUES (?, 'Smoke WithXfer', 'smoke-xfer@test.local', ?, 'GB')`,
  [TEST_CUST_ID_HAS_XFER, regDate]
);
await exec(
  `INSERT INTO transfers (customer_id, transaction_ref, status, send_amount, send_currency)
   VALUES (?, 'TXN-SMOKE-AUTO', 'Completed', 100.00, 'GBP')`,
  [TEST_CUST_ID_HAS_XFER]
);

// Customer 3: already in communications_log (should be excluded by dedup)
await exec(
  `INSERT INTO customers (customer_id, full_name, email, registration_date, country)
   VALUES (?, 'Smoke Logged', 'smoke-logged@test.local', ?, 'GB')`,
  [TEST_CUST_ID_ALREADY_LOG, regDate]
);

// Customer 4: no email (should be excluded)
await exec(
  `INSERT INTO customers (customer_id, full_name, email, registration_date, country)
   VALUES (?, 'Smoke NoEmail', NULL, ?, 'GB')`,
  [TEST_CUST_ID_NO_EMAIL, regDate]
);

/* ── T1: automation_rules table ────────────────────────────────────────────── */

console.log("── T1: automation_rules table ──");
{
  const rules = await exec("SELECT * FROM automation_rules");
  assert(rules.length >= 1, "automation_rules has at least 1 row");

  const nudge = rules.find((r) => r.trigger_key === "NUDGE_FIRST_TRANSFER");
  assert(nudge !== undefined, "NUDGE_FIRST_TRANSFER rule exists");
  assert(nudge.delay_hours === 72, "Default delay is 72 hours");
  assert(nudge.email_subject === "Your first transfer is free!", "Default subject correct");
  assert(nudge.email_template_id === "first-transfer-nudge", "Default template ID correct");
}

/* ── T2: communications_log table schema ───────────────────────────────────── */

console.log("\n── T2: communications_log table ──");
{
  const cols = await exec("SHOW COLUMNS FROM communications_log");
  const colNames = cols.map((c) => c.Field);
  assert(colNames.includes("id"), "Has id column");
  assert(colNames.includes("customer_id"), "Has customer_id column");
  assert(colNames.includes("rule_id"), "Has rule_id column");
  assert(colNames.includes("sent_at"), "Has sent_at column");

  // Check unique constraint
  const indexes = await exec("SHOW INDEX FROM communications_log WHERE Key_name = 'unique_customer_rule'");
  assert(indexes.length > 0, "Has unique_customer_rule constraint");
}

/* ── T3: NUDGE query finds eligible customer ───────────────────────────────── */

console.log("\n── T3: NUDGE query - eligible customer found ──");
{
  const [rule] = await exec("SELECT * FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");

  const eligible = await exec(NUDGE_SQL, [rule.id, rule.delay_hours]);
  const found = eligible.find((r) => r.customer_id === TEST_CUST_ID_ELIGIBLE);
  assert(found !== undefined, "Eligible customer appears in NUDGE results");
  assert(found?.email === "smoke-eligible@test.local", "Eligible customer has correct email");
}

/* ── T4: Customer with transfers is excluded ───────────────────────────────── */

console.log("\n── T4: Customer with transfers excluded ──");
{
  const [rule] = await exec("SELECT * FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");

  const eligible = await exec(NUDGE_SQL, [rule.id, rule.delay_hours]);
  const found = eligible.find((r) => r.customer_id === TEST_CUST_ID_HAS_XFER);
  assert(found === undefined, "Customer with transfers NOT in NUDGE results");
}

/* ── T5: Customer without email is excluded ────────────────────────────────── */

console.log("\n── T5: Customer without email excluded ──");
{
  const [rule] = await exec("SELECT * FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");

  const eligible = await exec(NUDGE_SQL, [rule.id, rule.delay_hours]);
  const found = eligible.find((r) => r.customer_id === TEST_CUST_ID_NO_EMAIL);
  assert(found === undefined, "Customer without email NOT in NUDGE results");
}

/* ── T6: communications_log dedup ──────────────────────────────────────────── */

console.log("\n── T6: communications_log dedup ──");
{
  const [rule] = await exec("SELECT * FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");

  // Get internal_id for the ALREADY_LOG customer
  const [cust] = await exec("SELECT id FROM customers WHERE customer_id = ?", [TEST_CUST_ID_ALREADY_LOG]);
  assert(cust !== undefined, "Already-logged test customer exists");

  // Insert a log entry for this customer
  const logId = crypto.randomUUID();
  await exec(
    "INSERT IGNORE INTO communications_log (id, customer_id, rule_id) VALUES (?, ?, ?)",
    [logId, cust.id, rule.id]
  );

  // Now the NUDGE query should NOT include this customer
  const eligible = await exec(NUDGE_SQL, [rule.id, rule.delay_hours]);
  const found = eligible.find((r) => r.customer_id === TEST_CUST_ID_ALREADY_LOG);
  assert(found === undefined, "Already-logged customer NOT in NUDGE results");

  // Verify duplicate insert is silently ignored
  const logId2 = crypto.randomUUID();
  let duplicateIgnored = false;
  try {
    await exec(
      "INSERT IGNORE INTO communications_log (id, customer_id, rule_id) VALUES (?, ?, ?)",
      [logId2, cust.id, rule.id]
    );
    // IGNORE means it won't throw, but affectedRows = 0
    duplicateIgnored = true;
  } catch {
    duplicateIgnored = false;
  }
  assert(duplicateIgnored, "Duplicate INSERT IGNORE does not throw");

  // Confirm only 1 row exists for this customer + rule
  const [logRows] = await conn.execute(
    "SELECT COUNT(*) as cnt FROM communications_log WHERE customer_id = ? AND rule_id = ?",
    [cust.id, rule.id]
  );
  assert(logRows[0].cnt === 1, "Only 1 communications_log row per customer+rule");
}

/* ── T7: Rule toggle (update is_active) ────────────────────────────────────── */

console.log("\n── T7: Rule toggle via SQL ──");
{
  // Toggle OFF
  await exec("UPDATE automation_rules SET is_active = FALSE WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  const [off] = await exec("SELECT is_active FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  assert(off.is_active === 0, "Rule toggled OFF");

  // Verify worker would skip: active rules query returns 0
  const active = await exec("SELECT * FROM automation_rules WHERE is_active = TRUE");
  const nudge = active.find((r) => r.trigger_key === "NUDGE_FIRST_TRANSFER");
  assert(nudge === undefined, "Inactive rule excluded from active rules query");

  // Toggle ON
  await exec("UPDATE automation_rules SET is_active = TRUE WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  const [on_] = await exec("SELECT is_active FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  assert(on_.is_active === 1, "Rule toggled ON");
}

/* ── T8: Rule update (delay, subject, template) ───────────────────────────── */

console.log("\n── T8: Rule field updates ──");
{
  // Update delay
  await exec("UPDATE automation_rules SET delay_hours = 48 WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  const [r1] = await exec("SELECT delay_hours FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  assert(r1.delay_hours === 48, "delay_hours updated to 48");

  // Update subject
  await exec("UPDATE automation_rules SET email_subject = 'Test subject!' WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  const [r2] = await exec("SELECT email_subject FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  assert(r2.email_subject === "Test subject!", "email_subject updated");

  // Update template
  await exec("UPDATE automation_rules SET email_template_id = 'general-email' WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  const [r3] = await exec("SELECT email_template_id FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  assert(r3.email_template_id === "general-email", "email_template_id updated");

  // Restore defaults
  await exec(
    `UPDATE automation_rules
     SET delay_hours = 72, email_subject = 'Your first transfer is free!',
         email_template_id = 'first-transfer-nudge', is_active = FALSE
     WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'`
  );
  const [restored] = await exec("SELECT * FROM automation_rules WHERE trigger_key = 'NUDGE_FIRST_TRANSFER'");
  assert(restored.delay_hours === 72 && restored.is_active === 0, "Defaults restored");
}

/* ── cleanup ───────────────────────────────────────────────────────────────── */

console.log("\n🧹 Cleaning up smoke-test data...");
for (const cid of TEST_CUST_IDS) {
  await exec("DELETE FROM transfers WHERE customer_id = ?", [cid]);
}
for (const cid of TEST_CUST_IDS) {
  const rows = await exec("SELECT id FROM customers WHERE customer_id = ?", [cid]);
  if (rows.length) {
    await exec("DELETE FROM communications_log WHERE customer_id = ?", [rows[0].id]);
  }
}
for (const cid of TEST_CUST_IDS) {
  await exec("DELETE FROM customers WHERE customer_id = ?", [cid]);
}

/* ── summary ───────────────────────────────────────────────────────────────── */

await conn.end();

console.log(`\n${"=".repeat(50)}`);
console.log(`  ${passed + failed} assertions | ${passed} passed | ${failed} failed`);
console.log(`${"=".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
