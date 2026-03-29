import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { requireAdmin } from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const adminError = requireAdmin(auth);
  if (adminError) return adminError;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const transferRef = searchParams.get("transfer_ref")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const offset = (page - 1) * limit;

    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (transferRef) {
      clauses.push("p.transfer_ref = ?");
      params.push(transferRef);
    }

    if (search) {
      clauses.push("(p.transfer_ref LIKE ? OR p.provider_payment_id LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const [[countRow]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM payments p
       ${where}`,
      params,
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT p.id,
              p.provider,
              p.provider_payment_id,
              p.transfer_ref,
              p.payment_type,
              p.payment_method,
              p.amount,
              p.currency,
              p.status,
              p.provider_status,
              p.payment_date,
              p.is_reconciled,
              p.reconciliation_note,
              t.id AS transfer_id
       FROM payments p
       LEFT JOIN transfers t ON t.transaction_ref = p.transfer_ref
       ${where}
       ORDER BY COALESCE(p.payment_date, p.created_at) DESC, p.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const total = Number(countRow?.total ?? 0);

    return NextResponse.json({
      data: rows,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/payments]", message);
    return jsonError(message, 500);
  }
}
