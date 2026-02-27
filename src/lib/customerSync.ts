/**
 * Customer upsert logic — lean CRM schema.
 *
 * Extracts only the 8 CRM fields from the raw backoffice payload and
 * performs INSERT … ON DUPLICATE KEY UPDATE keyed on customer_id.
 *
 * Date format from backoffice: "DD/MM/YYYY HH:mm:ss" or ""
 * MySQL requires:               "YYYY-MM-DD HH:mm:ss" or NULL
 */
import { pool } from "./db";
import type mysql from "mysql2/promise";

// ─── raw backoffice payload shape ─────────────────────────────────────────────

export interface RawCustomer {
  Customer_ID: string;
  Full_Name?: string;
  Email_ID?: string;
  Mobile_Number1?: string;
  sender_country?: string;
  Record_Insert_DateTime2?: string; // registration date  "DD/MM/YYYY HH:mm:ss"
  Record_Insert_DateTime?: string;  // kyc completion date "DD/MM/YYYY HH:mm:ss" | ""
  Risk_status?: string;
  [key: string]: string | undefined;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function str(v: string | undefined): string | null {
  if (!v || !v.trim()) return null;
  return v.trim();
}

/**
 * Convert "DD/MM/YYYY HH:mm:ss" → "YYYY-MM-DD HH:mm:ss"
 * Returns null for empty / invalid strings.
 */
export function parseDateDDMMYYYY(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  // Handle both "DD/MM/YYYY HH:mm:ss" and "DD/MM/YYYY" forms
  const [datePart, timePart] = raw.trim().split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  const time = timePart ?? "00:00:00";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${time}`;
}

// ─── upsert ───────────────────────────────────────────────────────────────────

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

function mapRow(c: RawCustomer): (string | number | null)[] {
  return [
    c.Customer_ID,
    str(c.Full_Name),
    str(c.Email_ID),
    str(c.Mobile_Number1),
    str(c.sender_country),
    parseDateDDMMYYYY(c.Record_Insert_DateTime2),  // registration_date
    parseDateDDMMYYYY(c.Record_Insert_DateTime),   // kyc_completion_date (null = KYC not done)
    str(c.Risk_status),
  ];
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  total: number;
}

/**
 * Upsert a batch of raw backoffice customers into the CRM customers table.
 * Wraps in a transaction; optionally accepts an existing connection.
 */
export async function upsertCustomers(
  rawCustomers: RawCustomer[],
  conn?: mysql.PoolConnection
): Promise<UpsertResult> {
  const ownConn = !conn;
  const c = conn ?? (await pool.getConnection());
  let inserted = 0;
  let updated = 0;

  try {
    if (ownConn) await c.beginTransaction();

    for (const raw of rawCustomers) {
      if (!raw.Customer_ID) continue;
      const [result] = await c.execute(UPSERT_SQL, mapRow(raw));
      const r = result as mysql.ResultSetHeader;
      // affectedRows=1 → INSERT, affectedRows=2 → UPDATE
      if (r.affectedRows === 1) inserted++;
      else if (r.affectedRows === 2) updated++;
    }

    if (ownConn) await c.commit();
  } catch (err) {
    if (ownConn) await c.rollback();
    throw err;
  } finally {
    if (ownConn) c.release();
  }

  return { inserted, updated, total: inserted + updated };
}