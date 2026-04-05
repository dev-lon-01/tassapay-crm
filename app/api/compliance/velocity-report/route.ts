import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { REGION_MAP } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const searchName = searchParams.get("search_name");
    const region = searchParams.get("region");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const offset = (page - 1) * limit;

    // Always restrict to successful/paid transfers only (AC 2)
    const conditions: string[] = ["t.status IN ('Deposited', 'Paid', 'Completed')"];
    const params: (string | number)[] = [];

    if (searchName?.trim()) {
      conditions.push("c.full_name LIKE ?");
      params.push(`%${searchName.trim()}%`);
    }

    // AC 3: Region filter maps to country names via REGION_MAP
    if (region && REGION_MAP[region]) {
      const countries = REGION_MAP[region];
      const placeholders = countries.map(() => "?").join(",");
      conditions.push(`c.country IN (${placeholders})`);
      params.push(...countries);
    }

    if (dateFrom) {
      conditions.push("t.created_at >= ?");
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      conditions.push("t.created_at <= ?");
      params.push(`${dateTo} 23:59:59`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [[countRows], [rows]] = await Promise.all([
      pool.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT c.customer_id) AS total
         FROM   customers c
         JOIN   transfers t ON c.customer_id = t.customer_id
         ${where}`,
        params,
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT
            c.customer_id,
            c.full_name,
            c.country,
            SUM(CASE WHEN t.created_at >= DATE_SUB(NOW(), INTERVAL 1  DAY)   THEN t.send_amount ELSE 0 END) AS sent_24h,
            SUM(CASE WHEN t.created_at >= DATE_SUB(NOW(), INTERVAL 7  DAY)   THEN t.send_amount ELSE 0 END) AS sent_7d,
            SUM(CASE WHEN t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)   THEN t.send_amount ELSE 0 END) AS sent_30d,
            SUM(CASE WHEN t.created_at >= DATE_SUB(NOW(), INTERVAL 3  MONTH) THEN t.send_amount ELSE 0 END) AS sent_3m,
            SUM(CASE WHEN t.created_at >= DATE_SUB(NOW(), INTERVAL 6  MONTH) THEN t.send_amount ELSE 0 END) AS sent_6m,
            SUM(CASE WHEN t.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) THEN t.send_amount ELSE 0 END) AS sent_12m,
            SUM(t.send_amount)     AS sent_all_time,
            MAX(t.send_currency)   AS display_currency
         FROM   customers c
         JOIN   transfers t ON c.customer_id = t.customer_id
         ${where}
         GROUP  BY c.customer_id, c.full_name, c.country
         ORDER  BY sent_12m DESC
         LIMIT  ${limit} OFFSET ${offset}`,
        params,
      ),
    ]);

    const total = Number((countRows[0] as RowDataPacket).total);

    return NextResponse.json({
      data: rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/compliance/velocity-report]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
