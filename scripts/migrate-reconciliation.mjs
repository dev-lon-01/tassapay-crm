/**
 * migrate-reconciliation.mjs
 *
 * Adds reconciliation columns to payments and transfers tables.
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   node scripts/migrate-reconciliation.mjs
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

async function columnExists(table, column) {
  const [[row]] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM   information_schema.COLUMNS
     WHERE  TABLE_SCHEMA = DATABASE()
       AND  TABLE_NAME = ?
       AND  COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(row);
}

async function indexExists(table, indexName) {
  const [[row]] = await conn.execute(
    `SELECT INDEX_NAME
     FROM   information_schema.STATISTICS
     WHERE  TABLE_SCHEMA = DATABASE()
       AND  TABLE_NAME = ?
       AND  INDEX_NAME = ?`,
    [table, indexName],
  );
  return Boolean(row);
}

async function constraintExists(table, constraintName) {
  const [[row]] = await conn.execute(
    `SELECT CONSTRAINT_NAME
     FROM   information_schema.TABLE_CONSTRAINTS
     WHERE  TABLE_SCHEMA = DATABASE()
       AND  TABLE_NAME = ?
       AND  CONSTRAINT_NAME = ?`,
    [table, constraintName],
  );
  return Boolean(row);
}

// ─── payments table alterations ──────────────────────────────────────────────

// Shrink transfer_ref from VARCHAR(100) to VARCHAR(50) to match transfers.transaction_ref
if (await columnExists("payments", "transfer_ref")) {
  await conn.execute(`ALTER TABLE payments MODIFY transfer_ref VARCHAR(50) NULL`);
  console.log("  modified payments.transfer_ref → VARCHAR(50) NULL");
}

const paymentColumns = [
  ["is_reconciled", "BOOLEAN DEFAULT FALSE AFTER raw_data"],
  ["reconciliation_note", "VARCHAR(255) NULL AFTER is_reconciled"],
];

for (const [name, ddl] of paymentColumns) {
  if (await columnExists("payments", name)) {
    console.log(`  skip  payments.${name} (already exists)`);
  } else {
    await conn.execute(`ALTER TABLE payments ADD COLUMN ${name} ${ddl}`);
    console.log(`  added payments.${name}`);
  }
}

if (!(await indexExists("payments", "idx_payments_reconciled"))) {
  await conn.execute(`ALTER TABLE payments ADD INDEX idx_payments_reconciled (is_reconciled)`);
  console.log("  added idx_payments_reconciled");
} else {
  console.log("  skip  idx_payments_reconciled (already exists)");
}

// ─── transfers table alterations ─────────────────────────────────────────────

const transferColumns = [
  ["primary_payment_id", "INT NULL AFTER sla_alert_sent_at"],
  ["reconciliation_status", "ENUM('pending','matched','mismatch','manual_adjustment') DEFAULT 'pending' AFTER primary_payment_id"],
  ["accounting_category", "ENUM('remittance','operational_expense','rounding_difference','suspense') NULL AFTER reconciliation_status"],
  ["manual_adjustment_note", "TEXT NULL AFTER accounting_category"],
];

for (const [name, ddl] of transferColumns) {
  if (await columnExists("transfers", name)) {
    console.log(`  skip  transfers.${name} (already exists)`);
  } else {
    await conn.execute(`ALTER TABLE transfers ADD COLUMN ${name} ${ddl}`);
    console.log(`  added transfers.${name}`);
  }
}

if (!(await constraintExists("transfers", "fk_primary_payment"))) {
  await conn.execute(
    `ALTER TABLE transfers
     ADD CONSTRAINT fk_primary_payment
     FOREIGN KEY (primary_payment_id) REFERENCES payments(id) ON DELETE SET NULL`,
  );
  console.log("  added fk_primary_payment");
} else {
  console.log("  skip  fk_primary_payment (already exists)");
}

if (!(await indexExists("transfers", "idx_transfers_recon_status"))) {
  await conn.execute(`ALTER TABLE transfers ADD INDEX idx_transfers_recon_status (reconciliation_status)`);
  console.log("  added idx_transfers_recon_status");
} else {
  console.log("  skip  idx_transfers_recon_status (already exists)");
}

await conn.end();
console.log("\n✓ migrate-reconciliation complete");
