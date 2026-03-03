/**
 * scripts/migrate-interactions-nullable-customer.mjs
 *
 * Makes interactions.customer_id nullable so that auto-logged calls from unknown
 * callers (phone not in DB) can still be saved with their twilio_call_sid, ensuring
 * recordings can attach via the recording status-callback even when the caller is
 * not yet identified.
 *
 * Also changes ON DELETE from CASCADE to SET NULL so deleting a customer does not
 * wipe their interaction history.
 *
 * Idempotent — safe to rerun.
 * Usage: node scripts/migrate-interactions-nullable-customer.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host:     process.env.DB_HOST     ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME     ?? "tassapay_crm",
});

async function migrate() {
  const conn = await pool.getConnection();
  try {
    // ── 1. Check current nullability ──────────────────────────────────────────
    const [cols] = await conn.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'interactions'
         AND COLUMN_NAME  = 'customer_id'`
    );
    if (cols[0]?.IS_NULLABLE === "YES") {
      console.log("✓ interactions.customer_id is already nullable — nothing to do");
      return;
    }

    // ── 2. Drop existing FK on customer_id ────────────────────────────────────
    const [fks] = await conn.execute(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA        = DATABASE()
         AND TABLE_NAME          = 'interactions'
         AND COLUMN_NAME         = 'customer_id'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    for (const fk of fks) {
      await conn.execute(`ALTER TABLE interactions DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
      console.log(`  dropped FK: ${fk.CONSTRAINT_NAME}`);
    }

    // ── 3. Make column nullable ──────────────────────────────────────────────
    await conn.execute(
      `ALTER TABLE interactions MODIFY COLUMN customer_id VARCHAR(50) NULL`
    );
    console.log("✓ interactions.customer_id is now nullable");

    // ── 4. Re-add FK with ON DELETE SET NULL ─────────────────────────────────
    const [existing] = await conn.execute(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA    = DATABASE()
         AND TABLE_NAME      = 'interactions'
         AND CONSTRAINT_NAME = 'fk_interactions_customer'`
    );
    if (!existing.length) {
      await conn.execute(
        `ALTER TABLE interactions
         ADD CONSTRAINT fk_interactions_customer
         FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
         ON DELETE SET NULL ON UPDATE CASCADE`
      );
      console.log("✓ FK re-added with ON DELETE SET NULL");
    }

    console.log("\n✅ Migration complete.");
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
