/**
 * scripts/migrate-sip-username.mjs
 * Adds sip_username column to users table for per-agent SIP softphone routing.
 * Usage: node scripts/migrate-sip-username.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host:     process.env.DB_HOST     ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME     ?? "tassapay_crm",
});

async function migrate() {
  const conn = await pool.getConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'sip_username'`,
      [process.env.DB_NAME]
    );

    if (cols.length === 0) {
      await conn.query(
        `ALTER TABLE users ADD COLUMN sip_username VARCHAR(100) DEFAULT NULL AFTER voice_available`
      );
      console.log("✓ users.sip_username added");
    } else {
      console.log("· users.sip_username already exists — skipping");
    }

    console.log("\n✅ SIP username migration complete.");
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
