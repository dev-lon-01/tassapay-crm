import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { requireAuth } from "@/src/lib/auth";

const SSE_TTL_SECONDS = 5 * 60;

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "JWT_SECRET not set" }, { status: 500 });
  }

  const token = jwt.sign(
    {
      id: auth.id,
      email: auth.email,
      name: auth.name,
      role: auth.role,
      allowed_regions: auth.allowed_regions,
      can_view_dashboard: auth.can_view_dashboard,
      sse: true,
    },
    secret,
    { expiresIn: SSE_TTL_SECONDS, audience: "sse" }
  );

  return NextResponse.json({ token, expiresIn: SSE_TTL_SECONDS });
}
