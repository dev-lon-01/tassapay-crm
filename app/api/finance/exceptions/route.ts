import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { requireAdmin } from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";

const UNFUNDED_SQL = `
  SELECT t.id AS transfer_id, t.transaction_ref, t.send_amount, t.send_currency,
         t.status AS transfer_status, t.created_at
  FROM transfers t
  LEFT JOIN payments p ON t.transaction_ref = p.transfer_ref
  WHERE t.status IN ('Paid', 'Deposited')
    AND p.id IS NULL
  ORDER BY t.created_at DESC
`;

const DOUBLE_LOSS_SQL = `
  SELECT t.id AS transfer_id, t.transaction_ref, t.send_amount, t.send_currency,
         t.status AS transfer_status, p.provider, p.payment_date AS refund_date
  FROM transfers t
  JOIN payments p ON t.transaction_ref = p.transfer_ref
  WHERE t.status IN ('Paid', 'Deposited')
    AND p.payment_type = 'refund'
  ORDER BY p.payment_date DESC
`;

const MISMATCHES_SQL = `
  SELECT t.id AS transfer_id, t.transaction_ref,
         t.send_amount AS expected_amount, t.send_currency,
         p.amount AS actual_collected, p.currency AS payment_currency, p.provider
  FROM transfers t
  JOIN payments p ON t.primary_payment_id = p.id
  WHERE t.send_amount != p.amount
    AND t.reconciliation_status = 'mismatch'
  ORDER BY t.created_at DESC
`;

const ORPHANS_SQL = `
  SELECT p.id AS payment_id, p.provider_payment_id, p.amount, p.currency,
         p.provider, p.payment_date, p.transfer_ref, p.reconciliation_note
  FROM payments p
  WHERE p.transfer_ref IS NULL
     OR p.is_reconciled = FALSE
  ORDER BY p.payment_date DESC
`;

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const adminError = requireAdmin(auth);
  if (adminError) return adminError;

  try {
    const [unfunded] = await pool.execute<RowDataPacket[]>(UNFUNDED_SQL);
    const [doubleLoss] = await pool.execute<RowDataPacket[]>(DOUBLE_LOSS_SQL);
    const [mismatches] = await pool.execute<RowDataPacket[]>(MISMATCHES_SQL);
    const [orphans] = await pool.execute<RowDataPacket[]>(ORPHANS_SQL);

    return NextResponse.json({
      unfunded,
      doubleLoss,
      mismatches,
      orphans,
      counts: {
        unfunded: unfunded.length,
        doubleLoss: doubleLoss.length,
        mismatches: mismatches.length,
        orphans: orphans.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/finance/exceptions]", message);
    return jsonError(message, 500);
  }
}
