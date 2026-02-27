/**
 * scripts/migrate-voice.mjs
 * Adds voice_available column to users table for Twilio inbound routing.
 * Usage: node scripts/migrate-voice.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host:     process.env.DB_HOST ?? "localhost",
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

async function migrate() {
  const conn = await pool.getConnection();
  try {
    // Step 1 — add voice_available to users
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'voice_available'`,
      [process.env.DB_NAME]
    );
    if (cols.length === 0) {
      await conn.query(
        `ALTER TABLE users ADD COLUMN voice_available TINYINT(1) NOT NULL DEFAULT 0`
      );
      console.log("✓ users.voice_available added");
    } else {
      console.log("· users.voice_available already exists — skipping");
    }

    console.log("\n✅ Voice migration complete.");
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
