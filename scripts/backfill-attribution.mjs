/**
 * Retroactive Attribution & Commission Backfill
 *
 * This script replicates the live attribution logic but anchored to historical dates:
 *
 *   Phase 1 — Transfer attribution (30-day window, Calls > 120s, first transfer only)
 *   Phase 2 — KYC attribution (14-day window, any interaction)
 *   Phase 3 — Commission generation (5 gates from commissionEngine.ts)
 *
 * Usage:
 *   node scripts/backfill-attribution.mjs              # dry-run (default)
 *   node scripts/backfill-attribution.mjs --commit      # actually write changes
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import mysql from "mysql2/promise";

const DRY_RUN = !process.argv.includes("--commit");
const BATCH_SIZE = 100;
const COMMISSION_AMOUNT = 5.0;
const MIN_COMMISSIONABLE_AMOUNT = Number(process.env.MIN_COMMISSIONABLE_AMOUNT ?? 50);
const QUALIFYING_STATUSES = new Set(["Completed", "Deposited"]);

const stats = {
  // Per-agent, per-customer tracking (customer_id sets to avoid double-counting)
  transferByAgent: {},   // { agentId: Set<customerId> }
  kycByAgent: {},        // { agentId: Set<customerId> }
  transfersSkipped: 0,
  kycSkipped: 0,
  commissionsCreated: 0,
  commissionsSkipped: [],
};

// Agent name cache (populated once at start)
const agentNames = {};

function trackAttribution(type, agentId, customerId) {
  const map = type === 'transfer' ? stats.transferByAgent : stats.kycByAgent;
  if (!map[agentId]) map[agentId] = new Set();
  map[agentId].add(customerId);
}

async function main() {
  console.log(`\n=== Attribution Backfill ${DRY_RUN ? "(DRY RUN)" : "(COMMIT MODE)"} ===\n`);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    // Load agent names for summary display
    const [agents] = await conn.execute('SELECT id, name FROM users');
    for (const a of agents) agentNames[a.id] = a.name;

    await phaseTransferAttribution(conn);
    await phaseKycAttribution(conn);
    await phaseCommissions(conn);
    printSummary();
  } finally {
    await conn.end();
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Transfer Attribution
//
// For each customer, find their earliest transfer. If it has no
// attributed_agent_id, look back 30 days from that transfer's created_at
// for the most recent qualifying Call interaction (> 120 seconds).
// ---------------------------------------------------------------------------
async function phaseTransferAttribution(conn) {
  console.log("--- Phase 1: Transfer Attribution ---");

  // Find each customer's first transfer that is currently unattributed.
  // We pick MIN(id) per customer as the "first transfer".
  const [rows] = await conn.execute(`
    SELECT t.id AS transfer_id, t.customer_id, t.created_at
    FROM transfers t
    INNER JOIN (
      SELECT customer_id, MIN(id) AS first_id
      FROM transfers
      GROUP BY customer_id
    ) first ON t.id = first.first_id
    WHERE t.attributed_agent_id IS NULL
    ORDER BY t.id
  `);

  console.log(`  Found ${rows.length} unattributed first-transfers\n`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      // Look back 30 days from the transfer date for last-touch Call > 120s
      const [agentRows] = await conn.execute(
        `SELECT agent_id FROM interactions
         WHERE  customer_id = ?
           AND  agent_id IS NOT NULL
           AND  type = 'Call'
           AND  call_duration_seconds > 120
           AND  created_at >= DATE_SUB(?, INTERVAL 30 DAY)
           AND  created_at <= ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [row.customer_id, row.created_at, row.created_at]
      );

      const agentId = agentRows[0]?.agent_id ?? null;
      if (!agentId) {
        stats.transfersSkipped++;
        continue;
      }

      console.log(
        `  Transfer #${row.transfer_id} (customer ${row.customer_id}) → agent ${agentId} (${agentNames[agentId] || 'Unknown'})`
      );

      if (!DRY_RUN) {
        await conn.execute(
          "UPDATE transfers SET attributed_agent_id = ? WHERE id = ? AND attributed_agent_id IS NULL",
          [agentId, row.transfer_id]
        );
      }
      trackAttribution('transfer', agentId, row.customer_id);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Phase 2: KYC Attribution
//
// For each customer with a kyc_completion_date but no kyc_attributed_agent_id,
// look back 14 days from kyc_completion_date for any interaction.
// ---------------------------------------------------------------------------
async function phaseKycAttribution(conn) {
  console.log("--- Phase 2: KYC Attribution ---");

  const [rows] = await conn.execute(`
    SELECT customer_id, kyc_completion_date
    FROM customers
    WHERE kyc_completion_date IS NOT NULL
      AND kyc_attributed_agent_id IS NULL
    ORDER BY kyc_completion_date
  `);

  console.log(`  Found ${rows.length} unattributed KYC completions\n`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const [agentRows] = await conn.execute(
        `SELECT agent_id FROM interactions
         WHERE  customer_id = ?
           AND  agent_id IS NOT NULL
           AND  created_at >= DATE_SUB(?, INTERVAL 14 DAY)
           AND  created_at <= ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [row.customer_id, row.kyc_completion_date, row.kyc_completion_date]
      );

      const agentId = agentRows[0]?.agent_id ?? null;
      if (!agentId) {
        stats.kycSkipped++;
        continue;
      }

      console.log(
        `  Customer ${row.customer_id} KYC → agent ${agentId} (${agentNames[agentId] || 'Unknown'})`
      );

      if (!DRY_RUN) {
        await conn.execute(
          "UPDATE customers SET kyc_attributed_agent_id = ? WHERE customer_id = ? AND kyc_attributed_agent_id IS NULL",
          [agentId, row.customer_id]
        );
      }
      trackAttribution('kyc', agentId, row.customer_id);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Phase 3: Commission Generation
//
// For every first-transfer that now has an attributed_agent_id, run the
// 5 commission gates and insert a commission if all pass.
// ---------------------------------------------------------------------------
async function phaseCommissions(conn) {
  console.log("--- Phase 3: Commission Generation ---");

  // All first-transfers that have attribution but no commission yet
  const [rows] = await conn.execute(`
    SELECT t.id AS transfer_id, t.customer_id, t.status,
           t.attributed_agent_id, t.send_amount
    FROM transfers t
    INNER JOIN (
      SELECT customer_id, MIN(id) AS first_id
      FROM transfers
      GROUP BY customer_id
    ) first ON t.id = first.first_id
    WHERE t.attributed_agent_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c.transfer_id = t.id)
    ORDER BY t.id
  `);

  console.log(`  Found ${rows.length} attributed first-transfers without commissions\n`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const t of batch) {
      // Gate 1: Status
      if (!QUALIFYING_STATUSES.has(t.status)) {
        stats.commissionsSkipped.push({ id: t.transfer_id, reason: `Status '${t.status}'` });
        continue;
      }

      // Gate 2: Attribution (guaranteed by WHERE clause, but be explicit)
      if (!t.attributed_agent_id) {
        stats.commissionsSkipped.push({ id: t.transfer_id, reason: "No agent" });
        continue;
      }

      // Gate 5: Minimum threshold
      const sendAmount = Number(t.send_amount ?? 0);
      if (sendAmount < MIN_COMMISSIONABLE_AMOUNT) {
        stats.commissionsSkipped.push({ id: t.transfer_id, reason: `Amount £${sendAmount} < £${MIN_COMMISSIONABLE_AMOUNT}` });
        continue;
      }

      // Gate 3: First qualifying transfer (verify no earlier non-Failed transfer above threshold)
      const [earlier] = await conn.execute(
        `SELECT id FROM transfers
         WHERE customer_id = ? AND status != 'Failed' AND send_amount >= ? AND id < ?
         ORDER BY id ASC LIMIT 1`,
        [t.customer_id, MIN_COMMISSIONABLE_AMOUNT, t.transfer_id]
      );
      if (earlier.length > 0) {
        stats.commissionsSkipped.push({ id: t.transfer_id, reason: "Not first qualifying" });
        continue;
      }

      // Gate 4: Idempotency (covered by NOT EXISTS in query, but double-check)
      const [existing] = await conn.execute(
        "SELECT id FROM commissions WHERE transfer_id = ?",
        [t.transfer_id]
      );
      if (existing.length > 0) {
        stats.commissionsSkipped.push({ id: t.transfer_id, reason: "Commission exists" });
        continue;
      }

      console.log(
        `  Commission: transfer #${t.transfer_id} → agent ${t.attributed_agent_id} (£${COMMISSION_AMOUNT})`
      );

      if (!DRY_RUN) {
        await conn.execute(
          `INSERT INTO commissions (agent_id, customer_id, transfer_id, commission_amount, currency, status)
           VALUES (?, ?, ?, ?, 'GBP', 'pending_approval')`,
          [t.attributed_agent_id, t.customer_id, t.transfer_id, COMMISSION_AMOUNT]
        );
      }
      stats.commissionsCreated++;
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
function printSummary() {
  // Collect all agent IDs across both maps
  const allAgentIds = new Set([
    ...Object.keys(stats.transferByAgent),
    ...Object.keys(stats.kycByAgent),
  ]);

  const totalTransferCustomers = Object.values(stats.transferByAgent).reduce((sum, s) => sum + s.size, 0);
  const totalKycCustomers = Object.values(stats.kycByAgent).reduce((sum, s) => sum + s.size, 0);

  console.log("=== Summary ===");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no changes written)" : "COMMIT"}\n`);

  // Per-agent breakdown table
  console.log("  Customer-Level Attribution by Agent:");
  console.log("  " + "-".repeat(72));
  console.log("  " + "Agent".padEnd(22) + "New Transfer".padStart(15) + "KYC".padStart(15) + "Total".padStart(15));
  console.log("  " + "-".repeat(72));

  const sortedAgents = [...allAgentIds]
    .map(Number)
    .sort((a, b) => {
      const totalA = (stats.transferByAgent[a]?.size || 0) + (stats.kycByAgent[a]?.size || 0);
      const totalB = (stats.transferByAgent[b]?.size || 0) + (stats.kycByAgent[b]?.size || 0);
      return totalB - totalA;
    });

  for (const agentId of sortedAgents) {
    const tCount = stats.transferByAgent[agentId]?.size || 0;
    const kCount = stats.kycByAgent[agentId]?.size || 0;
    const name = agentNames[agentId] || `Agent ${agentId}`;
    console.log(
      "  " +
      `${name} (#${agentId})`.padEnd(22) +
      String(tCount).padStart(15) +
      String(kCount).padStart(15) +
      String(tCount + kCount).padStart(15)
    );
  }

  console.log("  " + "-".repeat(72));
  console.log(
    "  " +
    "TOTAL".padEnd(22) +
    String(totalTransferCustomers).padStart(15) +
    String(totalKycCustomers).padStart(15) +
    String(totalTransferCustomers + totalKycCustomers).padStart(15)
  );
  console.log();

  console.log(`  Skipped (no matching interaction): ${stats.transfersSkipped} transfers, ${stats.kycSkipped} KYC`);
  console.log(`  Commissions created: ${stats.commissionsCreated}`);

  if (stats.commissionsSkipped.length > 0) {
    console.log(`  Commissions skipped: ${stats.commissionsSkipped.length}`);
    const grouped = {};
    for (const s of stats.commissionsSkipped) {
      grouped[s.reason] = (grouped[s.reason] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(grouped)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  if (DRY_RUN) {
    console.log("\n  To apply changes, re-run with: node scripts/backfill-attribution.mjs --commit");
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
