import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { requireAdmin } from "@/src/lib/authorization";
import { jsonError } from "@/src/lib/httpResponses";

// ─── GET: list all automation rules ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const adminErr = requireAdmin(auth);
  if (adminErr) return adminErr;

  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT * FROM automation_rules ORDER BY id"
  );

  return NextResponse.json(rows);
}

// ─── PUT: update a single automation rule ─────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const adminErr = requireAdmin(auth);
  if (adminErr) return adminErr;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Missing or invalid rule id", 400);
  }

  // Build dynamic SET clause from allowed fields
  const ALLOWED: Record<string, string> = {
    is_active: "is_active",
    delay_hours: "delay_hours",
    email_subject: "email_subject",
    email_template_id: "email_template_id",
    rule_name: "rule_name",
  };

  const sets: string[] = [];
  const params: (string | number | boolean)[] = [];

  for (const [key, col] of Object.entries(ALLOWED)) {
    if (body[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(body[key] as string | number | boolean);
    }
  }

  if (sets.length === 0) {
    return jsonError("No updatable fields provided", 400);
  }

  params.push(id);

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE automation_rules SET ${sets.join(", ")} WHERE id = ?`,
    params
  );

  if (result.affectedRows === 0) {
    return jsonError("Rule not found", 404);
  }

  const [updated] = await pool.execute<RowDataPacket[]>(
    "SELECT * FROM automation_rules WHERE id = ?",
    [id]
  );

  return NextResponse.json(updated[0]);
}
