import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { requireAdmin } from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";
import {
  ensureObject,
  optionalInteger,
  parseJsonText,
  RequestValidationError,
  optionalString,
} from "@/src/lib/requestValidation";
import type { ResultSetHeader } from "mysql2";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const adminError = requireAdmin(auth);
  if (adminError) return adminError;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return jsonError("Invalid id", 400);
  }

  try {
    const body = ensureObject(parseJsonText(await req.text()));
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (body.label !== undefined) {
      const label = optionalString(body.label, "label", { maxLength: 100 });
      if (!label) {
        return jsonError("Label must be 1-100 characters", 400);
      }
      updates.push("label = ?");
      values.push(label);
    }

    if (body.sort_order !== undefined) {
      updates.push("sort_order = ?");
      values.push(optionalInteger(body.sort_order, "sort_order") ?? 0);
    }

    if (body.is_active !== undefined) {
      const isActive = body.is_active ? 1 : 0;
      updates.push("is_active = ?");
      values.push(isActive);
    }

    if (updates.length === 0) {
      return jsonError("Nothing to update", 400);
    }

    values.push(id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE system_dropdowns SET ${updates.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return jsonError("Not found", 404);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PUT /api/settings/dropdowns/:id]", message);
    return jsonError(message, 500);
  }
}

