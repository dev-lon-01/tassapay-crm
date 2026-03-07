import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { normalizePhoneValue } from "@/src/lib/phoneUtils";
import {
  ensureObject,
  parseJsonText,
  RequestValidationError,
} from "@/src/lib/requestValidation";
import type { RowDataPacket } from "mysql2";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = ensureObject(parseJsonText(await req.text()));
    const phones = body.phones;
    if (!Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    const normalized = phones
      .filter((phone): phone is string => typeof phone === "string")
      .map((phone) => normalizePhoneValue(phone))
      .filter((phone): phone is string => Boolean(phone));

    if (normalized.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    const placeholders = normalized.map(() => "?").join(",");
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT phone_normalized, phone_number
       FROM   customers
       WHERE  phone_normalized IN (${placeholders})`,
      normalized
    );

    const found = new Set(
      rows
        .map((row) => String(row.phone_normalized ?? normalizePhoneValue(String(row.phone_number ?? ""))))
        .filter(Boolean)
    );

    const duplicates = phones.filter(
      (phone): phone is string => typeof phone === "string" && found.has(normalizePhoneValue(phone) ?? "")
    );

    return NextResponse.json({ duplicates });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(message, 500);
  }
}

