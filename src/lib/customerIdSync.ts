/**
 * Pulls a single customer's ID documents from TassaPay's
 *   POST /backoffice/CustomerHandler.ashx?Task=IDdocuments_bind_grid
 * endpoint and upserts rows into customer_id_documents (keyed on sender_id_id).
 *
 * is_legacy is computed from the JourneyID shape — only a Sumsub-style
 * UUID counts as managed; anything else (empty, "System.Object", etc.)
 * is legacy.
 */
import { parseTransferDate } from "@/src/lib/transferSync";
import type { Pool } from "mysql2/promise";

const SUMSUB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLegacyId(journeyId: string | null | undefined): 0 | 1 {
  if (!journeyId) return 1;
  return SUMSUB_UUID.test(journeyId.trim()) ? 0 : 1;
}

export interface RawIdDocument {
  SenderID_ID?: string;
  Customer_ID?: string;
  ID_Type?: string;
  ID_Name?: string;
  SenderID_Number?: string;
  SenderNameOnID?: string;
  SenderID_PlaceOfIssue?: string;
  Issue_Date?: string;
  SenderID_ExpiryDate?: string;
  Sender_DateOfBirth?: string;
  FileNameWithExt?: string;
  BackID_Document?: string;
  PDF_FileName?: string;
  MRZ_number?: string;
  JourneyID?: string;
  Verfied?: string;
  Verified_By?: string;
  Verified_Date?: string;
  comments?: string;
  Record_Insert_DateTime?: string;
  [key: string]: unknown;
}

export interface TassapayAuth {
  ld: {
    Client_ID?: string;
    User_ID?: string;
    Name?: string;
    Agent_branch?: string;
  };
  cookieHeader: string;
}

export interface SyncCustomerIdsResult {
  fetched: number;
  upserted: number;
  errors: number;
}

const TASSAPAY_BASE = "https://tassapay.co.uk/backoffice";

const HEADERS = {
  accept:              "*/*",
  "cache-control":     "no-cache",
  origin:              "https://tassapay.co.uk",
  "user-agent":        "Mozilla/5.0",
  "x-requested-with": "XMLHttpRequest",
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  return s;
}

function num01(v: unknown): 0 | 1 {
  if (v === "1" || v === 1 || v === true) return 1;
  return 0;
}

function parseDateOnly(raw: string | null | undefined): string | null {
  const parsed = parseTransferDate(raw);
  if (!parsed) return null;
  return parsed.slice(0, 10);
}

const UPSERT_SQL = `
INSERT INTO customer_id_documents
  (sender_id_id, customer_id, id_type, id_name, id_number,
   sender_name_on_id, place_of_issue, issue_date, expiry_date, dob,
   front_image_path, back_image_path, pdf_path,
   mrz_number, journey_id, is_legacy, verified, verified_by, verified_date,
   comments, source_inserted_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  customer_id        = VALUES(customer_id),
  id_type            = VALUES(id_type),
  id_name            = VALUES(id_name),
  id_number          = VALUES(id_number),
  sender_name_on_id  = VALUES(sender_name_on_id),
  place_of_issue     = VALUES(place_of_issue),
  issue_date         = VALUES(issue_date),
  expiry_date        = VALUES(expiry_date),
  dob                = VALUES(dob),
  front_image_path   = VALUES(front_image_path),
  back_image_path    = VALUES(back_image_path),
  pdf_path           = VALUES(pdf_path),
  mrz_number         = VALUES(mrz_number),
  journey_id         = VALUES(journey_id),
  is_legacy          = VALUES(is_legacy),
  verified           = VALUES(verified),
  verified_by        = VALUES(verified_by),
  verified_date      = VALUES(verified_date),
  comments           = VALUES(comments),
  source_inserted_at = VALUES(source_inserted_at),
  synced_at          = CURRENT_TIMESTAMP
`;

export async function syncCustomerIds(
  pool: Pool,
  auth: TassapayAuth,
  customerId: string,
): Promise<SyncCustomerIdsResult> {
  const { ld, cookieHeader } = auth;

  let body: unknown;
  try {
    const res = await fetch(`${TASSAPAY_BASE}/CustomerHandler.ashx/?Task=IDdocuments_bind_grid`, {
      method: "POST",
      headers: {
        ...HEADERS,
        "content-type":     "application/json;",
        referer:            "https://tassapay.co.uk/backoffice/IdDocs.aspx",
        cookie:             cookieHeader,
      },
      body: JSON.stringify({
        Param: [{
          Branch_ID: "1",
          User_ID:   ld.User_ID,
          Client_ID: ld.Client_ID,
          Username:  ld.Name,
          cid:       customerId,
        }],
      }),
    });
    body = await res.json();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[customerIdSync] fetch failed for ${customerId}: ${m}`);
    return { fetched: 0, upserted: 0, errors: 1 };
  }

  if (!Array.isArray(body)) {
    return { fetched: 0, upserted: 0, errors: 0 };
  }

  const rows = body as RawIdDocument[];
  let upserted = 0;
  let errors = 0;

  for (const row of rows) {
    const senderIdId = str(row.SenderID_ID);
    if (!senderIdId) continue;
    try {
      await pool.execute(UPSERT_SQL, [
        senderIdId,
        customerId,
        str(row.ID_Type),
        str(row.ID_Name),
        str(row.SenderID_Number),
        str(row.SenderNameOnID),
        str(row.SenderID_PlaceOfIssue),
        parseDateOnly(row.Issue_Date),
        parseTransferDate(row.SenderID_ExpiryDate),
        parseTransferDate(row.Sender_DateOfBirth),
        str(row.FileNameWithExt),
        str(row.BackID_Document),
        str(row.PDF_FileName),
        str(row.MRZ_number),
        str(row.JourneyID),
        isLegacyId(row.JourneyID),
        num01(row.Verfied),
        str(row.Verified_By),
        parseTransferDate(row.Verified_Date),
        str(row.comments),
        parseTransferDate(row.Record_Insert_DateTime),
      ]);
      upserted++;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`[customerIdSync] upsert failed for ${senderIdId}: ${m}`);
      errors++;
    }
  }

  return { fetched: rows.length, upserted, errors };
}
