import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * PUT /api/users/[id]
 * Admin only - update name, email, role, is_active
 * Body: { name, email, role, is_active }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = parseInt(params.id, 10);
  if (isNaN(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { name, email, role, is_active, sip_username, allowed_regions, can_view_dashboard } = body as {
      name?: string;
      email?: string;
      role?: string;
      is_active?: boolean | number;
      sip_username?: string;
      allowed_regions?: string[];
      can_view_dashboard?: boolean;
    };

    if (!name?.trim() || !email?.trim() || !role?.trim()) {
      return NextResponse.json(
        { error: "name, email and role are required" },
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

    const activeVal = is_active === false || is_active === 0 ? 0 : 1;
    const regions   = Array.isArray(allowed_regions) && allowed_regions.length > 0
      ? allowed_regions
      : ["UK", "EU"];
    const dashAccess = can_view_dashboard === true ? 1 : 0;
    const sipUser    = sip_username?.trim() || null;

    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE users SET name = ?, email = ?, role = ?, is_active = ?, sip_username = ?, allowed_regions = ?, can_view_dashboard = ? WHERE id = ?",
      [name.trim(), email.trim().toLowerCase(), role, activeVal, sipUser, JSON.stringify(regions), dashAccess, userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name, email, role, is_active, sip_username, allowed_regions, can_view_dashboard, created_at FROM users WHERE id = ?",
      [userId]
    );

    return NextResponse.json(rows[0]);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "A user with that email already exists" },
        { status: 409 }
      );
    }
    console.error("[PUT /api/users/:id]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
