import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/customers
 *
 * Returns paginated customers from the local MySQL database.
 * Optional query params:
 *   ?country=        – exact match on country
 *   ?kycStatus=      – "Pending" (IS NULL) | "Complete" (IS NOT NULL)
 *   ?transferStatus= – "Zero" (= 0) | "HasTransfers" (> 0)
 *   ?search=         – LIKE on full_name or customer_id
 *   ?page=           – page number (default: 1)
 *   ?limit=          – records per page (default: 50, max: 200)
 *
 * Response: { data, total, page, limit, pages }
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(req.url);
    const country        = searchParams.get("country");
    const kycStatus      = searchParams.get("kycStatus");
    const transferStatus = searchParams.get("transferStatus");
    const search         = searchParams.get("search");
    const phone          = searchParams.get("phone");
    const page           = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit          = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const offset         = (page - 1) * limit;

    // ── Phone lookup for screen pop (returns a single customer or 404) ──────
    if (phone) {
      // Strip spaces, dashes, and + from input; also try last-9-digit fallback
      // to handle E.164 (+447…) vs local (07…) format mismatches
      const normalized  = phone.replace(/[\s\-+]/g, "");
      const last9       = normalized.slice(-9);
      const phoneFence  = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
      const phoneFenceClause = phoneFence ? `AND ${phoneFence.sql}` : "";
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT customer_id, full_name, email, phone_number, country,
                registration_date, kyc_completion_date, risk_status,
                (SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) AS total_transfers
         FROM   customers
         WHERE  (
                  REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
               OR RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
               )
           ${phoneFenceClause}
         LIMIT 1`,
        [normalized, last9, ...(phoneFence?.params ?? [])]
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(rows[0]);
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (country) {
      conditions.push("country = ?");
      params.push(country);
    }
    if (kycStatus === "Pending") {
      conditions.push("kyc_completion_date IS NULL");
    } else if (kycStatus === "Complete") {
      conditions.push("kyc_completion_date IS NOT NULL");
    }
    if (transferStatus === "Zero") {
      conditions.push("(SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) = 0");
    } else if (transferStatus === "HasTransfers") {
      conditions.push("(SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) > 0");
    }
    if (search) {
      conditions.push("(full_name LIKE ? OR customer_id LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    // ── Region fence (non-Admin only) ─────────────────────────────────────────
    const fence = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
    if (fence) {
      conditions.push(fence.sql);
      params.push(...fence.params);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // COUNT for pagination metadata
    const [[{ total }]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM customers ${where}`,
      params
    );

    // Paginated data
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id, full_name, email, phone_number, country,
              registration_date, kyc_completion_date, risk_status,
              (SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) AS total_transfers
       FROM customers
       ${where}
       ORDER BY registration_date DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return NextResponse.json({
      data: rows,
      total: Number(total),
      page,
      limit,
      pages: Math.ceil(Number(total) / limit),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/customers]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
