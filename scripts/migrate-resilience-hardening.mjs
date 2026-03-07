import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

function normalizePhoneValue(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, "");
  return digits.length > 0 ? digits : null;
}

function getPhoneLast9(phone) {
  const normalized = normalizePhoneValue(phone);
  return normalized ? normalized.slice(-9) : null;
}

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
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Boolean(row);
}

async function indexExists(table, index) {
  const [[row]] = await conn.execute(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [table, index]
  );
  return Boolean(row);
}

async function addColumnIfMissing(table, column, ddl) {
  if (await columnExists(table, column)) {
    console.log(`  skip  ${table}.${column}`);
    return;
  }
  await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`  added ${table}.${column}`);
}

async function addIndexIfMissing(table, index, ddl) {
  if (await indexExists(table, index)) {
    console.log(`  skip  ${table}.${index}`);
    return;
  }
  await conn.execute(`ALTER TABLE ${table} ADD ${ddl}`);
  console.log(`  added ${table}.${index}`);
}

console.log("\nResilience hardening migration\n");

await addColumnIfMissing("users", "voice_last_seen_at", "DATETIME DEFAULT NULL");
await addColumnIfMissing("customers", "phone_normalized", "VARCHAR(32) DEFAULT NULL");
await addColumnIfMissing("customers", "phone_last9", "VARCHAR(9) DEFAULT NULL");
await addIndexIfMissing("customers", "idx_phone_normalized", "INDEX idx_phone_normalized (phone_normalized)");
await addIndexIfMissing("customers", "idx_phone_last9", "INDEX idx_phone_last9 (phone_last9)");
await addColumnIfMissing("interactions", "call_status", "VARCHAR(50) DEFAULT NULL");
await addColumnIfMissing("interactions", "request_id", "VARCHAR(64) DEFAULT NULL");
await addColumnIfMissing("interactions", "provider_message_id", "VARCHAR(128) DEFAULT NULL");
await addIndexIfMissing("interactions", "idx_interactions_call_status", "INDEX idx_interactions_call_status (call_status)");
await addIndexIfMissing("interactions", "uq_interactions_request_id", "UNIQUE INDEX uq_interactions_request_id (request_id)");
await addIndexIfMissing("transfers", "idx_transfers_data_field_id", "INDEX idx_transfers_data_field_id (data_field_id)");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS voice_webhook_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source VARCHAR(64) NOT NULL,
    canonical_sid VARCHAR(64) DEFAULT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_voice_webhook_events_canonical_sid (canonical_sid),
    INDEX idx_voice_webhook_events_source (source)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
console.log("  ensured voice_webhook_events table");

console.log("\nBackfilling phone lookup columns...");
const [customerRows] = await conn.execute(
  `SELECT customer_id, phone_number
   FROM customers
   WHERE phone_number IS NOT NULL
     AND (phone_normalized IS NULL OR phone_last9 IS NULL)`
);
for (const row of customerRows) {
  const normalized = normalizePhoneValue(row.phone_number);
  const last9 = getPhoneLast9(row.phone_number);
  await conn.execute(
    `UPDATE customers
     SET phone_normalized = ?, phone_last9 = ?
     WHERE customer_id = ?`,
    [normalized, last9, row.customer_id]
  );
}
console.log(`  updated ${customerRows.length} customer rows`);

console.log("\nAudit queries:");
const [[duplicateCallSids]] = await conn.execute(`
  SELECT COUNT(*) AS total
  FROM (
    SELECT twilio_call_sid
    FROM interactions
    WHERE twilio_call_sid IS NOT NULL AND twilio_call_sid != ''
    GROUP BY twilio_call_sid
    HAVING COUNT(*) > 1
  ) duplicate_groups
`);
console.log(`  duplicate twilio_call_sid groups: ${Number(duplicateCallSids.total ?? 0)}`);

const [[phoneCollisions]] = await conn.execute(`
  SELECT COUNT(*) AS total
  FROM (
    SELECT phone_normalized
    FROM customers
    WHERE phone_normalized IS NOT NULL
    GROUP BY phone_normalized
    HAVING COUNT(*) > 1
  ) duplicate_phones
`);
console.log(`  normalized phone collisions: ${Number(phoneCollisions.total ?? 0)}`);

const [[orphanTransfers]] = await conn.execute(`
  SELECT COUNT(*) AS total
  FROM transfers t
  LEFT JOIN customers c ON c.customer_id = t.customer_id
  WHERE c.customer_id IS NULL
`);
console.log(`  orphan transfers.customer_id rows: ${Number(orphanTransfers.total ?? 0)}`);

await conn.end();
console.log("\nDone.\n");

