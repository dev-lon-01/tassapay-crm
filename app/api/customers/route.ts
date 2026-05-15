import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { getPhoneLast9, normalizePhoneValue } from "@/src/lib/phoneUtils";
import { buildCountryFence } from "@/src/lib/regionFence";
import { buildReferenceSearchPatterns } from "@/src/lib/searchUtils";
import type { RowDataPacket } from "mysql2";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const country = searchParams.get("country");
    const kycStatus = searchParams.get("kycStatus");
    const transferStatus = searchParams.get("transferStatus");
    const search = searchParams.get("search");
    const referenceSearch = searchParams.get("reference_search");
    const phone = searchParams.get("phone");
    const includeLeads = searchParams.get("include_leads") === "1";
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const offset = (page - 1) * limit;

    const fence = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");

    if (phone) {
      const normalized = normalizePhoneValue(phone);
      const last9 = getPhoneLast9(phone);
      if (!normalized || !last9) {
        return jsonError("Not found", 404);
      }
      const phoneFenceClause = fence ? `AND ${fence.sql}` : "";
      const phoneLeadClause = includeLeads ? "" : "AND (is_lead = 0 OR is_lead IS NULL)";
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT customer_id, full_name, email, phone_number, country,
                registration_date, kyc_completion_date, risk_status, is_lead, lead_stage,
                (SELECT COUNT(*) FROM transfers t WHERE t.customer_id = customers.customer_id) AS total_transfers
         FROM   customers
         WHERE  (
                  phone_normalized = ?
               OR phone_last9 = ?
               OR REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+','') = ?
               OR RIGHT(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''), 9) = ?
               )
           ${phoneLeadClause}
           ${phoneFenceClause}
         LIMIT 1`,
        [normalized, last9, normalized, last9, ...(fence?.params ?? [])]
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return jsonError("Not found", 404);
      }
      return NextResponse.json(rows[0]);
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!includeLeads) {
      conditions.push("(is_lead = 0 OR is_lead IS NULL)");
    }

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
      conditions.push("(full_name LIKE ? OR customer_id LIKE ? OR email LIKE ? OR phone_number LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (referenceSearch) {
      const patterns = buildReferenceSearchPatterns(referenceSearch);
      conditions.push(
        `EXISTS (
           SELECT 1
           FROM transfers t
           WHERE t.customer_id = customers.customer_id
             AND (
               t.transaction_ref = ? OR t.data_field_id = ?
               OR t.transaction_ref LIKE ? OR t.data_field_id LIKE ?
             )
         )`
      );
      params.push(patterns.exact, patterns.exact, patterns.prefix, patterns.prefix);
    }

    if (fence) {
      conditions.push(fence.sql);
      params.push(...fence.params);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [[{ total }]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM customers ${where}`,
      params
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id, full_name, email, phone_number, country,
              registration_date, kyc_completion_date, risk_status, is_lead, lead_stage,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/customers]", message);
    return jsonError(message, 500);
  }
}

