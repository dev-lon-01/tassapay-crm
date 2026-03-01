/**
 * scripts/migrate-dropdowns.mjs
 * Creates system_dropdowns table and seeds all initial outcome values.
 * Idempotent — safe to run multiple times.
 * Usage: node scripts/migrate-dropdowns.mjs
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

const SEEDS = [
  // call_outcome — used in PostCallModal after every call
  { category: "call_outcome", label: "Spoke with Customer",      sort_order: 1 },
  { category: "call_outcome", label: "No Answer",                sort_order: 2 },
  { category: "call_outcome", label: "Left Voicemail",           sort_order: 3 },
  { category: "call_outcome", label: "Left SMS",                 sort_order: 4 },
  { category: "call_outcome", label: "Promised to Upload ID",    sort_order: 5 },
  { category: "call_outcome", label: "Guided Through App",       sort_order: 6 },
  { category: "call_outcome", label: "Requested Call Back",      sort_order: 7 },
  { category: "call_outcome", label: "Not Interested",           sort_order: 8 },
  { category: "call_outcome", label: "Wrong Number",             sort_order: 9 },
  { category: "call_outcome", label: "Escalated to Compliance",  sort_order: 10 },

  // focus_outcome — used in Focus Mode on the customer profile
  { category: "focus_outcome", label: "No Answer",               sort_order: 1 },
  { category: "focus_outcome", label: "Left Voicemail",          sort_order: 2 },
  { category: "focus_outcome", label: "Left SMS",                sort_order: 3 },
  { category: "focus_outcome", label: "Promised to Upload ID",   sort_order: 4 },
  { category: "focus_outcome", label: "Guided Through App",      sort_order: 5 },
  { category: "focus_outcome", label: "Requested Call Back",     sort_order: 6 },
  { category: "focus_outcome", label: "Not Interested",          sort_order: 7 },
  { category: "focus_outcome", label: "Wrong Number",            sort_order: 8 },

  // note_outcome — used in the Note logger tab
  { category: "note_outcome", label: "General Note",             sort_order: 1 },
  { category: "note_outcome", label: "Spoke with Customer",      sort_order: 2 },
  { category: "note_outcome", label: "Left Voicemail",           sort_order: 3 },
  { category: "note_outcome", label: "Left SMS",                 sort_order: 4 },
  { category: "note_outcome", label: "ID Verified",              sort_order: 5 },
  { category: "note_outcome", label: "Escalated to Compliance",  sort_order: 6 },
  { category: "note_outcome", label: "Follow-up Scheduled",      sort_order: 7 },
];

async function migrate() {
  const conn = await pool.getConnection();
  try {
    // 1. Create table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`system_dropdowns\` (
        \`id\`          INT           NOT NULL AUTO_INCREMENT,
        \`category\`    VARCHAR(50)   NOT NULL,
        \`label\`       VARCHAR(100)  NOT NULL,
        \`sort_order\`  INT           NOT NULL DEFAULT 0,
        \`is_active\`   TINYINT(1)    NOT NULL DEFAULT 1,
        \`created_at\`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_dropdown\` (\`category\`, \`label\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ system_dropdowns table ready");

    // 2. Seed — INSERT IGNORE skips duplicates on reruns
    let inserted = 0;
    for (const row of SEEDS) {
      const [result] = await conn.query(
        `INSERT IGNORE INTO system_dropdowns (category, label, sort_order) VALUES (?, ?, ?)`,
        [row.category, row.label, row.sort_order]
      );
      if (result.affectedRows > 0) inserted++;
    }
    console.log(`✓ Seeded ${inserted} new rows (${SEEDS.length - inserted} already existed)`);

    console.log("\n✅ Dropdowns migration complete.");
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
