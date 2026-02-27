/**
 * scripts/migrate-attribution.mjs
 * Run once: adds attributed_agent_id (transfers) and kyc_attributed_agent_id (customers).
 * Safe to re-run — skips columns/constraints that already exist.
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
  ["ADD COLUMN attributed_agent_id (transfers)",
   "ALTER TABLE `transfers` ADD COLUMN `attributed_agent_id` INT DEFAULT NULL AFTER `delivery_method`"],
  ["ADD FK fk_transfers_attributed_agent",
   "ALTER TABLE `transfers` ADD CONSTRAINT `fk_transfers_attributed_agent` FOREIGN KEY (`attributed_agent_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE"],
  ["ADD COLUMN kyc_attributed_agent_id (customers)",
   "ALTER TABLE `customers` ADD COLUMN `kyc_attributed_agent_id` INT DEFAULT NULL AFTER `assigned_user_id`"],
  ["ADD FK fk_customers_kyc_agent",
   "ALTER TABLE `customers` ADD CONSTRAINT `fk_customers_kyc_agent` FOREIGN KEY (`kyc_attributed_agent_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE"],
  ["ADD COLUMN type (sync_log)",
   "ALTER TABLE `sync_log` ADD COLUMN `type` VARCHAR(50) DEFAULT NULL AFTER `started_at`"],
];

for (const [label, sql] of steps) {
  try {
    await conn.execute(sql);
    console.log(`  ✓  ${label}`);
  } catch (e) {
    // 1060 = duplicate column, 1061 = duplicate key name, 1826 = duplicate FK constraint name
    if (e.errno === 1060 || e.errno === 1061 || e.errno === 1826) {
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
