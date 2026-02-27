import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { getCredentials, login, searchCustomers } from "@/src/lib/tassapayApi";
import { upsertCustomers, type RawCustomer } from "@/src/lib/customerSync";
import type { ResultSetHeader } from "mysql2";

/**
 * POST /api/sync/customers
 *
 * Triggers a manual pull-and-upsert of CRM customer records from the
 * TassaPay backoffice.  Admin-only.
 *
 * Query params (all optional):
 *   ?fromDate=YYYY-MM-DD   (default: 30 days ago)
 *   ?toDate=YYYY-MM-DD     (default: today)
 *
 * Response: { fetched, inserted, updated, syncLogId }
 */

function isoToDDMMYYYY(iso: string): string {
  const [yyyy, mm, dd] = iso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fmt = (d: Date) =>
    [
      String(d.getDate()).padStart(2, "0"),
      String(d.getMonth() + 1).padStart(2, "0"),
      d.getFullYear(),
    ].join("/");
  return { from: fmt(from), to: fmt(to) };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const defaults = defaultRange();
  const fromDate = searchParams.get("fromDate")
    ? isoToDDMMYYYY(searchParams.get("fromDate")!)
    : defaults.from;
  const toDate = searchParams.get("toDate")
    ? isoToDDMMYYYY(searchParams.get("toDate")!)
    : defaults.to;

  let syncLogId: number | null = null;

  try {
    const [logRes] = await pool.execute<ResultSetHeader>(
      "INSERT INTO sync_log (started_at, type, status) VALUES (NOW(), 'customers', 'running')"
    );
    syncLogId = logRes.insertId;

    const { username, password, branchKey } = getCredentials();
    const { loginData, cookieHeader } = await login(username, password, branchKey);
    const raw = await searchCustomers(cookieHeader, loginData, {
      fromdate: fromDate,
      todate: toDate,
    });

    if (!Array.isArray(raw)) {
      throw new Error(`Unexpected API response: ${JSON.stringify(raw).slice(0, 200)}`);
    }

    const result = await upsertCustomers(raw as RawCustomer[]);

    await pool.execute(
      "UPDATE sync_log SET finished_at=NOW(), records_fetched=?, records_inserted=?, records_updated=?, status='success' WHERE id=?",
      [raw.length, result.inserted, result.updated, syncLogId]
    );

    return NextResponse.json({
      fetched: raw.length,
      inserted: result.inserted,
      updated: result.updated,
      syncLogId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/sync/customers]", message);
    if (syncLogId) {
      await pool.execute(
        "UPDATE sync_log SET finished_at=NOW(), status='error', error_message=? WHERE id=?",
        [message, syncLogId]
      ).catch(() => {});
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
