/**
 * scripts/migrate-account-lookup.mjs
 * Run once: creates account_lookups + account_verifications tables.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

const steps = [
  ["CREATE TABLE account_lookups", `
    CREATE TABLE IF NOT EXISTS \`account_lookups\` (
      \`id\`                   INT           NOT NULL AUTO_INCREMENT,
      \`agent_id\`             INT           NOT NULL,
      \`country_code\`         CHAR(2)       NOT NULL,
      \`provider\`             VARCHAR(32)   NOT NULL,
      \`method_type\`          ENUM('bank','wallet') NOT NULL,
      \`method_code\`          VARCHAR(64)   NOT NULL,
      \`account_number\`       VARCHAR(64)   NOT NULL,
      \`status\`               ENUM('success','failed','error') NOT NULL,
      \`account_name\`         VARCHAR(255)  DEFAULT NULL,
      \`response_code\`        VARCHAR(8)    DEFAULT NULL,
      \`response_description\` VARCHAR(255)  DEFAULT NULL,
      \`raw_response\`         JSON          DEFAULT NULL,
      \`created_at\`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_account_lookups_agent_created\` (\`agent_id\`, \`created_at\`),
      KEY \`idx_account_lookups_acct_country\`  (\`account_number\`, \`country_code\`),
      CONSTRAINT \`fk_account_lookups_agent\` FOREIGN KEY (\`agent_id\`)
        REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `],
  ["CREATE TABLE account_verifications", `
    CREATE TABLE IF NOT EXISTS \`account_verifications\` (
      \`id\`           INT           NOT NULL AUTO_INCREMENT,
      \`lookup_id\`    INT           NOT NULL,
      \`target_type\`  ENUM('transfer','customer') NOT NULL,
      \`target_id\`    VARCHAR(50)   NOT NULL,
      \`attached_by\`  INT           NOT NULL,
      \`attached_at\`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_account_verifications_target\` (\`target_type\`, \`target_id\`),
      CONSTRAINT \`fk_account_verifications_lookup\` FOREIGN KEY (\`lookup_id\`)
        REFERENCES \`account_lookups\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`fk_account_verifications_user\` FOREIGN KEY (\`attached_by\`)
        REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `],
];

for (const [label, sql] of steps) {
  try {
    await conn.execute(sql);
    console.log(`  ✓  ${label}`);
  } catch (e) {
    if (e.errno === 1050) {
      console.log(`  –  ${label} (already exists, skipped)`);
    } else {
      console.error(`  ✗  ${label}: ${e.message}`);
      await conn.end();
      process.exit(1);
    }
  }
}

await conn.end();
console.log("\nMigration complete.");
