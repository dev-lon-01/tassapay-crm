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
  requireString,
} from "@/src/lib/requestValidation";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

const ALLOWED_CATEGORIES = ["call_outcome", "focus_outcome", "note_outcome"];

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const includeInactive = searchParams.get("includeInactive") === "1";

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (!includeInactive) {
    clauses.push("is_active = 1");
  }
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, category, label, sort_order, is_active
       FROM   system_dropdowns
       ${where}
       ORDER  BY category, sort_order ASC`,
      params
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/settings/dropdowns]", message);
    return jsonError(message, 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const adminError = requireAdmin(auth);
  if (adminError) return adminError;

  try {
    const body = ensureObject(parseJsonText(await req.text()));
    const category = requireString(body.category, "category", { maxLength: 50 });
    const label = requireString(body.label, "label", { maxLength: 100 });
    const sortOrder = optionalInteger(body.sort_order, "sort_order") ?? 0;

    if (!ALLOWED_CATEGORIES.includes(category)) {
      return jsonError("Invalid category", 400);
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO system_dropdowns (category, label, sort_order) VALUES (?, ?, ?)`,
      [category, label, sortOrder]
    );
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const code = (err as { code?: string }).code;
    if (code === "ER_DUP_ENTRY") {
      return jsonError("This label already exists in this category", 409);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/settings/dropdowns]", message);
    return jsonError(message, 500);
  }
}

