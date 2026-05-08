import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { pool } from "@/src/lib/db";

interface AttachBody {
  targetType?: string;
  targetId?: string | number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const lookupId = Number(params.id);
  if (!Number.isFinite(lookupId) || lookupId <= 0) {
    return jsonError(`Invalid lookup id: ${params.id}`, 400);
  }

  let body: AttachBody;
  try {
    body = (await req.json()) as AttachBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const targetType = body.targetType;
  const targetId = body.targetId == null ? "" : String(body.targetId).trim();

  if (targetType !== "transfer" && targetType !== "customer") {
    return jsonError(`Invalid targetType: ${targetType ?? "(missing)"}`, 400);
  }
  if (!targetId) {
    return jsonError("targetId is required", 400);
  }

  const [lookupRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, status FROM account_lookups WHERE id = ? LIMIT 1`,
    [lookupId]
  );
  if (lookupRows.length === 0) {
    return jsonError("Lookup not found", 404);
  }
  if (lookupRows[0].status !== "success") {
    return jsonError("Cannot attach a non-successful lookup", 409);
  }

  // Transfers keyed by numeric `id`. Customers keyed by string `customer_id`.
  let targetExists: boolean;
  if (targetType === "transfer") {
    const numericId = Number(targetId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return jsonError(`Invalid transfer targetId: ${targetId}`, 400);
    }
    const [r] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM transfers WHERE id = ? LIMIT 1`,
      [numericId]
    );
    targetExists = r.length > 0;
  } else {
    const [r] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id FROM customers WHERE customer_id = ? LIMIT 1`,
      [targetId]
    );
    targetExists = r.length > 0;
  }
  if (!targetExists) {
    return jsonError(`${targetType} ${targetId} not found`, 404);
  }

  const [insertResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO account_verifications
       (lookup_id, target_type, target_id, attached_by)
     VALUES (?, ?, ?, ?)`,
    [lookupId, targetType, targetId, auth.id]
  );

  return NextResponse.json(
    {
      id: insertResult.insertId,
      lookupId,
      targetType,
      targetId,
      attachedBy: auth.id,
      attachedAt: new Date().toISOString(),
    },
    { status: 201 }
  );
}
