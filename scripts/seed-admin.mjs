/**
 * Seed a default admin user.
 * Run once: node scripts/seed-admin.mjs
 *
 * Creates: test@tassapay.com / password123
 */
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

const email = "test@tassapay.com";
const plainPassword = "password123";
const hash = await bcrypt.hash(plainPassword, 12);

const [rows] = await conn.execute(
  "SELECT id FROM users WHERE email = ? LIMIT 1",
  [email]
);

if (rows.length) {
  console.log(`User ${email} already exists – updating password hash.`);
  await conn.execute("UPDATE users SET password_hash = ? WHERE email = ?", [
    hash,
    email,
  ]);
} else {
  await conn.execute(
    "INSERT INTO users (name, role, email, password_hash) VALUES (?, ?, ?, ?)",
    ["Test Admin", "Admin", email, hash]
  );
  console.log(`Created user: ${email}`);
}

await conn.end();
console.log("Done.");
