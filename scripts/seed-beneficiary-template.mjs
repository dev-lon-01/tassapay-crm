/**
 * Seed: insert the "Beneficiary Information Update Required" email template.
 * Safe to re-run (INSERT IGNORE — no-op if id=6 already exists).
 *
 * Run: node scripts/seed-beneficiary-template.mjs
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
  const [result] = await conn.execute(
    `INSERT IGNORE INTO templates (id, name, channel, subject, body) VALUES (?, ?, ?, ?, ?)`,
    [
      6,
      "Beneficiary Information Update Required",
      "Email",
      "Action Required: Update to your TassaPay Transfer [Transfer ID]",
      "Dear {{fullName}},\n\nWe are reaching out regarding your recent transfer ([Transfer ID] for [Amount]). Unfortunately, we have encountered an issue with the beneficiary details provided, and the receiving bank/mobile provider has temporarily halted the transaction.\n\nTo ensure your funds are delivered quickly, please reply to this email or call our support team to confirm the correct recipient Name, Account Number, and Phone Number.\n\nThank you,\nThe TassaPay Team",
    ]
  );
  if (result.affectedRows > 0) {
    console.log("✓ Beneficiary template seeded (id=6).");
  } else {
    console.log("✓ Template id=6 already exists – nothing to do.");
  }
} finally {
  conn.release();
  await pool.end();
}
