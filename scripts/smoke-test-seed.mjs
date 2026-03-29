/**
 * smoke-test-seed.mjs — Seeds dummy data for the Finance Reconciliation smoke tests.
 * Usage: node scripts/smoke-test-seed.mjs
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

const TEST_REFS = ["TXN-1000", "TXN-2000", "TXN-3000"];
const TEST_PIDS = [
  "VOL-SANITY-001",
  "EMC-MATCH-001",
  "PC-ORPHAN-001",
  "VOL-MISMATCH-001",
  "PC-PAY-001",
  "PC-REFUND-001",
];

// Clean previous test data (order matters for FK)
await conn.execute(
  `UPDATE transfers SET primary_payment_id = NULL WHERE transaction_ref IN (${TEST_REFS.map(() => "?").join(",")})`,
  TEST_REFS,
);
await conn.execute(
  `DELETE FROM payments WHERE provider_payment_id IN (${TEST_PIDS.map(() => "?").join(",")})`,
  TEST_PIDS,
);
await conn.execute(
  `DELETE FROM payments WHERE transfer_ref IN (${TEST_REFS.map(() => "?").join(",")})`,
  TEST_REFS,
);
await conn.execute(
  `DELETE FROM payments WHERE transfer_ref = 'TXN-NO-MATCH'`,
);
await conn.execute(
  `DELETE FROM transfers WHERE transaction_ref IN (${TEST_REFS.map(() => "?").join(",")})`,
  TEST_REFS,
);
console.log("Cleaned previous test data");

// Find a valid customer_id
const [[cust]] = await conn.execute("SELECT customer_id FROM customers LIMIT 1");
const custId = cust ? cust.customer_id : "99999";
console.log(`Using customer_id = ${custId}`);

// Test 2: Perfect match transfer
await conn.execute(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status)
   VALUES (?, 'TXN-1000', 50.00, 'GBP', 'Completed')`,
  [custId],
);
console.log("  Seeded TXN-1000 (send_amount=50.00) for Test 2 — Perfect Match");

// Test 4: Amount mismatch transfer
await conn.execute(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status)
   VALUES (?, 'TXN-2000', 100.00, 'GBP', 'Completed')`,
  [custId],
);
console.log("  Seeded TXN-2000 (send_amount=100.00) for Test 4 — Mismatch");

// Test 5: Refund transfer
await conn.execute(
  `INSERT INTO transfers (customer_id, transaction_ref, send_amount, send_currency, status)
   VALUES (?, 'TXN-3000', 75.00, 'GBP', 'Completed')`,
  [custId],
);
console.log("  Seeded TXN-3000 (send_amount=75.00) for Test 5 — Refund");

await conn.end();
console.log("\n✓ Smoke test seed complete");
