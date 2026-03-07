/**
 * Customer upsert logic - lean CRM schema.
 *
 * Extracts only the core CRM fields from the raw backoffice payload and
 * performs INSERT ... ON DUPLICATE KEY UPDATE keyed on customer_id.
 *
 * Date format from backoffice: "DD/MM/YYYY HH:mm:ss" or ""
 * MySQL requires:               "YYYY-MM-DD HH:mm:ss" or NULL
 */
import { pool } from "./db";
import type mysql from "mysql2/promise";
import { getPhoneLast9, normalizePhoneValue } from "./phoneUtils";

export interface RawCustomer {
  Customer_ID: string;
  Full_Name?: string;
  Email_ID?: string;
  Mobile_Number1?: string;
  sender_country?: string;
  Record_Insert_DateTime2?: string;
  Record_Insert_DateTime?: string;
  Risk_status?: string;
  [key: string]: string | undefined;
}

function str(v: string | undefined): string | null {
  if (!v || !v.trim()) return null;
  return v.trim();
}

export function parseDateDDMMYYYY(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const [datePart, timePart] = raw.trim().split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  const time = timePart ?? "00:00:00";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${time}`;
}

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

function mapRow(c: RawCustomer): (string | number | null)[] {
  const phone = str(c.Mobile_Number1);
  return [
    c.Customer_ID,
    str(c.Full_Name),
    str(c.Email_ID),
    phone,
    normalizePhoneValue(phone),
    getPhoneLast9(phone),
    str(c.sender_country),
    parseDateDDMMYYYY(c.Record_Insert_DateTime2),
    parseDateDDMMYYYY(c.Record_Insert_DateTime),
    str(c.Risk_status),
  ];
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  total: number;
}

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

