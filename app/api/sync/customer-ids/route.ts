import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { syncCustomerIds, type TassapayAuth } from "@/src/lib/customerIdSync";
import type { RowDataPacket } from "mysql2";

interface CustomerRow extends RowDataPacket {
  customer_id: string;
}

interface LoginData {
  Status: string;
  ErrorMessage?: string;
  E_User_Nm?: string;
  E_Password?: string;
  E_Branch_key?: string;
  Client_ID?: string;
  User_ID?: string;
  Name?: string;
  Agent_branch?: string;
}

const TASSAPAY_BASE = "https://tassapay.co.uk/backoffice";
const HEADERS = {
  accept:              "*/*",
  "cache-control":     "no-cache",
  origin:              "https://tassapay.co.uk",
  "user-agent":        "Mozilla/5.0",
  "x-requested-with": "XMLHttpRequest",
};
const RATE_LIMIT_MS = 750;

async function loginToBackoffice(): Promise<TassapayAuth> {
  const res = await fetch(`${TASSAPAY_BASE}/LoginHandler.ashx?Task=1`, {
    method: "POST",
    headers: { ...HEADERS, "content-type": "application/json; charset=UTF-8", referer: "https://tassapay.co.uk/backoffice/login" },
    body: JSON.stringify({ Param: [{
      username:    process.env.TASSAPAY_USERNAME,
      password:    process.env.TASSAPAY_PASSWORD,
      BranchKey:   process.env.TASSAPAY_BRANCH_KEY,
      reCaptcha:   "",
      remcondition: true,
    }] }),
  });
  const ld = (await res.json() as LoginData[])[0];
  if (ld.Status !== "0") throw new Error(`TassaPay login failed: ${ld.ErrorMessage}`);

  const setCookies: string[] = [];
  res.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") setCookies.push(value.split(";")[0].trim());
  });

  const cookieHeader = [
    `username=${encodeURIComponent(ld.E_User_Nm ?? "")}`,
    `password=${encodeURIComponent(ld.E_Password ?? "")}`,
    `mtsbranchkey=${encodeURIComponent(ld.E_Branch_key ?? "")}`,
    "remember=true",
    "Till_ID=0",
    ...setCookies,
  ].join("; ");

  return { ld: { Client_ID: ld.Client_ID, User_ID: ld.User_ID, Name: ld.Name, Agent_branch: ld.Agent_branch }, cookieHeader };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get("fromDate");
  const toDate = searchParams.get("toDate");
  if (!fromDate || !toDate) {
    return NextResponse.json({ error: "fromDate and toDate are required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const tassapay = await loginToBackoffice();

    const [customers] = await pool.execute<CustomerRow[]>(
      `SELECT customer_id FROM customers
       WHERE registration_date IS NOT NULL
         AND DATE(registration_date) BETWEEN ? AND ?
       ORDER BY registration_date DESC`,
      [fromDate, toDate],
    );

    let fetched = 0;
    let upserted = 0;
    let errors = 0;

    for (const c of customers) {
      const result = await syncCustomerIds(pool, tassapay, c.customer_id);
      fetched += result.fetched;
      upserted += result.upserted;
      errors += result.errors;
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    return NextResponse.json({
      customers: customers.length,
      fetched,
      upserted,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/sync/customer-ids]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
