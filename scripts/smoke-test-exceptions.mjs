/**
 * Smoke-test seed + verify for the Reconciliation Exceptions Dashboard.
 *
 * Seeds 5 test scenarios, then queries the exceptions API SQL directly
 * and asserts each row lands in the correct (and only the correct) queue.
 *
 * Usage:  node scripts/smoke-test-exceptions.mjs
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

/* ── helpers ── */

async function exec(sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    return true;
  }
  console.log(`  ❌ ${label}`);
  return false;
}

/* ── cleanup previous test data ── */
console.log("\n🧹 Cleaning previous smoke-test data...");
const TEST_REFS = ["TXN-UNFUNDED", "TXN-DOUBLE", "TXN-MISMATCH", "TXN-PERFECT"];
const TEST_PAY_IDS = ["GWAY-999", "GWAY-DOUBLE-REFUND", "GWAY-MISMATCH-PAY", "GWAY-PERFECT-PAY"];

// Delete payments first (FK safe)
for (const pid of TEST_PAY_IDS) {
  await exec("DELETE FROM payments WHERE provider_payment_id = ?", [pid]);
}
// Reset transfer reconciliation columns before deleting
for (const ref of TEST_REFS) {
  await exec("UPDATE transfers SET primary_payment_id = NULL WHERE transaction_ref = ?", [ref]);
}
for (const ref of TEST_REFS) {
  await exec("DELETE FROM transfers WHERE transaction_ref = ?", [ref]);
}
// Orphan has no transfer, just a payment
await exec("DELETE FROM payments WHERE provider_payment_id = 'GWAY-999'");

console.log("  Done.\n");

/* ── seed ── */
console.log("🌱 Seeding test data...");

// We need a customer_id that exists. Pick the first one.
const [custRow] = await exec("SELECT customer_id FROM customers LIMIT 1");
const custId = custRow?.customer_id ?? "SMOKE-CUST-1";

// Test 1: Unfunded transfer (Paid, no success payment)
await exec(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status, created_at)
   VALUES (?, 'TXN-UNFUNDED', 500.00, 'GBP', 'Paid', NOW())`,
  [custId],
);
console.log("  Test 1: TXN-UNFUNDED seeded (Paid, no payment)");

// Test 2: Double-loss (Paid + refund payment)
await exec(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status, created_at)
   VALUES (?, 'TXN-DOUBLE', 200.00, 'GBP', 'Paid', NOW())`,
  [custId],
);
await exec(
  `INSERT INTO payments (provider, provider_payment_id, transfer_ref, payment_type, amount, currency, status, provider_status, is_reconciled)
   VALUES ('paycross', 'GWAY-DOUBLE-REFUND', 'TXN-DOUBLE', 'refund', 200.00, 'GBP', 'refunded', 'refunded', TRUE)`,
);
console.log("  Test 2: TXN-DOUBLE seeded (Paid + refund payment)");

// Test 3: Amount mismatch
await exec(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status, reconciliation_status, created_at)
   VALUES (?, 'TXN-MISMATCH', 100.00, 'GBP', 'Paid', 'mismatch', NOW())`,
  [custId],
);
// Insert payment first, then link it
await exec(
  `INSERT INTO payments (provider, provider_payment_id, transfer_ref, payment_type, amount, currency, status, provider_status, is_reconciled)
   VALUES ('volume', 'GWAY-MISMATCH-PAY', 'TXN-MISMATCH', 'payment', 95.00, 'GBP', 'success', 'success', FALSE)`,
);
const [mismatchPay] = await exec("SELECT id FROM payments WHERE provider_payment_id = 'GWAY-MISMATCH-PAY'");
await exec("UPDATE transfers SET primary_payment_id = ? WHERE transaction_ref = 'TXN-MISMATCH'", [mismatchPay.id]);
console.log("  Test 3: TXN-MISMATCH seeded (send=100, collected=95)");

// Test 4: Orphaned payment
await exec(
  `INSERT INTO payments (provider, provider_payment_id, transfer_ref, payment_type, amount, currency, status, provider_status, is_reconciled, reconciliation_note)
   VALUES ('emerchantpay', 'GWAY-999', 'TXN-GHOST', 'payment', 50.00, 'GBP', 'success', 'success', FALSE, 'Orphan: Transfer ID not found')`,
);
console.log("  Test 4: GWAY-999 seeded (orphan, no transfer for TXN-GHOST)");

// Test 5: Perfect match (should NOT appear anywhere)
await exec(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status, reconciliation_status, created_at)
   VALUES (?, 'TXN-PERFECT', 100.00, 'GBP', 'Paid', 'matched', NOW())`,
  [custId],
);
await exec(
  `INSERT INTO payments (provider, provider_payment_id, transfer_ref, payment_type, amount, currency, status, provider_status, is_reconciled)
   VALUES ('volume', 'GWAY-PERFECT-PAY', 'TXN-PERFECT', 'payment', 100.00, 'GBP', 'success', 'success', TRUE)`,
);
const [perfectPay] = await exec("SELECT id FROM payments WHERE provider_payment_id = 'GWAY-PERFECT-PAY'");
await exec("UPDATE transfers SET primary_payment_id = ? WHERE transaction_ref = 'TXN-PERFECT'", [perfectPay.id]);
console.log("  Test 5: TXN-PERFECT seeded (exact match)\n");

/* ── run the same queries the API uses ── */
console.log("🔍 Running exception queries...\n");

const unfunded = await exec(`
  SELECT t.id AS transfer_id, t.transaction_ref, t.send_amount, t.status AS transfer_status
  FROM transfers t
  LEFT JOIN payments p ON t.transaction_ref = p.transfer_ref
  WHERE t.status IN ('Paid', 'Deposited')
    AND p.id IS NULL
`);

const doubleLoss = await exec(`
  SELECT t.id AS transfer_id, t.transaction_ref, t.send_amount, t.status AS transfer_status, p.provider
  FROM transfers t
  JOIN payments p ON t.transaction_ref = p.transfer_ref
  WHERE t.status IN ('Paid', 'Deposited')
    AND p.payment_type = 'refund'
`);

const mismatches = await exec(`
  SELECT t.id AS transfer_id, t.transaction_ref, t.send_amount AS expected_amount, p.amount AS actual_collected
  FROM transfers t
  JOIN payments p ON t.primary_payment_id = p.id
  WHERE t.send_amount != p.amount
    AND t.reconciliation_status = 'mismatch'
`);

const orphans = await exec(`
  SELECT p.id AS payment_id, p.provider_payment_id, p.amount, p.transfer_ref, p.is_reconciled
  FROM payments p
  WHERE p.transfer_ref IS NULL
     OR p.is_reconciled = FALSE
`);

/* ── assertions ── */
let passed = 0;
let failed = 0;

function check(cond, label) {
  if (assert(cond, label)) passed++;
  else failed++;
}

console.log("--- Test 1: Unfunded Transfer ---");
const unfundedRefs = unfunded.map((r) => r.transaction_ref);
check(unfundedRefs.includes("TXN-UNFUNDED"), "TXN-UNFUNDED appears in unfunded queue");
check(!unfundedRefs.includes("TXN-PERFECT"), "TXN-PERFECT does NOT appear in unfunded queue");
// Also check it's not in double-loss
const dlRefs = doubleLoss.map((r) => r.transaction_ref);
check(!dlRefs.includes("TXN-UNFUNDED"), "TXN-UNFUNDED does NOT appear in double-loss queue");

console.log("\n--- Test 2: Double Loss ---");
check(dlRefs.includes("TXN-DOUBLE"), "TXN-DOUBLE appears in double-loss queue");
check(!unfundedRefs.includes("TXN-DOUBLE"), "TXN-DOUBLE does NOT appear in unfunded queue");

console.log("\n--- Test 3: Amount Mismatch ---");
const mmRefs = mismatches.map((r) => r.transaction_ref);
check(mmRefs.includes("TXN-MISMATCH"), "TXN-MISMATCH appears in mismatches queue");
const mmRow = mismatches.find((r) => r.transaction_ref === "TXN-MISMATCH");
check(mmRow && Number(mmRow.expected_amount) === 100, "Expected amount = 100");
check(mmRow && Number(mmRow.actual_collected) === 95, "Actual collected = 95");

console.log("\n--- Test 4: Orphaned Payment ---");
const orphanPayIds = orphans.map((r) => r.provider_payment_id);
check(orphanPayIds.includes("GWAY-999"), "GWAY-999 appears in orphans queue");

console.log("\n--- Test 5: Happy Path (Zero False Positives) ---");
check(!unfundedRefs.includes("TXN-PERFECT"), "TXN-PERFECT NOT in unfunded");
check(!dlRefs.includes("TXN-PERFECT"), "TXN-PERFECT NOT in double-loss");
check(!mmRefs.includes("TXN-PERFECT"), "TXN-PERFECT NOT in mismatches");
const orphanTransferRefs = orphans.map((r) => r.transfer_ref);
check(!orphanTransferRefs.includes("TXN-PERFECT"), "TXN-PERFECT NOT in orphans");

/* ── summary ── */
console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed === 0) console.log("  🎉 All smoke tests PASSED");
else console.log("  ⚠️  Some tests FAILED");
console.log(`========================================\n`);

await conn.end();
process.exit(failed > 0 ? 1 : 0);
