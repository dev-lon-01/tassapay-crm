import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { validateBackofficeSignature } from "@/src/lib/backofficeWebhook";
import { jsonError } from "@/src/lib/httpResponses";
import { cancelCommissionForTransfer } from "@/src/lib/commissionEngine";
import {
  isPlainObject,
  parseJsonText,
  RequestValidationError,
  type ValidationIssue,
} from "@/src/lib/requestValidation";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

interface RawTransfer {
  Customer_ID: string;
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
  return Number.isNaN(n) ? null : n;
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

function parseTransferDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().replace(/\s+/, " ");
  const [datePart, timePart] = s.split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${timePart ?? "00:00:00"}`;
}

function stringLike(value: unknown, field: string, issues: ValidationIssue[], index: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  issues.push({ field, index, message: "Expected a string" });
  return undefined;
}

function validateTransfersPayload(value: unknown): RawTransfer[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError("Invalid request payload", [
      { field: "body", message: "Body must be a JSON array of transfer objects" },
    ]);
  }

  const issues: ValidationIssue[] = [];
  const transfers: RawTransfer[] = [];

  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push({ field: "body", index, message: "Each row must be an object" });
      return;
    }

    const customerId = stringLike(entry.Customer_ID, "Customer_ID", issues, index);
    const referenceNo = stringLike(entry.ReferenceNo, "ReferenceNo", issues, index);

    if (!customerId) {
      issues.push({ field: "Customer_ID", index, message: "Customer_ID is required" });
    }
    if (!referenceNo) {
      issues.push({ field: "ReferenceNo", index, message: "ReferenceNo is required" });
    }
    if (!customerId || !referenceNo) {
      return;
    }

    transfers.push({
      Customer_ID: customerId,
      ReferenceNo: referenceNo,
      Date1: stringLike(entry.Date1, "Date1", issues, index),
      Totalamount: entry.Totalamount as string | number | undefined,
      FromCurrency_Code: stringLike(entry.FromCurrency_Code, "FromCurrency_Code", issues, index),
      Amount_in_other_cur: entry.Amount_in_other_cur as string | number | undefined,
      Currency_Code: stringLike(entry.Currency_Code, "Currency_Code", issues, index),
      Country_Name: stringLike(entry.Country_Name, "Country_Name", issues, index),
      Reciever: stringLike(entry.Reciever, "Reciever", issues, index),
      Tx_Status: stringLike(entry.Tx_Status, "Tx_Status", issues, index),
      LatestCust_Comment: stringLike(entry.LatestCust_Comment, "LatestCust_Comment", issues, index),
      Ptype: stringLike(entry.Ptype, "Ptype", issues, index),
      Type_Name: stringLike(entry.Type_Name, "Type_Name", issues, index),
    });
  });

  if (issues.length > 0) {
    throw new RequestValidationError("Invalid request payload", issues);
  }

  return transfers;
}

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
  try {
    const rawBody = await req.text();
    const signatureCheck = validateBackofficeSignature(
      rawBody,
      req.headers.get("x-backoffice-signature")
    );

    if (!signatureCheck.valid) {
      const message = `Backoffice transfers webhook rejected (${signatureCheck.reason})`;
      if (signatureCheck.enforce) {
        return jsonError(message, 401);
      }
      console.warn(`[POST /api/webhooks/backoffice/transfers] ${message}`);
    }

    const transfers = validateTransfersPayload(parseJsonText(rawBody));
    const received = transfers.length;

    if (received === 0) {
      return NextResponse.json({ received: 0, inserted: 0, updated: 0, attributed: 0 });
    }

    let inserted = 0;
    let updated = 0;
    let attributed = 0;
    const reversalRefs: string[] = [];
    const REVERSAL_STATUSES = new Set(["Failed", "Refunded", "Returned", "Chargeback", "Cancelled"]);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      for (const transfer of transfers) {
        const customerId = String(transfer.Customer_ID).trim();

        const [countRows] = await conn.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS cnt FROM transfers WHERE customer_id = ?",
          [customerId]
        );
        const isFirstTransfer = Number(countRows[0]?.cnt ?? 1) === 0;

        let attributedAgentId: number | null = null;
        if (isFirstTransfer) {
          const [agentRows] = await conn.execute<RowDataPacket[]>(
            `SELECT agent_id FROM interactions
             WHERE  customer_id = ?
               AND  agent_id IS NOT NULL
               AND  type = 'Call'
               AND  call_duration_seconds > 120
               AND  created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             ORDER BY created_at DESC
             LIMIT 1`,
            [customerId]
          );
          attributedAgentId = agentRows[0]?.agent_id ?? null;
          if (attributedAgentId) attributed++;
        }

        const row = [
          customerId,
          str(transfer.ReferenceNo),
          parseTransferDate(transfer.Date1),
          num(transfer.Totalamount),
          str(transfer.FromCurrency_Code),
          num(transfer.Amount_in_other_cur),
          str(transfer.Currency_Code),
          str(transfer.Country_Name),
          str(transfer.Reciever),
          str(transfer.Tx_Status),
          stripHtml(str(transfer.LatestCust_Comment)),
          str(transfer.Ptype),
          str(transfer.Type_Name),
          attributedAgentId,
        ];

        const [result] = await conn.execute<ResultSetHeader>(UPSERT_SQL, row);
        if (result.affectedRows === 1) inserted++;
        else if (result.affectedRows === 2) updated++;

        // Track reversals for post-commit commission cancellation
        const txStatus = str(transfer.Tx_Status);
        if (txStatus && REVERSAL_STATUSES.has(txStatus)) {
          const ref = str(transfer.ReferenceNo);
          if (ref) reversalRefs.push(ref);
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Post-commit: cancel commissions for any reversal-status transfers
    let cancelled = 0;
    for (const ref of reversalRefs) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM transfers WHERE transaction_ref = ?`,
          [ref],
        );
        if (rows.length > 0) {
          const result = await cancelCommissionForTransfer(
            rows[0].id,
            `Transfer ${ref} status changed to ${rows[0].status}`,
          );
          if (result.action === "cancelled" || result.action === "flagged_for_review") {
            cancelled++;
          }
        }
      } catch (err) {
        console.error(`[webhook/transfers] Failed to cancel commission for ref=${ref}:`, err);
      }
    }

    return NextResponse.json({ received, inserted, updated, attributed, cancelled });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/webhooks/backoffice/transfers]", message);
    return jsonError(message, 500);
  }
}

