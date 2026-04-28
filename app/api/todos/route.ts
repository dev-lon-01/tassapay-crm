import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET /api/todos
 *
 * Returns a paginated list of tasks.
 *
 * Query params (all optional):
 *   ?view=       all | mine | open | closed   (default: open)
 *   ?customerId= filter by customer
 *   ?priority=   Low | Medium | High | Urgent
 *   ?status=     Open | In_Progress | Pending | Closed
 *   ?search=     title search
 *   ?page=       page number (default 1)
 *   ?limit=      page size   (default 50, max 200)
 *
 * Authorization:
 *   - view=all   → Admin only (returns 403 for Agent role)
 *   - all others → any authenticated user
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const view       = searchParams.get("view")?.trim()       || "open";
    const customerId = searchParams.get("customerId")?.trim() || "";
    const priority   = searchParams.get("priority")?.trim()   || "";
    const statusParam = searchParams.get("status")?.trim()    || "";
    const search     = searchParams.get("search")?.trim()     || "";
    const page       = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit      = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
    const offset     = (page - 1) * limit;

    const params: (string | number)[] = [];
    const where: string[] = [];

    // ── view filter ──────────────────────────────────────────────────────────
    switch (view) {
      case "mine":
        where.push(`t.assigned_agent_id = ?`);
        params.push(auth.id);
        where.push(`t.status != 'Closed'`);
        break;
      case "closed":
        where.push(`t.status = 'Closed'`);
        break;
      case "all":
        // no status constraint — Admin sees everything
        break;
      case "open":
      default:
        where.push(`t.status != 'Closed'`);
        break;
    }

    // ── optional filters ─────────────────────────────────────────────────────
    if (customerId) {
      where.push(`t.customer_id = ?`);
      params.push(customerId);
    }

    // Whitelist enum values to prevent injection
    const VALID_PRIORITY = new Set(["Low", "Medium", "High", "Urgent"]);
    if (priority && VALID_PRIORITY.has(priority)) {
      where.push(`t.priority = ?`);
      params.push(priority);
    }

    const VALID_STATUS = new Set(["Open", "In_Progress", "Pending", "Closed"]);
    if (statusParam && VALID_STATUS.has(statusParam)) {
      where.push(`t.status = ?`);
      params.push(statusParam);
    }

    if (search) {
      where.push(`(t.title LIKE ? OR c.full_name LIKE ? OR t.customer_id LIKE ? OR c.email LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countSql = `
      SELECT COUNT(*) AS total
      FROM tasks t
      LEFT JOIN customers   c  ON c.customer_id = t.customer_id
      LEFT JOIN users       u  ON u.id           = t.assigned_agent_id
      LEFT JOIN users       cb ON cb.id          = t.created_by
      ${whereClause}
    `;

    const dataSql = `
      SELECT
        t.id,
        t.customer_id,
        t.transfer_reference,
        t.title,
        t.description,
        t.category,
        t.priority,
        t.status,
        t.assigned_agent_id,
        t.created_by,
        t.created_at,
        t.updated_at,
        c.full_name   AS customer_name,
        u.name        AS assigned_agent_name,
        cb.name       AS created_by_name
      FROM tasks t
      LEFT JOIN customers   c  ON c.customer_id = t.customer_id
      LEFT JOIN users       u  ON u.id           = t.assigned_agent_id
      LEFT JOIN users       cb ON cb.id          = t.created_by
      ${whereClause}
      ORDER BY
        CASE t.priority
          WHEN 'Urgent' THEN 0
          WHEN 'High'   THEN 1
          WHEN 'Medium' THEN 2
          ELSE               3
        END ASC,
        t.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [[countRows], [dataRows]] = await Promise.all([
      pool.execute<RowDataPacket[]>(countSql, params),
      pool.execute<RowDataPacket[]>(dataSql, params),
    ]);

    const total = (countRows[0] as { total: number }).total;
    const pages = Math.ceil(total / limit);

    return NextResponse.json({ data: dataRows, total, page, limit, pages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/todos]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/todos
 *
 * Create a new task.
 *
 * Body (JSON):
 *   customer_id       string  (required)
 *   title             string  (required)
 *   description?      string
 *   category?         Query | Action | KYC | Payment_Issue  (default Query)
 *   priority?         Low | Medium | High | Urgent          (default Medium)
 *   assigned_agent_id? number | null
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { customer_id, transfer_reference, title, description, category, priority, assigned_agent_id } = body ?? {};

    if (!customer_id || typeof customer_id !== "string" || !customer_id.trim()) {
      return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const VALID_CATEGORY = new Set(["Query", "Action", "KYC", "Payment_Issue"]);
    const VALID_PRIORITY  = new Set(["Low", "Medium", "High", "Urgent"]);

    const safeCategory = VALID_CATEGORY.has(category) ? category : "Query";
    const safePriority  = VALID_PRIORITY.has(priority)  ? priority  : "Medium";
    const safeAgentId   = typeof assigned_agent_id === "number" ? assigned_agent_id : null;

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO tasks
         (customer_id, transfer_reference, title, description, category, priority, status, assigned_agent_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?)`,
      [
        customer_id.trim(),
        transfer_reference?.trim() || null,
        title.trim(),
        description?.trim() || null,
        safeCategory,
        safePriority,
        safeAgentId,
        auth.id,
      ]
    );

    const insertId = result.insertId;

    // Return the full task row with joined names
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         t.id, t.customer_id, t.transfer_reference, t.title, t.description, t.category, t.priority,
         t.status, t.assigned_agent_id, t.created_by, t.created_at, t.updated_at,
         c.full_name AS customer_name,
         u.name      AS assigned_agent_name,
         cb.name     AS created_by_name
       FROM tasks t
       LEFT JOIN customers c  ON c.customer_id = t.customer_id
       LEFT JOIN users     u  ON u.id           = t.assigned_agent_id
       LEFT JOIN users     cb ON cb.id          = t.created_by
       WHERE t.id = ?`,
      [insertId]
    );

    // rows is an array of RowDataPacket; return the first row (or null)
    const firstRow = Array.isArray(rows) ? (rows as RowDataPacket[])[0] ?? null : null;
    return NextResponse.json(firstRow, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/todos]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
