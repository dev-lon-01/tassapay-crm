import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  id: number;
  email: string;
  name: string;
  role: string;
  allowed_regions: string[];
  can_view_dashboard: boolean;
}

/**
 * Validates the Bearer token in the Authorization header.
 *
 * Usage inside a route handler:
 *   const auth = requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;   // 401
 *   // auth is AuthPayload - use auth.id, auth.email, etc.
 */
export function requireAuth(req: NextRequest): AuthPayload | NextResponse {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  try {
    const decoded = jwt.verify(token, secret) as AuthPayload;
    return decoded;
  } catch {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
}
