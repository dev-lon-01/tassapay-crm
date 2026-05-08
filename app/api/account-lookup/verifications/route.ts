import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { pool } from "@/src/lib/db";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get("targetType");
  const targetId = (searchParams.get("targetId") ?? "").trim();

  if (targetType !== "transfer" && targetType !== "customer") {
    return jsonError(`Invalid targetType: ${targetType ?? "(missing)"}`, 400);
  }
  if (!targetId) {
    return jsonError("targetId is required", 400);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
        v.id            AS v_id,
        v.attached_at   AS attached_at,
        u.id            AS user_id,
        u.name          AS user_name,
        l.id            AS l_id,
        l.method_code   AS method_code,
        l.method_type   AS method_type,
        l.account_number AS account_number,
        l.account_name  AS account_name
     FROM account_verifications v
     JOIN account_lookups l ON l.id = v.lookup_id
     JOIN users           u ON u.id = v.attached_by
     WHERE v.target_type = ? AND v.target_id = ?
     ORDER BY v.attached_at DESC
     LIMIT 100`,
    [targetType, targetId]
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.v_id,
      lookup: {
        id: r.l_id,
        methodCode: r.method_code,
        methodType: r.method_type,
        accountNumber: r.account_number,
        accountName: r.account_name,
      },
      attachedBy: { id: r.user_id, name: r.user_name },
      attachedAt: r.attached_at,
    }))
  );
}
