/**
 * migrate-call-logging.mjs
 *
 * Idempotent: adds call-related columns to the interactions table.
 * Safe to run multiple times.
 *
 * Usage:
 *   node scripts/migrate-call-logging.mjs
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const conn = await createConnection({
  host:     process.env.DB_HOST     ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME     ?? "tassapay_crm",
});

const columnsToAdd = [
  { name: "twilio_call_sid",       ddl: "VARCHAR(64)      NULL" },
  { name: "call_duration_seconds", ddl: "INT UNSIGNED     NULL" },
  { name: "recording_url",         ddl: "VARCHAR(500)     NULL" },
];

for (const col of columnsToAdd) {
  const [[row]] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM   information_schema.COLUMNS
     WHERE  TABLE_SCHEMA = DATABASE()
       AND  TABLE_NAME   = 'interactions'
       AND  COLUMN_NAME  = ?`,
    [col.name]
  );
  if (row) {
    console.log(`  skip  interactions.${col.name} (already exists)`);
  } else {
    await conn.execute(
      `ALTER TABLE interactions ADD COLUMN ${col.name} ${col.ddl}`
    );
    console.log(`  added interactions.${col.name}`);
  }
}

// Add index on twilio_call_sid for fast status-callback lookups
const [[idxRow]] = await conn.execute(
  `SELECT INDEX_NAME
   FROM   information_schema.STATISTICS
   WHERE  TABLE_SCHEMA = DATABASE()
     AND  TABLE_NAME   = 'interactions'
     AND  INDEX_NAME   = 'idx_call_sid'`
);
if (!idxRow) {
  await conn.execute(
    `ALTER TABLE interactions ADD INDEX idx_call_sid (twilio_call_sid)`
  );
  console.log("  added index idx_call_sid");
} else {
  console.log("  skip  idx_call_sid (already exists)");
}

await conn.end();
console.log("\n✓ migrate-call-logging complete");
