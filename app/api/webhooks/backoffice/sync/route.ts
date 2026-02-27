import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { parseDateDDMMYYYY, type RawCustomer } from "@/src/lib/customerSync";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

/**
 * POST /api/webhooks/backoffice/sync
 *
 * Accepts a JSON array of raw backoffice customer objects.
 * Extracts only the 8 CRM fields, parses dates, and upserts into MySQL.
 *
 * Example body:
 * [
 *   {
 *     "Customer_ID": "3146",
 *     "Full_Name": "Abdullahi Mire Halane",
 *     "Email_ID": "abdullah.halane@camden.gov.uk",
 *     "Mobile_Number1": "7415984146",
 *     "sender_country": "United Kingdom",
 *     "Record_Insert_DateTime2": "22/02/2026 17:03:39",
 *     "Record_Insert_DateTime": "",
 *     "Risk_status": "Low"
 *   }
 * ]
 *
 * Response:
 *   { "received": 1, "inserted": 1, "updated": 0 }
 */

const UPSERT_SQL = `
INSERT INTO customers
  (customer_id, full_name, email, phone_number, country,
   registration_date, kyc_completion_date, risk_status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  full_name           = VALUES(full_name),
  email               = VALUES(email),
  phone_number        = VALUES(phone_number),
  country             = VALUES(country),
  registration_date   = VALUES(registration_date),
  kyc_completion_date = VALUES(kyc_completion_date),
  risk_status         = VALUES(risk_status),
  synced_at           = CURRENT_TIMESTAMP
`;

function str(v: string | undefined): string | null {
  if (!v || !v.trim()) return null;
  return v.trim();
}

function buildRow(c: RawCustomer): (string | number | null)[] {
  return [
    c.Customer_ID,
    str(c.Full_Name),
    str(c.Email_ID),
    str(c.Mobile_Number1),
    str(c.sender_country),
    parseDateDDMMYYYY(c.Record_Insert_DateTime2),  // registration_date
    parseDateDDMMYYYY(c.Record_Insert_DateTime),   // kyc_completion_date — null if empty
    str(c.Risk_status),
  ];
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be a JSON array of customer objects" },
      { status: 400 }
    );
  }

  const customers = body as RawCustomer[];
  const received = customers.length;

  if (received === 0) {
    return NextResponse.json({ received: 0, inserted: 0, updated: 0 });
  }

  let inserted = 0;
  let updated = 0;
  let attributed = 0;
  const conn: mysql.PoolConnection = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const c of customers) {
      if (!c.Customer_ID) continue;

      // Detect KYC completion event: payload has a KYC date AND the DB row
      // currently has kyc_completion_date IS NULL (or the customer is new).
      const newKycDate = parseDateDDMMYYYY(c.Record_Insert_DateTime);
      let kycJustCompleted = false;

      if (newKycDate) {
        const [existing] = await conn.execute<RowDataPacket[]>(
          "SELECT kyc_completion_date FROM customers WHERE customer_id = ?",
          [c.Customer_ID]
        );
        // existingKyc is null when: no row yet (new customer) OR row has NULL date
        const existingKyc = existing[0]?.kyc_completion_date ?? null;
        kycJustCompleted = existingKyc == null;
      }

      const [result] = await conn.execute(UPSERT_SQL, buildRow(c));
      const r = result as mysql.ResultSetHeader;
      if (r.affectedRows === 1) inserted++;
      else if (r.affectedRows === 2) updated++;

      // Attribution: find last agent who interacted in the past 14 days
      if (kycJustCompleted) {
        const [agentRows] = await conn.execute<RowDataPacket[]>(
          `SELECT agent_id FROM interactions
           WHERE  customer_id = ?
             AND  created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           ORDER BY created_at DESC
           LIMIT 1`,
          [c.Customer_ID]
        );
        const agentId: number | null = agentRows[0]?.agent_id ?? null;
        if (agentId) {
          await conn.execute(
            "UPDATE customers SET kyc_attributed_agent_id = ? WHERE customer_id = ?",
            [agentId, c.Customer_ID]
          );
          attributed++;
        }
      }
    }

    await conn.commit();
  } catch (err: unknown) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/webhooks/backoffice/sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ received, inserted, updated, attributed });
}
