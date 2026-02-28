/**
 * Migration: add pushover_enabled column to alert_routings
 * Run: node scripts/migrate-add-pushover-enabled.mjs
 */
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: Number(env.DB_PORT ?? 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const conn = await pool.getConnection();
try {
  // Check if column already exists
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'alert_routings'
       AND COLUMN_NAME  = 'pushover_enabled'`
  );

  if (cols.length > 0) {
    console.log("✓ pushover_enabled column already exists — nothing to do.");
  } else {
    await conn.query(
      `ALTER TABLE alert_routings
       ADD COLUMN pushover_enabled TINYINT(1) NOT NULL DEFAULT 1
       AFTER pushover_priority`
    );
    console.log("✓ Added pushover_enabled TINYINT(1) NOT NULL DEFAULT 1 to alert_routings");
  }
} finally {
  conn.release();
  await pool.end();
}
