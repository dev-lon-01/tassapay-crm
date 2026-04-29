/**
 * migrate-transfer-remarks.mjs
 *
 * Creates the `transfer_remarks` table that stores per-transfer activity
 * remarks pushed by Tayo/DataField via the inbound webhook.
 *
 * Safe to re-run — guarded by information_schema checks.
 *
 * Usage:
 *   node scripts/migrate-transfer-remarks.mjs
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

async function tableExists(table) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?`,
    [table],
  );
  return row.cnt > 0;
}

if (await tableExists("transfer_remarks")) {
  console.log("  transfer_remarks table already exists — nothing to do");
} else {
  await conn.execute(`
    CREATE TABLE \`transfer_remarks\` (
      \`id\`             INT           NOT NULL AUTO_INCREMENT,
      \`transfer_ref\`   VARCHAR(191)  NOT NULL,
      \`remark_date\`    DATETIME      NULL,
      \`raw_date\`       VARCHAR(50)   NULL,
      \`action_remarks\` VARCHAR(255)  NULL,
      \`remarks\`        TEXT          NULL,
      \`tayo_user\`      VARCHAR(100)  NULL,
      \`created_at\`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_transfer_remark\` (\`transfer_ref\`, \`raw_date\`(50), \`action_remarks\`(100)),
      INDEX \`idx_transfer_remarks_ref\`  (\`transfer_ref\`),
      INDEX \`idx_transfer_remarks_date\` (\`remark_date\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✓ transfer_remarks table created");
}

await conn.end();
console.log("\n✓ migrate-transfer-remarks complete");
