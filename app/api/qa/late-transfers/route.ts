import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/qa/late-transfers
 *
 * Returns three buckets of pending transfers that breach SLAs:
 *
 *  somaliaUrgent - Somalia transfers pending > 15 minutes (instant corridor SLA)
 *  oneDayLate    - All other countries, pending 24–48 hours
 *  twoDaysLate   - All other countries, pending > 48 hours
 *
 * "Pending" = status NOT IN ('Completed', 'Deposited')
 *
 * Joins customers for full_name + sender_country (country of the sender).
 */

interface LateTransfer extends RowDataPacket {
  id: number;
  customer_id: string;
  transaction_ref: string;
  created_at: string;
  send_amount: number | null;
  send_currency: string | null;
  receive_amount: number | null;
  receive_currency: string | null;
  destination_country: string | null;
  beneficiary_name: string | null;
  status: string | null;
  hold_reason: string | null;
  payment_method: string | null;
  delivery_method: string | null;
  full_name: string | null;
  sender_country: string | null;
}

const SELECT = `
  SELECT
    t.id, t.customer_id, t.transaction_ref, t.created_at,
    t.send_amount, t.send_currency,
    t.receive_amount, t.receive_currency,
    t.destination_country, t.beneficiary_name,
    t.status, t.hold_reason,
    t.payment_method, t.delivery_method,
    c.full_name,
    c.country AS sender_country
  FROM transfers t
  LEFT JOIN customers c ON t.customer_id = c.customer_id
`;

const PENDING = `t.status = 'Processed'`;

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Region fence: Admins see all rows; Agents see only their allowed_regions.
  // The SELECT already LEFT JOINs customers as `c`, so filtering on `country`
  // (which only exists on the customers table) is unambiguous.
  const cFence  = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
  const cAnd    = cFence ? ` AND ${cFence.sql}` : "";
  const cParams = cFence?.params ?? [];

  try {
    const [
      [somaliaUrgent],
      [oneDayLate],
      [twoDaysLate],
    ] = await Promise.all([
      // Somalia - instant corridor; breach at 15 minutes
      pool.execute<LateTransfer[]>(
        `${SELECT}
         WHERE t.destination_country = 'Somalia'
           AND ${PENDING}
           AND t.created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
           AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           ${cAnd}
         ORDER BY t.created_at ASC`,
        cParams
      ),
      // Standard - 1 day late (24-48 h window)
      pool.execute<LateTransfer[]>(
        `${SELECT}
         WHERE t.destination_country != 'Somalia'
           AND ${PENDING}
           AND t.created_at <= DATE_SUB(NOW(), INTERVAL 1 DAY)
           AND t.created_at >  DATE_SUB(NOW(), INTERVAL 2 DAY)
           AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           ${cAnd}
         ORDER BY t.created_at ASC`,
        cParams
      ),
      // Standard - 2+ days late (> 48 h)
      pool.execute<LateTransfer[]>(
        `${SELECT}
         WHERE t.destination_country != 'Somalia'
           AND ${PENDING}
           AND t.created_at <= DATE_SUB(NOW(), INTERVAL 2 DAY)
           AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           ${cAnd}
         ORDER BY t.created_at ASC`,
        cParams
      ),
    ]);

    return NextResponse.json({ somaliaUrgent, oneDayLate, twoDaysLate });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/qa/late-transfers]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
