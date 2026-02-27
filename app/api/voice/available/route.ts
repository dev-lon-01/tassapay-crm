import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { pool } from "@/src/lib/db";

export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { available } = (await req.json()) as { available: boolean };

  await pool.execute(
    "UPDATE users SET voice_available = ? WHERE id = ?",
    [available ? 1 : 0, auth.id]
  );

  return NextResponse.json({ ok: true });
}
