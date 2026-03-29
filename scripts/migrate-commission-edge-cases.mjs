/**
 * Migration: Commission Edge-Cases
 *
 * 1. Add 'cancelled' to commissions.status ENUM
 * 2. Add cancellation_reason VARCHAR(500)
 * 3. Add cancelled_at DATETIME
 *
 * Safe to re-run — uses IF NOT EXISTS / MODIFY COLUMN idempotently.
 *
 * Usage:
 *   node scripts/migrate-commission-edge-cases.mjs
 */

import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
  waitForConnections: true,
  connectionLimit: 2,
});

const migrations = [
  {
    label: "Expand commissions.status ENUM to include 'cancelled'",
    sql: `ALTER TABLE commissions
          MODIFY COLUMN status ENUM('pending_approval','approved','rejected','paid','cancelled')
          NOT NULL DEFAULT 'pending_approval'`,
  },
  {
    label: "Add cancellation_reason column",
    sql: `ALTER TABLE commissions
          ADD COLUMN cancellation_reason VARCHAR(500) DEFAULT NULL
          AFTER rejection_reason`,
  },
  {
    label: "Add cancelled_at column",
    sql: `ALTER TABLE commissions
          ADD COLUMN cancelled_at DATETIME DEFAULT NULL
          AFTER cancellation_reason`,
  },
];

async function run() {
  console.log("Commission Edge-Cases Migration");
  console.log("═".repeat(50));

  for (const { label, sql } of migrations) {
    try {
      await pool.execute(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      // Duplicate column is fine (re-run safety)
      if (err.code === "ER_DUP_FIELDNAME") {
        console.log(`  – ${label} (already exists, skipped)`);
      } else {
        console.error(`  ✗ ${label}: ${err.message}`);
        process.exit(1);
      }
    }
  }

  console.log("\nDone.");
  await pool.end();
}

run();
