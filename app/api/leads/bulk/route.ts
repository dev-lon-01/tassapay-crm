import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket, Connection } from "mysql2/promise";

/**
 * POST /api/leads/bulk
 *
 * Admin-only bulk lead import.
 * Body: {
 *   rows: Array<{
 *     name:                 string;
 *     phone:                string;   // E.164 e.g. +447911123456
 *     country:              string;
 *     assigned_agent_email: string;
 *     labels:               string[]; // already parsed array
 *   }>
 * }
 *
 * The endpoint:
 *  1. Maps assigned_agent_email → agent id (batch lookup).
 *  2. Wraps all INSERTs in a transaction (rolls back on fatal error).
 *  3. Uses INSERT IGNORE as a last-resort safety net for duplicates.
 *
 * Returns: { imported: number; skipped: number; errors: string[] }
 */

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: { rows?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows array is required" }, { status: 400 });
  }

  // Validate row shape
  const valid: { name: string; phone: string; country: string; assigned_agent_email: string; labels: string[] }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r.name || !r.phone || !r.country) {
      errors.push(`Row ${i + 1}: missing required field(s)`);
      continue;
    }
    valid.push({
      name:                 String(r.name).trim(),
      phone:                String(r.phone).trim(),
      country:              String(r.country).trim(),
      assigned_agent_email: r.assigned_agent_email ? String(r.assigned_agent_email).trim() : "",
      labels:               Array.isArray(r.labels) ? (r.labels as string[]) : [],
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ imported: 0, skipped: rows.length, errors }, { status: 422 });
  }

  // Batch-resolve agent emails → ids
  const agentEmails = [...new Set(valid.map((r) => r.assigned_agent_email).filter(Boolean))];
  const emailToId = new Map<string, number>();

  if (agentEmails.length > 0) {
    const placeholders = agentEmails.map(() => "?").join(",");
    const [agentRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, email FROM users WHERE email IN (${placeholders})`,
      agentEmails
    );
    for (const row of agentRows) {
      emailToId.set(row.email, row.id);
    }
  }

  const conn: Connection = await (pool as unknown as { getConnection(): Promise<Connection> }).getConnection();

  let imported = 0;
  let skipped  = 0;

  try {
    await conn.beginTransaction();

    for (const row of valid) {
      const ts  = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      const rnd = Math.floor(Math.random() * 9000 + 1000);
      const customerId = `LEAD-${ts}-${rnd}`;

      const phoneNorm   = row.phone.replace(/[\s\-]/g, "");
      const agentId     = emailToId.get(row.assigned_agent_email) ?? null;
      const labelsJson  = row.labels.length > 0 ? JSON.stringify(row.labels) : null;

      const [result] = await conn.execute(
        `INSERT IGNORE INTO customers
           (customer_id, full_name, phone_number, country,
            assigned_agent_id, is_lead, lead_stage, labels, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, 1, 'New', ?, NOW(), NOW())`,
        [customerId, row.name, phoneNorm, row.country, agentId, labelsJson]
      );

      const affectedRows = (result as { affectedRows: number }).affectedRows;
      if (affectedRows > 0) {
        imported++;
      } else {
        skipped++;
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/leads/bulk]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    (conn as unknown as { release(): void }).release();
  }

  return NextResponse.json({ imported, skipped, errors });
}
