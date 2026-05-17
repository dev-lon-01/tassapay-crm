/**
 * src/lib/transferSync.ts
 *
 * Utilities for mapping raw TassaPay Transaction_Search records
 * to the `transfers` MySQL table and upserting them.
 *
 * Field mapping (API → DB):
 *   Customer_ID          → customer_id        (numeric backoffice ID)
 *   ReferenceNo          → transaction_ref
 *   Date1                → created_at         (DD/MM/YYYY  HH:mm:ss)
 *   Totalamount          → send_amount
 *   FromCurrency_Code    → send_currency
 *   Amount_in_other_cur  → receive_amount
 *   Currency_Code        → receive_currency
 *   Country_Name         → destination_country
 *   Reciever             → beneficiary_name
 *   Tx_Status            → status
 *   LatestCust_Comment   → hold_reason        (HTML stripped)
 *   Ptype                → payment_method
 *   Type_Name            → delivery_method
 *   paymentReceived_Name → payment_status
 */

// No mysql2 imports needed at module level - db passed as parameter

// ─── types ────────────────────────────────────────────────────────────────────

export interface RawTransfer {
  Customer_ID: string;
  ReferenceNo: string;
  Date1: string;
  Totalamount: string | number;
  FromCurrency_Code: string;
  Amount_in_other_cur: string | number;
  Currency_Code: string;
  Country_Name: string;
  Reciever: string;
  Tx_Status: string;
  LatestCust_Comment: string;
  Ptype: string;
  Type_Name: string;
  paymentReceived_Name: string;
  Datepaid?: string;
  Sender?: string;
  Email_ID?: string;
  Purpose?: string;
  Transfer_Fees?: string | number;
  AmountInGBP?: string | number;
  Exchange_Rate?: string | number;
  Branch?: string;
  Delivery_Type?: string;
  API_BranchDetails?: string;
  Beneficiary_ID?: string;
  Beneficiary_Mobile?: string;
  Benf_AccountHolderName?: string;
  AccountHolderName?: string;
  Benf_Account_Number?: string;
  Benf_Bank_Name?: string;
  Bank_Name?: string;
  Street?: string;
  [key: string]: unknown;
}

export interface MappedTransfer {
  customer_id: string;
  transaction_ref: string;
  created_at: string | null;
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
  payment_status: string | null;
  tayo_date_paid: string | null;
  sender_name: string | null;
  email_id: string | null;
  purpose: string | null;
  transfer_fees: number | null;
  amount_in_gbp: number | null;
  exchange_rate: number | null;
  branch: string | null;
  delivery_type: string | null;
  api_branch_details: string | null;
  beneficiary_id: string | null;
  beneficiary_mobile: string | null;
  benf_account_holder_name: string | null;
  benf_account_number: string | null;
  benf_bank_name: string | null;
  benf_street: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/**
 * Strip HTML tags from a string (handles <br/>, <b>, etc.)
 */
export function stripHtml(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
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

/**
 * Parse "DD/MM/YYYY  HH:mm:ss" (note: may have 1 or 2 spaces) → "YYYY-MM-DD HH:mm:ss"
 * Also handles "DD/MM/YYYY HH:mm:ss" (single space) and "DD/MM/YYYY" (no time).
 */
export function parseTransferDate(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().replace(/\s+/, " "); // normalise multiple spaces
  const [datePart, timePart] = s.split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  const time = timePart ?? "00:00:00";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${time}`;
}

// ─── mapping ─────────────────────────────────────────────────────────────────

export function mapTransferRow(t: RawTransfer): MappedTransfer {
  return {
    customer_id:         String(t.Customer_ID).trim(),
    transaction_ref:     String(t.ReferenceNo).trim(),
    created_at:          parseTransferDate(t.Date1),
    send_amount:         num(t.Totalamount),
    send_currency:       str(t.FromCurrency_Code),
    receive_amount:      num(t.Amount_in_other_cur),
    receive_currency:    str(t.Currency_Code),
    destination_country: str(t.Country_Name),
    beneficiary_name:    str(t.Reciever),
    status:              str(t.Tx_Status),
    hold_reason:         stripHtml(str(t.LatestCust_Comment)),
    payment_method:      str(t.Ptype),
    delivery_method:     str(t.Type_Name),
    payment_status:      str(t.paymentReceived_Name),
    tayo_date_paid:      parseTransferDate(t.Datepaid),
    sender_name:              str(t.Sender),
    email_id:                 str(t.Email_ID),
    purpose:                  str(t.Purpose),
    transfer_fees:            num(t.Transfer_Fees),
    amount_in_gbp:            num(t.AmountInGBP),
    exchange_rate:            num(t.Exchange_Rate),
    branch:                   str(t.Branch),
    delivery_type:            str(t.Delivery_Type),
    api_branch_details:       str(t.API_BranchDetails),
    beneficiary_id:           str(t.Beneficiary_ID),
    beneficiary_mobile:       str(t.Beneficiary_Mobile),
    benf_account_holder_name: str(t.Benf_AccountHolderName) ?? str(t.AccountHolderName),
    benf_account_number:      str(t.Benf_Account_Number),
    benf_bank_name:           str(t.Benf_Bank_Name) ?? str(t.Bank_Name),
    benf_street:              str(t.Street),
  };
}

// ─── upsert ───────────────────────────────────────────────────────────────────

const UPSERT_SQL = `
INSERT INTO transfers
  (customer_id, transaction_ref, created_at,
   send_amount, send_currency,
   receive_amount, receive_currency,
   destination_country, beneficiary_name,
   status, hold_reason,
   payment_method, delivery_method,
   payment_status, tayo_date_paid,
   sender_name, email_id, purpose,
   transfer_fees, amount_in_gbp, exchange_rate,
   branch, delivery_type, api_branch_details,
   beneficiary_id, beneficiary_mobile,
   benf_account_holder_name, benf_account_number, benf_bank_name, benf_street)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  payment_status      = VALUES(payment_status),
  tayo_date_paid      = VALUES(tayo_date_paid),
  sender_name              = VALUES(sender_name),
  email_id                 = VALUES(email_id),
  purpose                  = VALUES(purpose),
  transfer_fees            = VALUES(transfer_fees),
  amount_in_gbp            = VALUES(amount_in_gbp),
  exchange_rate            = VALUES(exchange_rate),
  branch                   = VALUES(branch),
  delivery_type            = VALUES(delivery_type),
  api_branch_details       = VALUES(api_branch_details),
  beneficiary_id           = VALUES(beneficiary_id),
  beneficiary_mobile       = VALUES(beneficiary_mobile),
  benf_account_holder_name = VALUES(benf_account_holder_name),
  benf_account_number      = VALUES(benf_account_number),
  benf_bank_name           = VALUES(benf_bank_name),
  benf_street              = VALUES(benf_street),
  synced_at           = CURRENT_TIMESTAMP
`;

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Upsert transfers into MySQL.
 * `db` can be a mysql2 Connection or Pool - both expose `execute()`.
 */
export async function upsertTransfers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rawTransfers: RawTransfer[]
): Promise<UpsertResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const BATCH = 100;

  await db.beginTransaction();
  try {
    for (let i = 0; i < rawTransfers.length; i += BATCH) {
      const batch = rawTransfers.slice(i, i + BATCH);
      for (const t of batch) {
        if (!t.ReferenceNo || !t.Customer_ID) { skipped++; continue; }
        const row = mapTransferRow(t);
        const params = [
          row.customer_id, row.transaction_ref, row.created_at,
          row.send_amount, row.send_currency,
          row.receive_amount, row.receive_currency,
          row.destination_country, row.beneficiary_name,
          row.status, row.hold_reason,
          row.payment_method, row.delivery_method,
          row.payment_status, row.tayo_date_paid,
          row.sender_name, row.email_id, row.purpose,
          row.transfer_fees, row.amount_in_gbp, row.exchange_rate,
          row.branch, row.delivery_type, row.api_branch_details,
          row.beneficiary_id, row.beneficiary_mobile,
          row.benf_account_holder_name, row.benf_account_number, row.benf_bank_name, row.benf_street,
        ];
        const [res] = await db.execute(UPSERT_SQL, params);
        if (res.affectedRows === 1) inserted++;
        else if (res.affectedRows === 2) updated++;
      }
    }
    await db.commit();
  } catch (err) {
    await db.rollback();
    throw err;
  }

  return { inserted, updated, skipped };
}
