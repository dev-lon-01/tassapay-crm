/**
 * Idempotent migration: add allowed_regions + can_view_dashboard to users.
 *
 *   node scripts/migrate-rls-fields.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.env.local",
  ),
});

const pool = await mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND COLUMN_NAME  = ?`,
    [table, column],
  );
  return rows.length > 0;
}

const conn = await pool.getConnection();
try {
  // 1. allowed_regions — JSON array of region codes, defaults to both regions
  if (!(await columnExists(conn, "users", "allowed_regions"))) {
    await conn.query(`ALTER TABLE users ADD COLUMN allowed_regions JSON`);
    // Set default value for all existing rows
    await conn.query(`UPDATE users SET allowed_regions = '["UK","EU"]' WHERE allowed_regions IS NULL`);
    // Make it NOT NULL now that rows are populated
    await conn.query(`ALTER TABLE users MODIFY COLUMN allowed_regions JSON NOT NULL`);
    console.log('✓ Added users.allowed_regions (default ["UK","EU"])');
  } else {
    console.log("– users.allowed_regions already exists, skipped");
  }

  // 2. can_view_dashboard — grants Agent access to Manager Dashboard
  if (!(await columnExists(conn, "users", "can_view_dashboard"))) {
    await conn.query(
      `ALTER TABLE users ADD COLUMN can_view_dashboard TINYINT(1) NOT NULL DEFAULT 0`,
    );
    console.log("✓ Added users.can_view_dashboard (default 0)");
  } else {
    console.log("– users.can_view_dashboard already exists, skipped");
  }

  console.log("\nMigration complete.");
} finally {
  conn.release();
  await pool.end();
}
