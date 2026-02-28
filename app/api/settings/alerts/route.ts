import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * GET /api/settings/alerts
 * Returns all alert routing rules.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM alert_routings ORDER BY destination_country, source_currency"
    );
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/settings/alerts]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/settings/alerts
 * Create a new routing rule.
 * Body: { source_currency, alert_emails?, alert_phones?, destination_country? }
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      source_currency,
      alert_emails = null,
      alert_phones = null,
      pushover_sound = "pushover",
      pushover_priority = 0,
      pushover_enabled = true,
      destination_country = "Somalia",
      is_active = true,
    } = body as {
      source_currency: string;
      alert_emails?: string | null;
      alert_phones?: string | null;
      pushover_sound?: string;
      pushover_priority?: number;
      pushover_enabled?: boolean;
      destination_country?: string;
      is_active?: boolean;
    };

    if (!source_currency?.trim()) {
      return NextResponse.json(
        { error: "source_currency is required" },
        { status: 400 }
      );
    }

    if (!alert_emails?.trim() && !alert_phones?.trim() && !pushover_enabled) {
      return NextResponse.json(
        { error: "At least one of Email, Phone, or Push Notification must be enabled" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO alert_routings
         (destination_country, source_currency, alert_emails, alert_phones,
          pushover_sound, pushover_priority, pushover_enabled, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        destination_country.trim(),
        source_currency.trim().toUpperCase(),
        alert_emails?.trim() || null,
        alert_phones?.trim() || null,
        pushover_sound,
        pushover_priority,
        pushover_enabled ? 1 : 0,
        is_active ? 1 : 0,
      ]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM alert_routings WHERE id = ?",
      [result.insertId]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Unique constraint violation
    if (typeof msg === "string" && msg.includes("Duplicate entry")) {
      return NextResponse.json(
        { error: "A rule for this country + currency already exists" },
        { status: 409 }
      );
    }
    console.error("[POST /api/settings/alerts]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
