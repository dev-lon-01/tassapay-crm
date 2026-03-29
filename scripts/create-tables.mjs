/**
 * scripts/create-tables.mjs
 *
 * Run ONCE to create the database and tables:
 *   node scripts/create-tables.mjs
 *
 * Safe to rerun (all statements use IF NOT EXISTS).
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  multipleStatements: true, // needed to run the full SQL file at once
});

console.log("\nConnected to MySQL. Running schema...\n");

const sql = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf8");
await conn.query(sql);

console.log("✓  Database 'tassapay_crm' created (or already exists)");
console.log("\u2713  Table 'users' created (or already exists)");
console.log("\u2713  Table 'customers' created (or already exists)");
console.log("\u2713  Table 'interactions' created (or already exists)");
console.log("\u2713  Table 'transfers' created (or already exists)");
console.log("\u2713  Table 'payments' created (or already exists)");
console.log("\u2713  Table 'templates' created (or already exists)");
console.log("✓  Table 'sync_log' created (or already exists)\n");

await conn.end();
