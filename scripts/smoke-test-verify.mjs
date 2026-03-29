/**
 * smoke-test-verify.mjs — Verifies the Finance Reconciliation smoke test results.
 * Usage: node scripts/smoke-test-verify.mjs
 */
import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const conn = await createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label} — ${detail}`);
    failed++;
  }
}

// ─── Test 2: Perfect Match (EMC-MATCH-001 → TXN-1000) ──────────────────────
console.log("\n🧪 Test 2: Perfect Match (TXN-1000)");
{
  const [[payment]] = await conn.execute(
    "SELECT * FROM payments WHERE provider_payment_id = 'EMC-MATCH-001'",
  );
  assert("Payment row exists", !!payment, "No payment found for EMC-MATCH-001");
  if (payment) {
    assert("is_reconciled = true", !!payment.is_reconciled, `got ${payment.is_reconciled}`);
    assert("reconciliation_note is null", payment.reconciliation_note === null, `got '${payment.reconciliation_note}'`);
    assert("transfer_ref = TXN-1000", payment.transfer_ref === "TXN-1000", `got '${payment.transfer_ref}'`);
    assert("amount = 50.00", Number(payment.amount) === 50, `got ${payment.amount}`);
    assert("currency = GBP (hardcoded emerchantpay)", payment.currency === "GBP", `got ${payment.currency}`);
  }

  const [[transfer]] = await conn.execute(
    "SELECT * FROM transfers WHERE transaction_ref = 'TXN-1000'",
  );
  assert("Transfer reconciliation_status = matched", transfer?.reconciliation_status === "matched", `got '${transfer?.reconciliation_status}'`);
  assert("Transfer primary_payment_id is set", transfer?.primary_payment_id != null, `got ${transfer?.primary_payment_id}`);
}

// ─── Test 3: Orphan (PC-ORPHAN-001 → TXN-NO-MATCH) ─────────────────────────
console.log("\n🧪 Test 3: Orphan (TXN-NO-MATCH)");
{
  const [[payment]] = await conn.execute(
    "SELECT * FROM payments WHERE provider_payment_id = 'PC-ORPHAN-001'",
  );
  assert("Payment row exists", !!payment, "No payment found for PC-ORPHAN-001");
  if (payment) {
    assert("is_reconciled = false", !payment.is_reconciled, `got ${payment.is_reconciled}`);
    assert(
      "reconciliation_note = 'Orphan: Transfer ID not found'",
      payment.reconciliation_note === "Orphan: Transfer ID not found",
      `got '${payment.reconciliation_note}'`,
    );
  }
}

// ─── Test 4: Amount Mismatch (VOL-MISMATCH-001 → TXN-2000) ─────────────────
console.log("\n🧪 Test 4: Amount Mismatch (TXN-2000)");
{
  const [[payment]] = await conn.execute(
    "SELECT * FROM payments WHERE provider_payment_id = 'VOL-MISMATCH-001'",
  );
  assert("Payment row exists", !!payment, "No payment found for VOL-MISMATCH-001");
  if (payment) {
    assert("is_reconciled = false", !payment.is_reconciled, `got ${payment.is_reconciled}`);
    assert(
      "reconciliation_note = 'Amount Mismatch'",
      payment.reconciliation_note === "Amount Mismatch",
      `got '${payment.reconciliation_note}'`,
    );
    assert("amount = 98.00", Number(payment.amount) === 98, `got ${payment.amount}`);
  }

  const [[transfer]] = await conn.execute(
    "SELECT * FROM transfers WHERE transaction_ref = 'TXN-2000'",
  );
  assert("Transfer reconciliation_status = mismatch", transfer?.reconciliation_status === "mismatch", `got '${transfer?.reconciliation_status}'`);
}

// ─── Test 5: Multi-Row Refund (TXN-3000) ────────────────────────────────────
console.log("\n🧪 Test 5: Multi-Row Refund (TXN-3000)");
{
  const [payments] = await conn.execute(
    "SELECT * FROM payments WHERE transfer_ref = 'TXN-3000' ORDER BY payment_type",
  );
  assert("Two payment rows exist", payments.length === 2, `got ${payments.length} rows`);

  const paymentRow = payments.find((p) => p.payment_type.toLowerCase() === "payment");
  const refundRow = payments.find((p) => p.payment_type.toLowerCase() === "refund");
  assert("Has a payment-type row", !!paymentRow, "Missing payment row");
  assert("Has a refund-type row", !!refundRow, "Missing refund row");

  if (refundRow) {
    assert("Refund is_reconciled = true", !!refundRow.is_reconciled, `got ${refundRow.is_reconciled}`);
  }

  const [[transfer]] = await conn.execute(
    "SELECT * FROM transfers WHERE transaction_ref = 'TXN-3000'",
  );
  assert("Transfer status = Refunded", transfer?.status === "Refunded", `got '${transfer?.status}'`);
}

// ─── Test 1: Sanity (VOL-SANITY-001 processed) ─────────────────────────────
console.log("\n🧪 Test 1: Worker Boot & Archival");
{
  const [[payment]] = await conn.execute(
    "SELECT * FROM payments WHERE provider_payment_id = 'VOL-SANITY-001'",
  );
  assert("Sanity row exists in payments", !!payment, "No payment found for VOL-SANITY-001");
  // File archival is checked separately via filesystem
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
if (failed === 0) {
  console.log("  🎉 All smoke tests PASSED");
} else {
  console.log("  ⚠️  Some tests FAILED — review above");
}
console.log("═".repeat(50));

await conn.end();
process.exit(failed > 0 ? 1 : 0);
