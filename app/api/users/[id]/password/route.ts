import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { ResultSetHeader } from "mysql2";

/**
 * PATCH /api/users/[id]/password
 * Admin only - reset a user's password
 * Body: { newPassword }
 */
export async function PATCH(
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
    const { newPassword } = body as { newPassword?: string };

    if (!newPassword?.trim()) {
      return NextResponse.json(
        { error: "newPassword is required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const hash = await bcrypt.hash(newPassword, 10);

    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [hash, userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/users/:id/password]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
