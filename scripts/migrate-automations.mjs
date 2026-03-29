#!/usr/bin/env node
/**
 * Migration: automation_rules + communications_log tables
 * Safe to rerun — uses IF NOT EXISTS / INSERT IGNORE.
 *
 * Run: node scripts/migrate-automations.mjs
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

console.log("[migrate] Creating automation_rules ...");
await conn.execute(`
  CREATE TABLE IF NOT EXISTS automation_rules (
    id              INT           PRIMARY KEY AUTO_INCREMENT,
    rule_name       VARCHAR(255)  NOT NULL,
    trigger_key     VARCHAR(100)  NOT NULL UNIQUE,
    delay_hours     INT           NOT NULL,
    is_active       BOOLEAN       DEFAULT FALSE,
    email_subject   VARCHAR(255)  NOT NULL,
    email_template_id VARCHAR(100) NOT NULL,
    updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

console.log("[migrate] Creating communications_log ...");
await conn.execute(`
  CREATE TABLE IF NOT EXISTS communications_log (
    id           VARCHAR(36)  PRIMARY KEY,
    customer_id  INT          NOT NULL,
    rule_id      INT          NOT NULL,
    sent_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)     ON DELETE CASCADE,
    FOREIGN KEY (rule_id)     REFERENCES automation_rules(id) ON DELETE CASCADE,
    UNIQUE KEY unique_customer_rule (customer_id, rule_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

console.log("[migrate] Seeding default rule ...");
await conn.execute(`
  INSERT IGNORE INTO automation_rules
    (rule_name, trigger_key, delay_hours, is_active, email_subject, email_template_id)
  VALUES
    ('72-Hour First Transfer Nudge', 'NUDGE_FIRST_TRANSFER', 72, FALSE,
     'Your first transfer is free!', 'first-transfer-nudge')
`);

const [rules] = await conn.execute("SELECT * FROM automation_rules");
console.log("[migrate] automation_rules:", rules.length, "row(s)");

await conn.end();
console.log("[migrate] Done.");
