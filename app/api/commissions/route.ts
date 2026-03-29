import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET /api/commissions
 *
 * Lists commissions. Agents see their own; Admins see all.
 *
 * Query params:
 *   ?status=pending_approval|approved|rejected|paid  (optional filter)
 *   ?agentId=<int>    (Admin only — filter by agent)
 *   ?page=1           (pagination, default 1)
 *   ?limit=50         (page size, default 50, max 200)
 *
 * PATCH /api/commissions
 *
 * Maker-checker actions (Admin only):
 *   { action: "approve", commissionId: number }
 *   { action: "reject",  commissionId: number, reason: string }
 *   { action: "pay",     commissionId: number }
 */

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");
  const agentFilter = searchParams.get("agentId");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // Agents can only see their own commissions
  if (auth.role !== "Admin") {
    conditions.push("co.agent_id = ?");
    params.push(auth.id);
  } else if (agentFilter) {
    conditions.push("co.agent_id = ?");
    params.push(parseInt(agentFilter, 10));
  }

  if (statusFilter) {
    conditions.push("co.status = ?");
    params.push(statusFilter);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [[{ total }]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM commissions co ${whereClause}`,
      params,
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         co.id,
         co.agent_id,
         u.name AS agent_name,
         co.customer_id,
         c.full_name AS customer_name,
         co.transfer_id,
         t.transaction_ref,
         t.send_amount,
         t.send_currency,
         co.commission_amount,
         co.currency,
         co.status,
         co.approved_by,
         ab.name AS approved_by_name,
         co.approved_at,
         co.paid_by,
         pb.name AS paid_by_name,
         co.paid_at,
         co.rejection_reason,
         co.cancellation_reason,
         co.cancelled_at,
         co.created_at
       FROM commissions co
       JOIN users u ON u.id = co.agent_id
       LEFT JOIN customers c ON c.customer_id = co.customer_id
       LEFT JOIN transfers t ON t.id = co.transfer_id
       LEFT JOIN users ab ON ab.id = co.approved_by
       LEFT JOIN users pb ON pb.id = co.paid_by
       ${whereClause}
       ORDER BY co.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return NextResponse.json({ data: rows, total: Number(total), page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/commissions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action, commissionId, reason } = body as {
      action: string;
      commissionId: number;
      reason?: string;
    };

    if (!commissionId || !action) {
      return NextResponse.json({ error: "commissionId and action are required" }, { status: 400 });
    }

    // Fetch current commission
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, status FROM commissions WHERE id = ?`,
      [commissionId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Commission not found" }, { status: 404 });
    }
    const commission = rows[0];

    switch (action) {
      case "approve": {
        if (commission.status !== "pending_approval") {
          return NextResponse.json(
            { error: `Cannot approve commission in '${commission.status}' status` },
            { status: 400 },
          );
        }
        await pool.execute<ResultSetHeader>(
          `UPDATE commissions SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
          [auth.id, commissionId],
        );
        return NextResponse.json({ success: true, newStatus: "approved" });
      }

      case "reject": {
        if (commission.status !== "pending_approval") {
          return NextResponse.json(
            { error: `Cannot reject commission in '${commission.status}' status` },
            { status: 400 },
          );
        }
        if (!reason) {
          return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
        }
        await pool.execute<ResultSetHeader>(
          `UPDATE commissions SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ? WHERE id = ?`,
          [auth.id, reason, commissionId],
        );
        return NextResponse.json({ success: true, newStatus: "rejected" });
      }

      case "pay": {
        if (commission.status !== "approved") {
          return NextResponse.json(
            { error: `Cannot mark paid: commission is '${commission.status}', must be 'approved'` },
            { status: 400 },
          );
        }
        await pool.execute<ResultSetHeader>(
          `UPDATE commissions SET status = 'paid', paid_by = ?, paid_at = NOW() WHERE id = ?`,
          [auth.id, commissionId],
        );
        return NextResponse.json({ success: true, newStatus: "paid" });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/commissions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
