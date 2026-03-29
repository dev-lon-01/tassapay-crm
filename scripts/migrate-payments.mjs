/**
 * migrate-payments.mjs
 *
 * Creates and hardens the payments reconciliation table.
 * Safe to run multiple times.
 *
 * Usage:
 *   node scripts/migrate-payments.mjs
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

await conn.execute(`
  CREATE TABLE IF NOT EXISTS payments (
    id                  INT            NOT NULL AUTO_INCREMENT,
    provider            VARCHAR(50)    NOT NULL,
    provider_payment_id VARCHAR(191)   NOT NULL,
    transfer_ref        VARCHAR(100)   DEFAULT NULL,
    payment_type        VARCHAR(50)    NOT NULL DEFAULT 'payment',
    payment_method      VARCHAR(100)   DEFAULT NULL,
    amount              DECIMAL(12,2)  DEFAULT NULL,
    currency            VARCHAR(10)    DEFAULT NULL,
    status              VARCHAR(20)    NOT NULL,
    provider_status     VARCHAR(100)   DEFAULT NULL,
    payment_date        DATETIME       DEFAULT NULL,
    raw_data            JSON           DEFAULT NULL,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
console.log("  payments table ready");

const columnsToAdd = [
  ["provider", "VARCHAR(50) NOT NULL DEFAULT 'volume'"],
  ["provider_payment_id", "VARCHAR(191) NOT NULL"],
  ["transfer_ref", "VARCHAR(100) NULL"],
  ["payment_type", "VARCHAR(50) NOT NULL DEFAULT 'payment'"],
  ["payment_method", "VARCHAR(100) NULL"],
  ["amount", "DECIMAL(12,2) NULL"],
  ["currency", "VARCHAR(10) NULL"],
  ["status", "VARCHAR(20) NOT NULL DEFAULT 'failed'"],
  ["provider_status", "VARCHAR(100) NULL"],
  ["payment_date", "DATETIME NULL"],
  ["raw_data", "JSON NULL"],
  ["created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  ["updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"],
];

for (const [name, ddl] of columnsToAdd) {
  const [[row]] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM   information_schema.COLUMNS
     WHERE  TABLE_SCHEMA = DATABASE()
       AND  TABLE_NAME = 'payments'
       AND  COLUMN_NAME = ?`,
    [name],
  );

  if (row) {
    console.log(`  skip  payments.${name} (already exists)`);
    continue;
  }

  await conn.execute(`ALTER TABLE payments ADD COLUMN ${name} ${ddl}`);
  console.log(`  added payments.${name}`);
}

const indexes = [
  ["uq_provider_payment_id", "ALTER TABLE payments ADD UNIQUE INDEX uq_provider_payment_id (provider_payment_id)"],
  ["idx_payments_transfer_ref", "ALTER TABLE payments ADD INDEX idx_payments_transfer_ref (transfer_ref)"],
  ["idx_payments_provider", "ALTER TABLE payments ADD INDEX idx_payments_provider (provider)"],
  ["idx_payments_payment_date", "ALTER TABLE payments ADD INDEX idx_payments_payment_date (payment_date)"],
  ["idx_payments_status", "ALTER TABLE payments ADD INDEX idx_payments_status (status)"],
];

for (const [name, sql] of indexes) {
  const [[row]] = await conn.execute(
    `SELECT INDEX_NAME
     FROM   information_schema.STATISTICS
     WHERE  TABLE_SCHEMA = DATABASE()
       AND  TABLE_NAME = 'payments'
       AND  INDEX_NAME = ?`,
    [name],
  );

  if (row) {
    console.log(`  skip  ${name} (already exists)`);
    continue;
  }

  await conn.execute(sql);
  console.log(`  added ${name}`);
}

await conn.end();
console.log("\n✓ migrate-payments complete");
