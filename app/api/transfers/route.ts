import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/transfers
 *
 * Global transfers list with filtering and pagination.
 * Region-fenced: non-Admin agents only see transfers belonging to
 * customers in their allowed regions (customer origin country).
 *
 * Query params:
 *   ?search=              – LIKE on transaction_ref, data_field_id, full_name, email, phone_number
 *   ?status=              – "not-paid" (default) | "in-progress" | "paid" | "action-required" | "all"
 *   ?country=             – exact match on transfers.destination_country
 *   ?page=                – page number (default: 1)
 *   ?limit=               – records per page (default: 50, max: 200)
 *   ?distinct_countries=1 – returns distinct destination_country array (for dropdown)
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);

    // Region fence applied to customer origin country (c.country)
    const fence = buildCountryFence(
      auth.allowed_regions ?? ["UK", "EU"],
      auth.role === "Admin",
    );

    // ── Distinct destination countries mode (for dropdown) ─────────────────
    if (searchParams.get("distinct_countries") === "1") {
      const fenceClause = fence ? `WHERE c.${fence.sql}` : "";
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT DISTINCT t.destination_country
         FROM   transfers t
         JOIN   customers c ON c.customer_id = t.customer_id
         ${fenceClause}
         ORDER BY t.destination_country ASC`,
        fence?.params ?? [],
      );
      return NextResponse.json(
        rows.map((r) => r.destination_country as string).filter(Boolean),
      );
    }

    // ── Paginated list ──────────────────────────────────────────────────────
    const search  = searchParams.get("search");
    const status  = searchParams.get("status") ?? "not-paid";
    const country = searchParams.get("country");
    const page    = Math.max(1, Number(searchParams.get("page")  ?? 1));
    const limit   = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const offset  = (page - 1) * limit;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // Region fence
    if (fence) {
      conditions.push(`c.${fence.sql}`);
      params.push(...fence.params);
    }

    // Status filter
    if (status === "not-paid") {
      conditions.push("t.status != 'Deposited'");
    } else if (status === "in-progress") {
      conditions.push("t.status = 'Processed'");
    } else if (status === "paid") {
      conditions.push("t.status = 'Deposited'");
    } else if (status === "action-required") {
      conditions.push("t.status = 'Pending'");
    }
    // status === "all" → no condition

    // Destination country filter
    if (country) {
      conditions.push("t.destination_country = ?");
      params.push(country);
    }

    // Omni-search
    if (search) {
      conditions.push(
        "(t.transaction_ref LIKE ? OR t.data_field_id LIKE ? OR c.full_name LIKE ? OR c.email LIKE ? OR c.phone_number LIKE ?)",
      );
      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      );
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const [[{ total }]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM   transfers t
       JOIN   customers c ON c.customer_id = t.customer_id
       ${where}`,
      params,
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.id, t.transaction_ref, t.data_field_id, t.created_at,
              t.send_amount, t.send_currency,
              t.receive_amount, t.receive_currency,
              t.destination_country, t.beneficiary_name,
              t.status, t.hold_reason,
              c.customer_id, c.full_name, c.country AS customer_country
       FROM   transfers t
       JOIN   customers c ON c.customer_id = t.customer_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return NextResponse.json({
      data:  rows,
      total: Number(total),
      page,
      limit,
      pages: Math.ceil(Number(total) / limit),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/transfers]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
