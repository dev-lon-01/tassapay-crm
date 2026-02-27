/**
 * scripts/migrate-sla-alerts.mjs
 * Run once: node scripts/migrate-sla-alerts.mjs
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

// Load .env.local
const envLines = readFileSync(".env.local", "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [key, ...rest] = trimmed.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST     ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME     ?? "tassapay_crm",
});

try {
  // 1. Create alert_routings table (safe to rerun)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`alert_routings\` (
      \`id\`                   INT           NOT NULL AUTO_INCREMENT,
      \`destination_country\`  VARCHAR(100)  NOT NULL DEFAULT 'Somalia',
      \`source_currency\`      VARCHAR(10)   NOT NULL,
      \`alert_emails\`         TEXT          DEFAULT NULL,
      \`alert_phones\`         TEXT          DEFAULT NULL,
      \`is_active\`            TINYINT(1)    NOT NULL DEFAULT 1,
      \`created_at\`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_alert_routing\` (\`destination_country\`, \`source_currency\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✓ alert_routings table ready");

  // 2. Add data_field_id if missing
  const [dfCols] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers' AND COLUMN_NAME = 'data_field_id'`
  );
  if (!dfCols.length) {
    await conn.query(`ALTER TABLE \`transfers\` ADD COLUMN \`data_field_id\` VARCHAR(50) DEFAULT NULL AFTER \`attributed_agent_id\``);
    console.log("✓ transfers.data_field_id added");
  } else {
    console.log("✓ transfers.data_field_id already exists");
  }

  // 3. Add sla_alert_sent_at if missing
  const [slaCols] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers' AND COLUMN_NAME = 'sla_alert_sent_at'`
  );
  if (!slaCols.length) {
    await conn.query(`ALTER TABLE \`transfers\` ADD COLUMN \`sla_alert_sent_at\` DATETIME DEFAULT NULL AFTER \`data_field_id\``);
    console.log("✓ transfers.sla_alert_sent_at added");
  } else {
    console.log("✓ transfers.sla_alert_sent_at already exists");
  }

  // 4. Add data_field_status if missing
  const [dfsCols] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers' AND COLUMN_NAME = 'data_field_status'`
  );
  if (!dfsCols.length) {
    await conn.query(`ALTER TABLE \`transfers\` ADD COLUMN \`data_field_status\` VARCHAR(50) DEFAULT NULL AFTER \`data_field_id\``);
    console.log("✓ transfers.data_field_status added");
  } else {
    console.log("✓ transfers.data_field_status already exists");
  }

  // 5. Add payment_status if missing
  const [psCols] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers' AND COLUMN_NAME = 'payment_status'`
  );
  if (!psCols.length) {
    await conn.query(`ALTER TABLE \`transfers\` ADD COLUMN \`payment_status\` VARCHAR(50) DEFAULT NULL AFTER \`data_field_status\``);
    console.log("✓ transfers.payment_status added");
  } else {
    console.log("✓ transfers.payment_status already exists");
  }

  console.log("\n✓ Migration complete.");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exit(1);
} finally {
  await conn.end();
}
