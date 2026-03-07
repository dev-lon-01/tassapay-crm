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

// Normalize blank string CallSids so a unique key can be applied safely.
await conn.execute(
  `UPDATE interactions
   SET twilio_call_sid = NULL
   WHERE twilio_call_sid = ''`
);

// Add / upgrade lookup key on twilio_call_sid for webhook upserts.
const [[duplicateRow]] = await conn.execute(
  `SELECT COUNT(*) AS duplicate_groups
   FROM (
     SELECT twilio_call_sid
     FROM interactions
     WHERE twilio_call_sid IS NOT NULL
     GROUP BY twilio_call_sid
     HAVING COUNT(*) > 1
   ) d`
);

const duplicateGroups = Number(duplicateRow?.duplicate_groups ?? 0);

const [[uniqueIdxRow]] = await conn.execute(
  `SELECT INDEX_NAME
   FROM   information_schema.STATISTICS
   WHERE  TABLE_SCHEMA = DATABASE()
     AND  TABLE_NAME   = 'interactions'
     AND  INDEX_NAME   = 'uq_interactions_call_sid'`
);

const [[plainIdxRow]] = await conn.execute(
  `SELECT INDEX_NAME
   FROM   information_schema.STATISTICS
   WHERE  TABLE_SCHEMA = DATABASE()
     AND  TABLE_NAME   = 'interactions'
     AND  INDEX_NAME   = 'idx_call_sid'`
);

if (duplicateGroups > 0) {
  console.log(`  warning: found ${duplicateGroups} duplicate twilio_call_sid group(s); keeping non-unique lookup index`);
  if (!plainIdxRow) {
    await conn.execute(
      `ALTER TABLE interactions ADD INDEX idx_call_sid (twilio_call_sid)`
    );
    console.log("  added index idx_call_sid");
  } else {
    console.log("  skip  idx_call_sid (already exists)");
  }
} else if (!uniqueIdxRow) {
  if (plainIdxRow) {
    await conn.execute(`ALTER TABLE interactions DROP INDEX idx_call_sid`);
    console.log("  dropped legacy idx_call_sid");
  }
  await conn.execute(
    `ALTER TABLE interactions ADD UNIQUE INDEX uq_interactions_call_sid (twilio_call_sid)`
  );
  console.log("  added unique index uq_interactions_call_sid");
} else {
  console.log("  skip  uq_interactions_call_sid (already exists)");
}

await conn.end();
console.log("\n✓ migrate-call-logging complete");
