import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET /api/users
 * Admin only — list all staff members (no password hash)
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name, email, role, is_active, allowed_regions, can_view_dashboard, created_at FROM users ORDER BY created_at DESC"
    );
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/users]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/users
 * Admin only — create a new user
 * Body: { name, email, password, role }
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, email, password, role, allowed_regions, can_view_dashboard } = body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      allowed_regions?: string[];
      can_view_dashboard?: boolean;
    };

    if (!name?.trim() || !email?.trim() || !password?.trim() || !role?.trim()) {
      return NextResponse.json(
        { error: "name, email, password and role are all required" },
        { status: 400 }
      );
    }

    const ALLOWED_ROLES = ["Admin", "Agent"];
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `role must be one of: ${ALLOWED_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const hash = await bcrypt.hash(password, 10);

    const regions = Array.isArray(allowed_regions) && allowed_regions.length > 0
      ? allowed_regions
      : ["UK", "EU"];
    const dashAccess = can_view_dashboard === true ? 1 : 0;

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash, role, is_active, allowed_regions, can_view_dashboard) VALUES (?, ?, ?, ?, 1, ?, ?)",
      [name.trim(), email.trim().toLowerCase(), hash, role, JSON.stringify(regions), dashAccess]
    );

    return NextResponse.json(
      {
        id: result.insertId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        is_active: 1,
        allowed_regions: regions,
        can_view_dashboard: dashAccess,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "A user with that email already exists" },
        { status: 409 }
      );
    }
    console.error("[POST /api/users]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
