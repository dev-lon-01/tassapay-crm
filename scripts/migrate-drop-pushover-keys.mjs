/**
 * scripts/migrate-drop-pushover-keys.mjs
 * Drops the pushover_keys column from alert_routings.
 * The user key is now stored in PUSHOVER_USER_KEY env var instead.
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
Object.assign(process.env, env);

const mysql = require("mysql2/promise");
const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

const [cols] = await pool.execute(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_routings' AND COLUMN_NAME = 'pushover_keys'`
);

if (!cols.length) {
  console.log("pushover_keys column does not exist — nothing to do.");
} else {
  await pool.execute("ALTER TABLE alert_routings DROP COLUMN pushover_keys");
  console.log("✓ Dropped alert_routings.pushover_keys");
}

await pool.end();
