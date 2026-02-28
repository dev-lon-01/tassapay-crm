import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * PUT /api/settings/alerts/:id
 * Update an existing routing rule.
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

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      source_currency,
      alert_emails,
      alert_phones,
      pushover_sound,
      pushover_priority,
      pushover_enabled,
      destination_country,
      is_active,
    } = body as {
      source_currency?: string;
      alert_emails?: string | null;
      alert_phones?: string | null;
      pushover_sound?: string;
      pushover_priority?: number;
      pushover_enabled?: boolean;
      destination_country?: string;
      is_active?: boolean;
    };

    // Build dynamic SET clause with only provided fields
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (source_currency !== undefined) {
      sets.push("source_currency = ?");
      values.push(source_currency.trim().toUpperCase());
    }
    if (destination_country !== undefined) {
      sets.push("destination_country = ?");
      values.push(destination_country.trim());
    }
    if (alert_emails !== undefined) {
      sets.push("alert_emails = ?");
      values.push(alert_emails?.trim() || null);
    }
    if (alert_phones !== undefined) {
      sets.push("alert_phones = ?");
      values.push(alert_phones?.trim() || null);
    }
    if (is_active !== undefined) {
      sets.push("is_active = ?");
      values.push(is_active ? 1 : 0);
    }
    if (pushover_sound !== undefined) {
      sets.push("pushover_sound = ?");
      values.push(pushover_sound);
    }
    if (pushover_priority !== undefined) {
      sets.push("pushover_priority = ?");
      values.push(pushover_priority);
    }
    if (pushover_enabled !== undefined) {
      sets.push("pushover_enabled = ?");
      values.push(pushover_enabled ? 1 : 0);
    }

    if (!sets.length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(id);
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE alert_routings SET ${sets.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM alert_routings WHERE id = ?",
      [id]
    );
    return NextResponse.json(rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (typeof msg === "string" && msg.includes("Duplicate entry")) {
      return NextResponse.json(
        { error: "A rule for this country + currency already exists" },
        { status: 409 }
      );
    }
    console.error("[PUT /api/settings/alerts/:id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/alerts/:id
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM alert_routings WHERE id = ?",
      [id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/settings/alerts/:id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
