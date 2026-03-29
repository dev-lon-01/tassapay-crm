/**
 * BDD Test Scenarios for the Commission Engine
 *
 * Tests the 4-gate commission calculation logic:
 *   Gate 1: Status      — transfer must be Completed or Deposited
 *   Gate 2: Attribution — transfer must have attributed_agent_id
 *   Gate 3: First-transfer — must be customer's first non-Failed transfer
 *   Gate 4: Idempotency — no duplicate commissions per transfer
 *
 * Usage:
 *   node scripts/test-commission-engine.mjs
 *
 * Requires: DB connection (uses real DB via pool), and the commissions table to exist.
 */

import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
  waitForConnections: true,
  connectionLimit: 5,
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_CUSTOMER_ID = "__TEST_COMM_CUST__";
const TEST_AGENT_ID_SLOT = 999990; // will be created as needed
const TEST_AGENT_ID_SLOT_2 = 999991; // second agent for tug-of-war
let testAgentId = null;
let testAgentId2 = null;
let testTransferIds = [];
let testInteractionIds = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

async function setup() {
  const conn = await pool.getConnection();
  try {
    // Create test agents
    await conn.execute(
      `INSERT IGNORE INTO users (id, name, role, email, password_hash) VALUES (?, 'Test Agent', 'Agent', 'test-comm@test.local', 'x')`,
      [TEST_AGENT_ID_SLOT],
    );
    testAgentId = TEST_AGENT_ID_SLOT;

    await conn.execute(
      `INSERT IGNORE INTO users (id, name, role, email, password_hash) VALUES (?, 'Test Agent 2', 'Agent', 'test-comm2@test.local', 'x')`,
      [TEST_AGENT_ID_SLOT_2],
    );
    testAgentId2 = TEST_AGENT_ID_SLOT_2;

    // Create test customer
    await conn.execute(
      `INSERT IGNORE INTO customers (customer_id, full_name, country, registration_date)
       VALUES (?, 'Test Commission Customer', 'United Kingdom', NOW())`,
      [TEST_CUSTOMER_ID],
    );
  } finally {
    conn.release();
  }
}

async function teardown() {
  const conn = await pool.getConnection();
  try {
    // Clean up in reverse dependency order
    for (const tid of testTransferIds) {
      await conn.execute(`DELETE FROM commissions WHERE transfer_id = ?`, [tid]);
    }
    for (const tid of testTransferIds) {
      await conn.execute(`DELETE FROM transfers WHERE id = ?`, [tid]);
    }
    for (const iid of testInteractionIds) {
      await conn.execute(`DELETE FROM interactions WHERE id = ?`, [iid]);
    }
    await conn.execute(`DELETE FROM customers WHERE customer_id = ?`, [TEST_CUSTOMER_ID]);
    await conn.execute(`DELETE FROM users WHERE id = ?`, [TEST_AGENT_ID_SLOT]);
    await conn.execute(`DELETE FROM users WHERE id = ?`, [TEST_AGENT_ID_SLOT_2]);
  } finally {
    conn.release();
  }
}

async function insertTransfer(status, agentId, ref, sendAmount = 100.00) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO transfers (customer_id, transaction_ref, status, attributed_agent_id, send_amount, send_currency, created_at)
       VALUES (?, ?, ?, ?, ?, 'GBP', NOW())`,
      [TEST_CUSTOMER_ID, ref, status, agentId, sendAmount],
    );
    const id = result.insertId;
    testTransferIds.push(id);
    return id;
  } finally {
    conn.release();
  }
}

async function insertInteraction(agentId, type, durationSeconds, daysAgo = 0) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO interactions (customer_id, agent_id, type, call_duration_seconds, notes, created_at)
       VALUES (?, ?, ?, ?, 'test interaction', DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [TEST_CUSTOMER_ID, agentId, type, durationSeconds, daysAgo],
    );
    const id = result.insertId;
    testInteractionIds.push(id);
    return id;
  } finally {
    conn.release();
  }
}

// ─── Commission engine (inline mirror for testing without Next.js imports) ───

const QUALIFYING_STATUSES = new Set(["Completed", "Deposited"]);
const COMMISSION_AMOUNT = 5.0;
const MIN_COMMISSIONABLE_AMOUNT = 50;

async function calculateCommission(transferId) {
  const conn = await pool.getConnection();
  try {
    const [transfers] = await conn.execute(
      `SELECT id, customer_id, status, attributed_agent_id, send_amount FROM transfers WHERE id = ?`,
      [transferId],
    );
    if (transfers.length === 0) return { created: false, reason: "Transfer not found" };
    const transfer = transfers[0];

    // Gate 1
    if (!QUALIFYING_STATUSES.has(transfer.status)) {
      return { created: false, reason: `Status '${transfer.status}' does not qualify` };
    }
    // Gate 2
    if (!transfer.attributed_agent_id) {
      return { created: false, reason: "No attributed agent on transfer" };
    }
    // Gate 5: Min threshold
    if (Number(transfer.send_amount ?? 0) < MIN_COMMISSIONABLE_AMOUNT) {
      return { created: false, reason: `Send amount £${transfer.send_amount} below minimum £${MIN_COMMISSIONABLE_AMOUNT}` };
    }
    // Gate 3 (threshold-aware)
    const [earlier] = await conn.execute(
      `SELECT id FROM transfers WHERE customer_id = ? AND status != 'Failed' AND send_amount >= ? AND id < ? ORDER BY id ASC LIMIT 1`,
      [transfer.customer_id, MIN_COMMISSIONABLE_AMOUNT, transferId],
    );
    if (earlier.length > 0) {
      return { created: false, reason: "Not the customer's first qualifying transfer" };
    }
    // Gate 4
    const [existing] = await conn.execute(
      `SELECT id FROM commissions WHERE transfer_id = ?`,
      [transferId],
    );
    if (existing.length > 0) {
      return { created: false, reason: "Commission already exists for this transfer" };
    }

    const [result] = await conn.execute(
      `INSERT INTO commissions (agent_id, customer_id, transfer_id, commission_amount, currency, status)
       VALUES (?, ?, ?, ?, 'GBP', 'pending_approval')`,
      [transfer.attributed_agent_id, transfer.customer_id, transferId, COMMISSION_AMOUNT],
    );
    return { created: true, reason: "Commission created", commissionId: result.insertId };
  } finally {
    conn.release();
  }
}

async function cancelCommissionForTransfer(transferId, reason) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, status FROM commissions WHERE transfer_id = ?`,
      [transferId],
    );
    if (rows.length === 0) return { action: "not_found" };

    const commission = rows[0];
    if (commission.status === "cancelled") {
      return { action: "already_cancelled", commissionId: commission.id };
    }
    if (commission.status === "paid") {
      await conn.execute(
        `UPDATE commissions SET cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?`,
        [`[REVIEW NEEDED] ${reason}`, commission.id],
      );
      return { action: "flagged_for_review", commissionId: commission.id, previousStatus: "paid" };
    }

    await conn.execute(
      `UPDATE commissions SET status = 'cancelled', cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?`,
      [reason, commission.id],
    );
    return { action: "cancelled", commissionId: commission.id, previousStatus: commission.status };
  } finally {
    conn.release();
  }
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

async function scenarioA() {
  console.log("\nScenario A: Happy path — first Completed transfer with agent attribution");
  const tid = await insertTransfer("Completed", testAgentId, `__TEST_A_${Date.now()}`);
  const result = await calculateCommission(tid);
  assert(result.created === true, "Commission is created");
  assert(result.commissionId > 0, "Commission ID returned");

  // Verify DB row
  const [rows] = await pool.execute(`SELECT * FROM commissions WHERE transfer_id = ?`, [tid]);
  assert(rows.length === 1, "Exactly 1 commission row in DB");
  assert(Number(rows[0].commission_amount) === 5.0, "Commission amount is £5.00");
  assert(rows[0].status === "pending_approval", "Status is pending_approval");
  assert(rows[0].agent_id === testAgentId, "Agent ID matches");
}

async function scenarioB() {
  console.log("\nScenario B: Gate 1 — transfer status is 'Hold' (not qualifying)");
  const tid = await insertTransfer("Hold", testAgentId, `__TEST_B_${Date.now()}`);
  const result = await calculateCommission(tid);
  assert(result.created === false, "Commission is NOT created");
  assert(result.reason.includes("does not qualify"), "Reason mentions status");
}

async function scenarioC() {
  console.log("\nScenario C: Gate 2 — no attributed agent");
  const tid = await insertTransfer("Completed", null, `__TEST_C_${Date.now()}`);
  const result = await calculateCommission(tid);
  assert(result.created === false, "Commission is NOT created");
  assert(result.reason.includes("No attributed agent"), "Reason mentions missing agent");
}

async function scenarioD() {
  console.log("\nScenario D: Gate 3 — second transfer for same customer (not first)");
  // Scenario A already created the first transfer, so this is the second
  const tid = await insertTransfer("Deposited", testAgentId, `__TEST_D_${Date.now()}`);
  const result = await calculateCommission(tid);
  assert(result.created === false, "Commission is NOT created");
  assert(result.reason.includes("first qualifying"), "Reason mentions not first");
}

async function scenarioE() {
  console.log("\nScenario E: Gate 4 — idempotency (re-running same transfer)");
  // Re-run on the transfer from Scenario A which already has a commission
  const firstTransferId = testTransferIds[0]; // from Scenario A
  const result = await calculateCommission(firstTransferId);
  assert(result.created === false, "Commission is NOT created");
  assert(result.reason.includes("already exists"), "Reason mentions idempotency");
}

async function scenarioF() {
  console.log("\nScenario F: Gate 5 — micro-transfer below £50 threshold");
  const tid = await insertTransfer("Completed", testAgentId, `__TEST_F_${Date.now()}`, 25.00);
  const result = await calculateCommission(tid);
  assert(result.created === false, "Commission is NOT created");
  assert(result.reason.includes("below minimum"), "Reason mentions minimum threshold");
}

async function scenarioG() {
  console.log("\nScenario G: Sub-threshold then above — £30 transfer followed by £100 transfer");
  // The £30 transfer should not count as the "first qualifying transfer"
  // so the £100 should still earn a commission.
  // We need a fresh customer to test this cleanly.
  const CUST_G = "__TEST_COMM_CUST_G__";
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `INSERT IGNORE INTO customers (customer_id, full_name, country, registration_date) VALUES (?, 'Test SubThreshold Customer', 'United Kingdom', NOW())`,
      [CUST_G],
    );
  } finally {
    conn.release();
  }

  // Insert sub-threshold transfer (£30)
  const conn2 = await pool.getConnection();
  let tidLow, tidHigh;
  try {
    const [r1] = await conn2.execute(
      `INSERT INTO transfers (customer_id, transaction_ref, status, attributed_agent_id, send_amount, send_currency, created_at)
       VALUES (?, ?, 'Completed', ?, 30.00, 'GBP', NOW())`,
      [CUST_G, `__TEST_G_LOW_${Date.now()}`, testAgentId],
    );
    tidLow = r1.insertId;
    testTransferIds.push(tidLow);

    const [r2] = await conn2.execute(
      `INSERT INTO transfers (customer_id, transaction_ref, status, attributed_agent_id, send_amount, send_currency, created_at)
       VALUES (?, ?, 'Completed', ?, 100.00, 'GBP', NOW())`,
      [CUST_G, `__TEST_G_HIGH_${Date.now()}`, testAgentId],
    );
    tidHigh = r2.insertId;
    testTransferIds.push(tidHigh);
  } finally {
    conn2.release();
  }

  const r1 = await calculateCommission(tidLow);
  assert(r1.created === false, "Sub-threshold transfer does NOT earn commission");

  const r2 = await calculateCommission(tidHigh);
  assert(r2.created === true, "Above-threshold transfer DOES earn commission (sub-threshold ignored in Gate 3)");

  // Cleanup customer G
  const conn3 = await pool.getConnection();
  try {
    await conn3.execute(`DELETE FROM commissions WHERE transfer_id IN (?, ?)`, [tidLow, tidHigh]);
    await conn3.execute(`DELETE FROM transfers WHERE id IN (?, ?)`, [tidLow, tidHigh]);
    await conn3.execute(`DELETE FROM customers WHERE customer_id = ?`, [CUST_G]);
  } finally {
    conn3.release();
  }
  // Remove from tracking since already cleaned
  testTransferIds = testTransferIds.filter(id => id !== tidLow && id !== tidHigh);
}

async function scenarioH() {
  console.log("\nScenario H: Reversal auto-cancel — pending commission gets cancelled on chargeback");
  const CUST_H = "__TEST_COMM_CUST_H__";
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `INSERT IGNORE INTO customers (customer_id, full_name, country, registration_date) VALUES (?, 'Test Reversal Customer', 'United Kingdom', NOW())`,
      [CUST_H],
    );
  } finally {
    conn.release();
  }

  const conn2 = await pool.getConnection();
  let tid;
  try {
    const [r] = await conn2.execute(
      `INSERT INTO transfers (customer_id, transaction_ref, status, attributed_agent_id, send_amount, send_currency, created_at)
       VALUES (?, ?, 'Completed', ?, 100.00, 'GBP', NOW())`,
      [CUST_H, `__TEST_H_${Date.now()}`, testAgentId],
    );
    tid = r.insertId;
    testTransferIds.push(tid);
  } finally {
    conn2.release();
  }

  // Create commission first
  const cr = await calculateCommission(tid);
  assert(cr.created === true, "Commission created for reversal test");

  // Now cancel it (simulating chargeback)
  const cancelResult = await cancelCommissionForTransfer(tid, "Chargeback on transfer");
  assert(cancelResult.action === "cancelled", "Commission auto-cancelled");
  assert(cancelResult.previousStatus === "pending_approval", "Was pending_approval before cancel");

  // Verify DB
  const [rows] = await pool.execute(`SELECT status, cancellation_reason FROM commissions WHERE transfer_id = ?`, [tid]);
  assert(rows[0].status === "cancelled", "DB status is 'cancelled'");
  assert(rows[0].cancellation_reason.includes("Chargeback"), "Cancellation reason logged");

  // Cleanup
  const conn3 = await pool.getConnection();
  try {
    await conn3.execute(`DELETE FROM commissions WHERE transfer_id = ?`, [tid]);
    await conn3.execute(`DELETE FROM transfers WHERE id = ?`, [tid]);
    await conn3.execute(`DELETE FROM customers WHERE customer_id = ?`, [CUST_H]);
  } finally {
    conn3.release();
  }
  testTransferIds = testTransferIds.filter(id => id !== tid);
}

async function scenarioI() {
  console.log("\nScenario I: Reversal on paid commission — flagged for review, not auto-cancelled");
  const CUST_I = "__TEST_COMM_CUST_I__";
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `INSERT IGNORE INTO customers (customer_id, full_name, country, registration_date) VALUES (?, 'Test Paid Reversal Customer', 'United Kingdom', NOW())`,
      [CUST_I],
    );
  } finally {
    conn.release();
  }

  const conn2 = await pool.getConnection();
  let tid;
  try {
    const [r] = await conn2.execute(
      `INSERT INTO transfers (customer_id, transaction_ref, status, attributed_agent_id, send_amount, send_currency, created_at)
       VALUES (?, ?, 'Completed', ?, 100.00, 'GBP', NOW())`,
      [CUST_I, `__TEST_I_${Date.now()}`, testAgentId],
    );
    tid = r.insertId;
    testTransferIds.push(tid);
  } finally {
    conn2.release();
  }

  // Create commission and manually move to paid
  await calculateCommission(tid);
  await pool.execute(`UPDATE commissions SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE transfer_id = ?`, [testAgentId, tid]);
  await pool.execute(`UPDATE commissions SET status = 'paid', paid_by = ?, paid_at = NOW() WHERE transfer_id = ?`, [testAgentId, tid]);

  // Now try to cancel (simulating refund on paid commission)
  const cancelResult = await cancelCommissionForTransfer(tid, "Refund on paid transfer");
  assert(cancelResult.action === "flagged_for_review", "Paid commission flagged for review");
  assert(cancelResult.previousStatus === "paid", "Was paid before flag");

  // Verify DB — status should still be 'paid' (not auto-cancelled)
  const [rows] = await pool.execute(`SELECT status, cancellation_reason FROM commissions WHERE transfer_id = ?`, [tid]);
  assert(rows[0].status === "paid", "DB status remains 'paid' (not auto-cancelled)");
  assert(rows[0].cancellation_reason.includes("[REVIEW NEEDED]"), "Review flag in reason");

  // Cleanup
  const conn3 = await pool.getConnection();
  try {
    await conn3.execute(`DELETE FROM commissions WHERE transfer_id = ?`, [tid]);
    await conn3.execute(`DELETE FROM transfers WHERE id = ?`, [tid]);
    await conn3.execute(`DELETE FROM customers WHERE customer_id = ?`, [CUST_I]);
  } finally {
    conn3.release();
  }
  testTransferIds = testTransferIds.filter(id => id !== tid);
}

async function scenarioJ() {
  console.log("\nScenario J: Cancel on non-existent commission — returns not_found");
  // Use a transfer with no commission
  const tid = await insertTransfer("Completed", null, `__TEST_J_${Date.now()}`);
  const cancelResult = await cancelCommissionForTransfer(tid, "Testing cancel on non-existent");
  assert(cancelResult.action === "not_found", "Returns not_found when no commission exists");
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  console.log("Commission Engine BDD Tests");
  console.log("═".repeat(50));

  try {
    await setup();
    await scenarioA();
    await scenarioB();
    await scenarioC();
    await scenarioD();
    await scenarioE();
    await scenarioF();
    await scenarioG();
    await scenarioH();
    await scenarioI();
    await scenarioJ();
  } catch (err) {
    console.error("\nFATAL:", err);
    failed++;
  } finally {
    await teardown();
    console.log("\n" + "═".repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
