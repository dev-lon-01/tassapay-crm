import { pool } from "@/src/lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * Commission calculation engine with 5 safety gates:
 *   1. Status gate      — transfer must be Completed or Deposited
 *   2. Attribution gate — transfer must have attributed_agent_id set
 *   3. First-transfer   — must be the customer's first non-Failed qualifying transfer
 *   4. Idempotency      — commission for this transfer_id must not already exist
 *   5. Min threshold    — send_amount must meet minimum commissionable amount
 *
 * Called by webhooks or sync jobs when a transfer status changes.
 */

const COMMISSION_AMOUNT = 5.0; // GBP per qualified first transfer
const QUALIFYING_STATUSES = new Set(["Completed", "Deposited"]);
const MIN_COMMISSIONABLE_AMOUNT = Number(process.env.MIN_COMMISSIONABLE_AMOUNT ?? 50);

export interface CommissionResult {
  created: boolean;
  reason: string;
  commissionId?: number;
}

export async function calculateCommission(transferId: number): Promise<CommissionResult> {
  const conn = await pool.getConnection();
  try {
    // Fetch the transfer
    const [transfers] = await conn.execute<RowDataPacket[]>(
      `SELECT id, customer_id, status, attributed_agent_id, send_amount, created_at
       FROM transfers WHERE id = ?`,
      [transferId],
    );
    if (transfers.length === 0) {
      return { created: false, reason: "Transfer not found" };
    }
    const transfer = transfers[0];

    // Gate 1: Status — must be Completed or Deposited
    if (!QUALIFYING_STATUSES.has(transfer.status)) {
      return { created: false, reason: `Status '${transfer.status}' does not qualify` };
    }

    // Gate 2: Attribution — must have an attributed agent
    if (!transfer.attributed_agent_id) {
      return { created: false, reason: "No attributed agent on transfer" };
    }

    // Gate 5: Min threshold — send_amount must meet minimum
    if (Number(transfer.send_amount ?? 0) < MIN_COMMISSIONABLE_AMOUNT) {
      return { created: false, reason: `Send amount £${transfer.send_amount} below minimum £${MIN_COMMISSIONABLE_AMOUNT}` };
    }

    // Gate 3: First-transfer — must be customer's first non-Failed qualifying transfer
    const [earlier] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM transfers
       WHERE customer_id = ? AND status != 'Failed' AND send_amount >= ? AND id < ?
       ORDER BY id ASC LIMIT 1`,
      [transfer.customer_id, MIN_COMMISSIONABLE_AMOUNT, transferId],
    );
    if (earlier.length > 0) {
      return { created: false, reason: "Not the customer's first qualifying transfer" };
    }

    // Gate 4: Idempotency — commission must not already exist for this transfer
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM commissions WHERE transfer_id = ?`,
      [transferId],
    );
    if (existing.length > 0) {
      return { created: false, reason: "Commission already exists for this transfer" };
    }

    // All gates passed — insert commission
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO commissions (agent_id, customer_id, transfer_id, commission_amount, currency, status)
       VALUES (?, ?, ?, ?, 'GBP', 'pending_approval')`,
      [transfer.attributed_agent_id, transfer.customer_id, transferId, COMMISSION_AMOUNT],
    );

    return {
      created: true,
      reason: "Commission created",
      commissionId: result.insertId,
    };
  } finally {
    conn.release();
  }
}

/**
 * Cancel a commission linked to a transfer (chargeback / reversal).
 *
 * - pending_approval or approved → auto-cancelled
 * - paid → flagged for manual review (status stays 'paid', reason logged)
 *
 * Returns the action taken or null if no commission exists.
 */
export interface CancelResult {
  action: "cancelled" | "flagged_for_review" | "already_cancelled" | "not_found";
  commissionId?: number;
  previousStatus?: string;
}

export async function cancelCommissionForTransfer(
  transferId: number,
  reason: string,
): Promise<CancelResult> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status FROM commissions WHERE transfer_id = ?`,
      [transferId],
    );

    if (rows.length === 0) {
      return { action: "not_found" };
    }

    const commission = rows[0];

    if (commission.status === "cancelled") {
      return { action: "already_cancelled", commissionId: commission.id };
    }

    if (commission.status === "paid") {
      // Paid commissions need manual review — log the reason but don't auto-cancel
      await conn.execute<ResultSetHeader>(
        `UPDATE commissions SET cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?`,
        [`[REVIEW NEEDED] ${reason}`, commission.id],
      );
      return { action: "flagged_for_review", commissionId: commission.id, previousStatus: "paid" };
    }

    // pending_approval or approved → auto-cancel
    await conn.execute<ResultSetHeader>(
      `UPDATE commissions SET status = 'cancelled', cancellation_reason = ?, cancelled_at = NOW() WHERE id = ?`,
      [reason, commission.id],
    );
    return { action: "cancelled", commissionId: commission.id, previousStatus: commission.status };
  } finally {
    conn.release();
  }
}
