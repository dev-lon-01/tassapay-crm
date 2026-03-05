/**
 * lead-conversion-worker.mjs
 *
 * Hourly cron worker that automatically converts Leads to full Customers
 * when they meet either conversion criterion:
 *
 *   A) Phone / email matches an existing TassaPay customer (is_lead = 0)
 *      that has at least one successful transfer.
 *   B) The lead's own record already has a transfer in the DB with
 *      a paid/completed status (manually inserted for testing).
 *
 * On conversion:
 *   • Sets lead_stage = 'Converted', is_lead = 0
 *   • Inserts a System interaction: "Lead automatically converted after first successful transfer."
 *
 * Run: node scripts/lead-conversion-worker.mjs
 * Cron: 0 * * * *   (every hour)
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";

config({ path: ".env.local" });

const PAID_STATUSES = ["paid", "deposited", "Paid", "Deposited", "Processed", "Completed", "completed"];

async function run() {
  const conn = await createConnection({
    host:     process.env.DB_HOST     ?? "localhost",
    port:     Number(process.env.DB_PORT ?? 3306),
    user:     process.env.DB_USER     ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME     ?? "tassapay_crm",
    timezone: "Z",
  });

  try {
    console.log(`[${new Date().toISOString()}] Lead conversion worker starting…`);

    // Fetch all active (non-converted) leads
    const [leads] = await conn.execute(
      `SELECT customer_id, full_name, phone_number, email
       FROM   customers
       WHERE  is_lead = 1
         AND  (lead_stage IS NULL OR lead_stage NOT IN ('Converted', 'Dead'))`,
      []
    );

    console.log(`  Found ${leads.length} active lead(s) to check.`);

    let converted = 0;

    for (const lead of leads) {
      const { customer_id, full_name, phone_number, email } = lead;
      let shouldConvert = false;

      // ── Check A: Transfers directly under this lead's customer_id ─────────
      if (!shouldConvert) {
        const placeholders = PAID_STATUSES.map(() => "?").join(",");
        const [[directCheck]] = await conn.execute(
          `SELECT COUNT(*) AS cnt
           FROM   transfers
           WHERE  customer_id = ?
             AND  status IN (${placeholders})`,
          [customer_id, ...PAID_STATUSES]
        );
        if (directCheck.cnt > 0) shouldConvert = true;
      }

      // ── Check B: Phone/email matches a registered (non-lead) customer ─────
      //    who also has a successful transfer
      if (!shouldConvert && (phone_number || email)) {
        const orClauses = [];
        const clauseParams = [];

        if (phone_number) {
          const norm = phone_number.replace(/[\s\-+]/g, "");
          const last9 = norm.slice(-9);
          orClauses.push(
            "REPLACE(REPLACE(REPLACE(c.phone_number,' ',''),'-',''),'+','') = ?",
            "RIGHT(REPLACE(REPLACE(REPLACE(c.phone_number,' ',''),'-',''),'+',''), 9) = ?"
          );
          clauseParams.push(norm, last9);
        }
        if (email) {
          orClauses.push("c.email = ?");
          clauseParams.push(email);
        }

        if (orClauses.length > 0) {
          const paidPlaceholders = PAID_STATUSES.map(() => "?").join(",");
          const [[match]] = await conn.execute(
            `SELECT COUNT(*) AS cnt
             FROM   customers c
             JOIN   transfers t ON t.customer_id = c.customer_id
             WHERE  c.is_lead = 0
               AND  c.customer_id != ?
               AND  (${orClauses.join(" OR ")})
               AND  t.status IN (${paidPlaceholders})`,
            [customer_id, ...clauseParams, ...PAID_STATUSES]
          );
          if (match.cnt > 0) shouldConvert = true;
        }
      }

      if (!shouldConvert) continue;

      // ── Convert the lead ──────────────────────────────────────────────────
      await conn.execute(
        `UPDATE customers
         SET    lead_stage = 'Converted',
                is_lead    = 0,
                synced_at  = NOW()
         WHERE  customer_id = ?`,
        [customer_id]
      );

      // Log a System interaction
      await conn.execute(
        `INSERT INTO interactions (customer_id, agent_id, type, outcome, note, created_at)
         VALUES (?, NULL, 'System', 'Converted',
                 'Lead automatically converted after first successful transfer.', NOW())`,
        [customer_id]
      );

      converted++;
      console.log(`  ✓ Converted: ${full_name ?? "?"} (${customer_id})`);
    }

    console.log(`\n  Summary: ${converted} lead(s) converted out of ${leads.length} checked.`);
    console.log(`[${new Date().toISOString()}] Worker finished.\n`);
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error("[lead-conversion-worker] Fatal error:", err.message);
  process.exit(1);
});
