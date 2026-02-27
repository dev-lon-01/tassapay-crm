import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * POST /api/webhooks/backoffice/transfers
 *
 * Accepts a JSON array of raw backoffice transfer objects — same shape as the
 * Transaction_Search API payload consumed by scripts/sync-transfers.mjs.
 *
 * Attribution (last-touch, 14-day window):
 *   On the customer's FIRST ever transfer, looks up the most recent interaction
 *   logged by any agent for that customer within the past 14 days and writes
 *   that agent's id into `attributed_agent_id` on the new transfer row.
 *   On subsequent transfers the column is left NULL.
 *   Re-processing an existing transfer (ON DUPLICATE KEY) never overwrites
 *   an existing attribution.
 *
 * Response: { received, inserted, updated, attributed }
 */

interface RawTransfer {
  Customer_ID: string | number;
  ReferenceNo: string;
  Date1?: string;
  Totalamount?: string | number;
  FromCurrency_Code?: string;
  Amount_in_other_cur?: string | number;
  Currency_Code?: string;
  Country_Name?: string;
  Reciever?: string;
  Tx_Status?: string;
  LatestCust_Comment?: string;
  Ptype?: string;
  Type_Name?: string;
}

function str(v: string | number | undefined | null): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: string | number | undefined | null): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function stripHtml(raw: string | null): string | null {
  if (!raw) return null;
  const stripped = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped === "" ? null : stripped;
}

/** "25/02/2026  14:39:44" → "2026-02-25 14:39:44" */
function parseTransferDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().replace(/\s+/, " ");
  const [datePart, timePart] = s.split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${timePart ?? "00:00:00"}`;
}

// attributed_agent_id is in the INSERT values but intentionally absent from
// the ON DUPLICATE KEY UPDATE list — preserving original attribution on re-sync.
const UPSERT_SQL = `
INSERT INTO transfers
  (customer_id, transaction_ref, created_at,
   send_amount, send_currency,
   receive_amount, receive_currency,
   destination_country, beneficiary_name,
   status, hold_reason,
   payment_method, delivery_method,
   attributed_agent_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  customer_id         = VALUES(customer_id),
  created_at          = VALUES(created_at),
  send_amount         = VALUES(send_amount),
  send_currency       = VALUES(send_currency),
  receive_amount      = VALUES(receive_amount),
  receive_currency    = VALUES(receive_currency),
  destination_country = VALUES(destination_country),
  beneficiary_name    = VALUES(beneficiary_name),
  status              = VALUES(status),
  hold_reason         = VALUES(hold_reason),
  payment_method      = VALUES(payment_method),
  delivery_method     = VALUES(delivery_method),
  synced_at           = CURRENT_TIMESTAMP
`;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be a JSON array of transfer objects" },
      { status: 400 }
    );
  }

  const transfers = body as RawTransfer[];
  const received = transfers.length;

  if (received === 0) {
    return NextResponse.json({ received: 0, inserted: 0, updated: 0, attributed: 0 });
  }

  let inserted = 0, updated = 0, attributed = 0;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const t of transfers) {
      if (!t.ReferenceNo || !t.Customer_ID) continue;

      const customerId = String(t.Customer_ID).trim();

      // Detect first transfer for this customer
      const [countRows] = await conn.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM transfers WHERE customer_id = ?",
        [customerId]
      );
      const isFirstTransfer = Number(countRows[0]?.cnt ?? 1) === 0;

      // 14-day last-touch attribution — only on first transfer
      let attributedAgentId: number | null = null;
      if (isFirstTransfer) {
        const [agentRows] = await conn.execute<RowDataPacket[]>(
          `SELECT agent_id FROM interactions
           WHERE  customer_id = ?
             AND  created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           ORDER BY created_at DESC
           LIMIT 1`,
          [customerId]
        );
        attributedAgentId = agentRows[0]?.agent_id ?? null;
        if (attributedAgentId) attributed++;
      }

      const row = [
        customerId,
        str(t.ReferenceNo),
        parseTransferDate(t.Date1),
        num(t.Totalamount),
        str(t.FromCurrency_Code),
        num(t.Amount_in_other_cur),
        str(t.Currency_Code),
        str(t.Country_Name),
        str(t.Reciever),
        str(t.Tx_Status),
        stripHtml(str(t.LatestCust_Comment)),
        str(t.Ptype),
        str(t.Type_Name),
        attributedAgentId,
      ];

      const [result] = await conn.execute<ResultSetHeader>(UPSERT_SQL, row);
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
    }

    await conn.commit();
  } catch (err: unknown) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/webhooks/backoffice/transfers]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ received, inserted, updated, attributed });
}
