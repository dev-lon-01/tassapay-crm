/**
 * MySQL connection pool.
 * Used server-side only (API routes, scripts).
 * Reads DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME from env.
 */
import mysql from "mysql2/promise";

declare global {
  // Prevent re-creating the pool during Next.js hot-reload
  // eslint-disable-next-line no-var
  var _mysqlPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "tassapay_crm",
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

export const pool: mysql.Pool =
  globalThis._mysqlPool ?? (globalThis._mysqlPool = createPool());
