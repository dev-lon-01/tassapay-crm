import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "@/src/lib/db";
import type { RowDataPacket } from "mysql2";

/**
 * POST /api/auth/login
 *
 * Body: { email, password }
 * Returns: { token, user: { id, name, role, email } }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email?.trim() || !password?.trim()) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name, role, email, password_hash, is_active, allowed_regions, can_view_dashboard FROM users WHERE email = ? LIMIT 1",
      [email.trim().toLowerCase()]
    );

    if (!rows.length) {
      // Deliberate vague message - don't reveal whether the email exists
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = rows[0];

    if (!user.is_active) {
      return NextResponse.json(
        { error: "Account deactivated. Please contact your administrator." },
        { status: 403 }
      );
    }

    if (!user.password_hash) {
      return NextResponse.json(
        { error: "Account not configured for password login" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not set");

    // allowed_regions may be stored as a JSON string in MySQL
    const allowedRegions: string[] =
      typeof user.allowed_regions === "string"
        ? JSON.parse(user.allowed_regions)
        : (user.allowed_regions ?? ["UK", "EU"]);
    const canViewDashboard = Boolean(user.can_view_dashboard);

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      allowed_regions: allowedRegions,
      can_view_dashboard: canViewDashboard,
    };
    const token = jwt.sign(payload, secret, { expiresIn: "1d" });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email,
        allowed_regions: allowedRegions,
        can_view_dashboard: canViewDashboard,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/auth/login]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
