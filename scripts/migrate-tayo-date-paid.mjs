/**
 * Migration: add tayo_date_paid column to transfers table.
 * Safe to re-run (IF NOT EXISTS guard via IF / column check).
 *
 * Run: node scripts/migrate-tayo-date-paid.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const pool = await mysql.createPool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const conn = await pool.getConnection();
try {
  // Check if column already exists
  const [rows] = await conn.execute(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'transfers'
       AND COLUMN_NAME  = 'tayo_date_paid'
     LIMIT 1`
  );

  if (rows.length > 0) {
    console.log("✓ tayo_date_paid already exists – nothing to do.");
  } else {
    await conn.execute(
      `ALTER TABLE transfers
       ADD COLUMN tayo_date_paid DATETIME DEFAULT NULL
       AFTER payment_status`
    );
    console.log("✓ Added tayo_date_paid column to transfers.");
  }
} finally {
  conn.release();
  await pool.end();
}
