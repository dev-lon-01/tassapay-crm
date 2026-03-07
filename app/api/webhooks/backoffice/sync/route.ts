import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { validateBackofficeSignature } from "@/src/lib/backofficeWebhook";
import { jsonError } from "@/src/lib/httpResponses";
import { getPhoneLast9, normalizePhoneValue } from "@/src/lib/phoneUtils";
import {
  isPlainObject,
  parseJsonText,
  RequestValidationError,
  type ValidationIssue,
} from "@/src/lib/requestValidation";
import { parseDateDDMMYYYY, type RawCustomer } from "@/src/lib/customerSync";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

const UPSERT_SQL = `
INSERT INTO customers
  (customer_id, full_name, email, phone_number, phone_normalized, phone_last9, country,
   registration_date, kyc_completion_date, risk_status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  full_name           = VALUES(full_name),
  email               = VALUES(email),
  phone_number        = VALUES(phone_number),
  phone_normalized    = VALUES(phone_normalized),
  phone_last9         = VALUES(phone_last9),
  country             = VALUES(country),
  registration_date   = VALUES(registration_date),
  kyc_completion_date = VALUES(kyc_completion_date),
  risk_status         = VALUES(risk_status),
  synced_at           = CURRENT_TIMESTAMP
`;

function str(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  return value.trim();
}

function stringLike(value: unknown, field: string, issues: ValidationIssue[], index: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  issues.push({ field, index, message: "Expected a string" });
  return undefined;
}

function validateCustomersPayload(value: unknown): RawCustomer[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError("Invalid request payload", [
      { field: "body", message: "Body must be a JSON array of customer objects" },
    ]);
  }

  const issues: ValidationIssue[] = [];
  const customers: RawCustomer[] = [];

  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push({ field: "body", index, message: "Each row must be an object" });
      return;
    }

    const customerId = stringLike(entry.Customer_ID, "Customer_ID", issues, index);
    if (!customerId) {
      issues.push({ field: "Customer_ID", index, message: "Customer_ID is required" });
      return;
    }

    customers.push({
      Customer_ID: customerId,
      Full_Name: stringLike(entry.Full_Name, "Full_Name", issues, index),
      Email_ID: stringLike(entry.Email_ID, "Email_ID", issues, index),
      Mobile_Number1: stringLike(entry.Mobile_Number1, "Mobile_Number1", issues, index),
      sender_country: stringLike(entry.sender_country, "sender_country", issues, index),
      Record_Insert_DateTime2: stringLike(entry.Record_Insert_DateTime2, "Record_Insert_DateTime2", issues, index),
      Record_Insert_DateTime: stringLike(entry.Record_Insert_DateTime, "Record_Insert_DateTime", issues, index),
      Risk_status: stringLike(entry.Risk_status, "Risk_status", issues, index),
    });
  });

  if (issues.length > 0) {
    throw new RequestValidationError("Invalid request payload", issues);
  }

  return customers;
}

function buildRow(customer: RawCustomer): (string | number | null)[] {
  const phone = str(customer.Mobile_Number1);
  return [
    customer.Customer_ID,
    str(customer.Full_Name),
    str(customer.Email_ID),
    phone,
    normalizePhoneValue(phone),
    getPhoneLast9(phone),
    str(customer.sender_country),
    parseDateDDMMYYYY(customer.Record_Insert_DateTime2),
    parseDateDDMMYYYY(customer.Record_Insert_DateTime),
    str(customer.Risk_status),
  ];
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signatureCheck = validateBackofficeSignature(
      rawBody,
      req.headers.get("x-backoffice-signature")
    );

    if (!signatureCheck.valid) {
      const message = `Backoffice sync webhook rejected (${signatureCheck.reason})`;
      if (signatureCheck.enforce) {
        return jsonError(message, 401);
      }
      console.warn(`[POST /api/webhooks/backoffice/sync] ${message}`);
    }

    const customers = validateCustomersPayload(parseJsonText(rawBody));
    const received = customers.length;

    if (received === 0) {
      return NextResponse.json({ received: 0, inserted: 0, updated: 0, attributed: 0 });
    }

    let inserted = 0;
    let updated = 0;
    let attributed = 0;
    const conn: mysql.PoolConnection = await pool.getConnection();

    try {
      await conn.beginTransaction();

      for (const customer of customers) {
        const newKycDate = parseDateDDMMYYYY(customer.Record_Insert_DateTime);
        let kycJustCompleted = false;

        if (newKycDate) {
          const [existing] = await conn.execute<RowDataPacket[]>(
            "SELECT kyc_completion_date FROM customers WHERE customer_id = ?",
            [customer.Customer_ID]
          );
          const existingKyc = existing[0]?.kyc_completion_date ?? null;
          kycJustCompleted = existingKyc == null;
        }

        const [result] = await conn.execute(UPSERT_SQL, buildRow(customer));
        const header = result as mysql.ResultSetHeader;
        if (header.affectedRows === 1) inserted++;
        else if (header.affectedRows === 2) updated++;

        if (kycJustCompleted) {
          const [agentRows] = await conn.execute<RowDataPacket[]>(
            `SELECT agent_id FROM interactions
             WHERE  customer_id = ?
               AND  created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
             ORDER BY created_at DESC
             LIMIT 1`,
            [customer.Customer_ID]
          );
          const agentId = agentRows[0]?.agent_id ?? null;
          if (agentId) {
            await conn.execute(
              "UPDATE customers SET kyc_attributed_agent_id = ? WHERE customer_id = ?",
              [agentId, customer.Customer_ID]
            );
            attributed++;
          }
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return NextResponse.json({ received, inserted, updated, attributed });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/webhooks/backoffice/sync]", message);
    return jsonError(message, 500);
  }
}

