/**
 * migrate-leads.mjs
 *
 * Adds lead-management columns to the customers table and optionally
 * adds a UNIQUE index on phone_number.
 *
 * Safe to re-run — guarded by information_schema checks.
 *
 * Usage:
 *   node scripts/migrate-leads.mjs
 */

import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const conn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
});

async function columnExists(table, col) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND COLUMN_NAME  = ?`,
    [table, col]
  );
  return row.cnt > 0;
}

async function indexExists(table, idx) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND INDEX_NAME   = ?`,
    [table, idx]
  );
  return row.cnt > 0;
}

try {
  // 1 ── is_lead ──────────────────────────────────────────────────────────────
  if (!(await columnExists("customers", "is_lead"))) {
    await conn.execute(
      `ALTER TABLE \`customers\`
       ADD COLUMN \`is_lead\` TINYINT(1) NOT NULL DEFAULT 0
       AFTER \`created_at\``
    );
    console.log("✓ customers.is_lead added");
  } else {
    console.log("  customers.is_lead already exists");
  }

  // 2 ── lead_stage ───────────────────────────────────────────────────────────
  if (!(await columnExists("customers", "lead_stage"))) {
    await conn.execute(
      `ALTER TABLE \`customers\`
       ADD COLUMN \`lead_stage\` ENUM('New','Contacted','Follow-up','Converted','Dead')
         DEFAULT NULL
       AFTER \`is_lead\``
    );
    console.log("✓ customers.lead_stage added");
  } else {
    console.log("  customers.lead_stage already exists");
  }

  // 3 ── assigned_agent_id ────────────────────────────────────────────────────
  if (!(await columnExists("customers", "assigned_agent_id"))) {
    await conn.execute(
      `ALTER TABLE \`customers\`
       ADD COLUMN \`assigned_agent_id\` INT DEFAULT NULL
       AFTER \`lead_stage\``
    );
    // FK (best-effort — silently skip if constraint already exists)
    try {
      await conn.execute(
        `ALTER TABLE \`customers\`
         ADD CONSTRAINT \`fk_customers_assigned_agent\`
           FOREIGN KEY (\`assigned_agent_id\`) REFERENCES \`users\` (\`id\`)
           ON DELETE SET NULL ON UPDATE CASCADE`
      );
      console.log("✓ customers.assigned_agent_id added (with FK)");
    } catch {
      console.log("✓ customers.assigned_agent_id added (FK skipped — constraint may already exist)");
    }
  } else {
    console.log("  customers.assigned_agent_id already exists");
  }

  // 4 ── labels (JSON) ────────────────────────────────────────────────────────
  if (!(await columnExists("customers", "labels"))) {
    await conn.execute(
      `ALTER TABLE \`customers\`
       ADD COLUMN \`labels\` JSON DEFAULT NULL
       AFTER \`assigned_agent_id\``
    );
    console.log("✓ customers.labels added");
  } else {
    console.log("  customers.labels already exists");
  }

  // 5 ── labels index (full-text JSON not directly indexable; use generated col)
  // We add a functional index on the JSON column for MySQL 8+ environments.
  // For MySQL 5.7, skip silently.
  if (!(await indexExists("customers", "idx_customers_labels"))) {
    try {
      await conn.execute(
        `ALTER TABLE \`customers\`
         ADD INDEX \`idx_customers_labels\` ((\`labels\`(512)))`
      );
      console.log("✓ idx_customers_labels index added");
    } catch {
      console.log("  idx_customers_labels skipped (MySQL version may not support functional indexes)");
    }
  } else {
    console.log("  idx_customers_labels already exists");
  }

  // 6 ── UNIQUE index on phone_number ─────────────────────────────────────────
  if (!(await indexExists("customers", "uq_phone_number"))) {
    // Check for duplicate phone numbers before adding unique constraint
    const [dupes] = await conn.execute(
      `SELECT phone_number, COUNT(*) AS cnt
       FROM customers
       WHERE phone_number IS NOT NULL AND phone_number != ''
       GROUP BY phone_number
       HAVING cnt > 1`
    );
    if (dupes.length > 0) {
      console.warn(
        `⚠  Skipping UNIQUE index on phone_number — ${dupes.length} duplicate(s) found. ` +
        `Deduplicate manually then re-run this script.`
      );
    } else {
      await conn.execute(
        `ALTER TABLE \`customers\`
         ADD UNIQUE KEY \`uq_phone_number\` (\`phone_number\`)`
      );
      console.log("✓ UNIQUE KEY uq_phone_number added");
    }
  } else {
    console.log("  uq_phone_number already exists");
  }

  console.log("\n✅  Migration complete.");
} finally {
  await conn.end();
}
