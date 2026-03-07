import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { pool } from "@/src/lib/db";
import { jsonError } from "@/src/lib/httpResponses";
import {
  ensureObject,
  parseJsonText,
  RequestValidationError,
  requireBoolean,
} from "@/src/lib/requestValidation";

export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = ensureObject(parseJsonText(await req.text()));
    const available = requireBoolean(body.available, "available");

    if (available) {
      await pool.execute(
        "UPDATE users SET voice_available = 1, voice_last_seen_at = UTC_TIMESTAMP() WHERE id = ?",
        [auth.id]
      );
    } else {
      await pool.execute(
        "UPDATE users SET voice_available = 0 WHERE id = ?",
        [auth.id]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/voice/available]", message);
    return jsonError(message, 500);
  }
}

