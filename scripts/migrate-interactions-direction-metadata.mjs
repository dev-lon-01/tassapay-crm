/**
 * Migration: add direction and metadata columns to interactions table.
 * Safe to re-run (checks information_schema first).
 *
 * Run: node scripts/migrate-interactions-direction-metadata.mjs
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
  const [existing] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'interactions'
       AND COLUMN_NAME  IN ('direction', 'metadata')`
  );
  const existingNames = new Set(existing.map((r) => r.COLUMN_NAME));

  const alters = [];
  if (!existingNames.has("direction")) {
    alters.push("ADD COLUMN direction VARCHAR(20) DEFAULT NULL AFTER note");
  }
  if (!existingNames.has("metadata")) {
    alters.push("ADD COLUMN metadata JSON DEFAULT NULL AFTER direction");
  }

  if (alters.length === 0) {
    console.log("✓ direction and metadata already exist – nothing to do.");
  } else {
    await conn.execute(`ALTER TABLE interactions ${alters.join(", ")}`);
    console.log(`✓ Added to interactions: ${alters.map((a) => a.split(" ")[2]).join(", ")}.`);
  }
} finally {
  conn.release();
  await pool.end();
}
