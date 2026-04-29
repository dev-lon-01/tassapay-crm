import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { jsonError } from "@/src/lib/httpResponses";
import type { ResultSetHeader } from "mysql2";

// ── Auth ──────────────────────────────────────────────────────────────────────

function validateApiKey(header: string | null): boolean {
  const expected = process.env.TAYO_REMARKS_API_KEY ?? "";
  if (!expected) return true; // not configured — allow (dev mode)
  return header?.trim() === expected;
}

// ── Date parsing ──────────────────────────────────────────────────────────────
// Input: "29-Apr-2026 00:56 AM" or "29-Apr-2026 09:09 AM"
// Output: "2026-04-29 00:56:00" (MySQL DATETIME string)

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseTayoDate(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  // "29-Apr-2026 00:56 AM"  →  ["29-Apr-2026", "00:56", "AM"]
  const parts = s.split(/\s+/);
  if (parts.length < 1) return null;

  const dateParts = parts[0].split("-");
  if (dateParts.length !== 3) return null;
  const [dd, monStr, yyyy] = dateParts;
  const mm = MONTHS[monStr.toLowerCase()];
  if (!mm) return null;

  let hh = "00", min = "00";
  if (parts.length >= 2) {
    const timeParts = parts[1].split(":");
    hh  = (timeParts[0] ?? "00").padStart(2, "0");
    min = (timeParts[1] ?? "00").padStart(2, "0");
    const meridiem = (parts[2] ?? "").toUpperCase();
    if (meridiem === "PM" && hh !== "12") hh = String(Number(hh) + 12).padStart(2, "0");
    if (meridiem === "AM" && hh === "12") hh = "00";
  }

  return `${yyyy}-${mm}-${dd.padStart(2, "0")} ${hh}:${min}:00`;
}

// ── Validation ────────────────────────────────────────────────────────────────

interface RemarkRow {
  Date: unknown;
  Action_Remarks: unknown;
  Remarks: unknown;
  User: unknown;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function validateBody(body: unknown): { transaction_id: string; remarks: RemarkRow[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const transactionId = str(b.transaction_id);
  if (!transactionId) throw new Error("transaction_id is required");

  if (!Array.isArray(b.remarks)) throw new Error("remarks must be an array");
  if (b.remarks.length === 0)   throw new Error("remarks array is empty");

  for (const [i, row] of b.remarks.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`remarks[${i}] must be an object`);
    }
  }

  return { transaction_id: transactionId, remarks: b.remarks as RemarkRow[] };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    if (!validateApiKey(req.headers.get("x-api-key"))) {
      return jsonError("Unauthorized", 401);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const { transaction_id, remarks } = validateBody(parsedBody);

    let inserted = 0;
    let updated  = 0;

    for (const row of remarks) {
      const rawDate      = str(row.Date);
      const remarkDate   = parseTayoDate(rawDate);
      const actionRemark = str(row.Action_Remarks);
      const remark       = str(row.Remarks);
      const tayoUser     = str(row.User);

      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO transfer_remarks
           (transfer_ref, remark_date, raw_date, action_remarks, remarks, tayo_user)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           remark_date    = VALUES(remark_date),
           remarks        = VALUES(remarks),
           tayo_user      = VALUES(tayo_user)`,
        [transaction_id, remarkDate, rawDate, actionRemark, remark, tayoUser],
      );

      // affectedRows = 1 → inserted, 2 → updated (ON DUPLICATE KEY), 0 → no change
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
    }

    console.log(
      `[POST /api/webhooks/tayo/remarks] txn=${transaction_id} received=${remarks.length} inserted=${inserted} updated=${updated}`,
    );

    return NextResponse.json({
      transaction_id,
      received: remarks.length,
      inserted,
      updated,
    });
  } catch (err) {
    if (err instanceof Error && err.message.match(/required|must be|empty/)) {
      return jsonError(err.message, 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/webhooks/tayo/remarks]", message);
    return jsonError(message, 500);
  }
}
