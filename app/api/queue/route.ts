import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/queue
 *
 * Customer outreach queue — replaces the former /api/tasks queue endpoint.
 *
 * Query params (all optional):
 *   ?queueType=  default | dormant | new | incomplete | portfolio | hot-leads
 *   ?timeframe=  number of days for dormant/new modes
 *   ?search=     full-text filter on name, phone, id
 *   ?country=    exact country match
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const queueType = searchParams.get("queueType")?.trim() || "default";
    const timeframe  = parseInt(searchParams.get("timeframe") ?? "0", 10);
    const search     = searchParams.get("search")?.trim()  ?? "";
    const country    = searchParams.get("country")?.trim() ?? "";
    const PAGE_SIZE  = 50;
    const page       = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const offset     = (page - 1) * PAGE_SIZE;
    const rawSort    = searchParams.get("sort")?.toUpperCase();
    const sortDir    = rawSort === "ASC" ? "ASC" : "DESC"; // whitelist - default DESC

    const params: (string | number)[] = [];
    let orderBySql = `
        CASE
          WHEN c.kyc_completion_date IS NULL THEN 0
          WHEN c.total_transfers = 0         THEN 1
          ELSE                                    2
        END ASC,
        c.registration_date ${sortDir}
    `;

    // ── queue-type WHERE clause
    let baseWhere: string;

    switch (queueType) {
      case "dormant": {
        const days = timeframe > 0 ? timeframe : 40;
        // Use the actual transfers table - the denormalized total_transfers column
        // is never updated by the sync job so it is always 0 and cannot be trusted.
        baseWhere = `c.customer_id IN (
          SELECT customer_id
          FROM   transfers
          GROUP  BY customer_id
          HAVING MAX(created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
        )`;
        params.push(days);
        break;
      }
      case "new": {
        const days = timeframe > 0 ? timeframe : 7;
        baseWhere = `c.registration_date >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
        params.push(days);
        orderBySql = `c.registration_date ${sortDir}`;
        break;
      }
      case "incomplete":
        baseWhere = `c.kyc_completion_date IS NULL`;
        break;
      case "portfolio":
        baseWhere = `(c.assigned_agent_id = ? OR c.assigned_user_id = ?)`;
        params.push(auth.id, auth.id);
        orderBySql = `c.registration_date ${sortDir}`;
        break;
      case "hot-leads":
        baseWhere = `(
          c.kyc_completion_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM transfers t
            WHERE  t.customer_id = c.customer_id
            AND    t.status != 'Failed'
          )
          AND (c.assigned_agent_id = ? OR c.assigned_user_id = ?
               OR (c.assigned_agent_id IS NULL AND c.assigned_user_id IS NULL))
        )`;
        params.push(auth.id, auth.id);
        orderBySql = `c.registration_date ${sortDir}`;
        break;
      default:
        baseWhere = `(
          c.kyc_completion_date IS NULL
          OR (
            c.total_transfers = 0
            AND c.registration_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          )
        )`;
        break;
    }

    // ── optional filters
    let extraWhere = "";

    if (search) {
      const like = `%${search}%`;
      extraWhere += ` AND (c.full_name LIKE ? OR c.phone_number LIKE ? OR c.customer_id LIKE ?)`;
      params.push(like, like, like);
    }
    if (country) {
      extraWhere += ` AND c.country = ?`;
      params.push(country);
    }

    // ── Region fence (non-Admin only) ─────────────────────────────────────
    const fence = buildCountryFence(auth.allowed_regions ?? ["UK", "EU"], auth.role === "Admin");
    if (fence) {
      extraWhere += ` AND c.${fence.sql}`;
      params.push(...fence.params);
    }

    const countSql = `SELECT COUNT(*) AS total FROM customers c WHERE ${baseWhere}${extraWhere}`;

    // LIMIT/OFFSET are inlined (not user-supplied) to avoid mysql2 prepared-statement
    // integer-type issues with binary protocol placeholders.
    const dataSql = `
      SELECT
        c.customer_id,
        c.full_name,
        c.email,
        c.phone_number,
        c.country,
        c.registration_date,
        c.kyc_completion_date,
        c.risk_status,
        c.total_transfers,
        (
          SELECT MAX(t.created_at)
          FROM   transfers t
          WHERE  t.customer_id = c.customer_id
        ) AS last_transfer_date,
        (
          SELECT MAX(i.created_at)
          FROM   interactions i
          WHERE  i.customer_id = c.customer_id
        ) AS last_interaction_date
      FROM customers c
      WHERE ${baseWhere}${extraWhere}
      ORDER BY ${orderBySql}
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;

    const [[countRows], [dataRows]] = await Promise.all([
      pool.execute<RowDataPacket[]>(countSql, params),
      pool.execute<RowDataPacket[]>(dataSql, params),
    ]);

    const total = (countRows[0] as { total: number }).total;
    return NextResponse.json({ data: dataRows, total, page, pageSize: PAGE_SIZE });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/queue]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
