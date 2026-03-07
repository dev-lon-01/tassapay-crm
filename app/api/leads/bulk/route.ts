import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { getPhoneLast9, normalizePhoneValue } from "@/src/lib/phoneUtils";
import {
  ensureObject,
  isPlainObject,
  parseJsonText,
  RequestValidationError,
  type ValidationIssue,
} from "@/src/lib/requestValidation";
import type { RowDataPacket, Connection } from "mysql2/promise";

interface BulkLeadRow {
  name: string;
  phone: string;
  country: string;
  assigned_agent_email: string;
  labels: string[];
}

function validateRows(rawBody: string): BulkLeadRow[] {
  const body = ensureObject(parseJsonText(rawBody));
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RequestValidationError("Invalid request payload", [
      { field: "rows", message: "rows array is required" },
    ]);
  }

  const issues: ValidationIssue[] = [];
  const valid: BulkLeadRow[] = [];

  rows.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push({ field: "rows", index, message: "Each row must be an object" });
      return;
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const phone = typeof entry.phone === "string" ? entry.phone.trim() : "";
    const country = typeof entry.country === "string" ? entry.country.trim() : "";
    const assignedAgentEmail = typeof entry.assigned_agent_email === "string"
      ? entry.assigned_agent_email.trim()
      : "";
    const labels = Array.isArray(entry.labels)
      ? entry.labels.filter((label): label is string => typeof label === "string").map((label) => label.trim()).filter(Boolean)
      : [];

    if (!name || !phone || !country) {
      issues.push({ field: "rows", index, message: "name, phone, and country are required" });
      return;
    }

    valid.push({
      name,
      phone,
      country,
      assigned_agent_email: assignedAgentEmail,
      labels,
    });
  });

  if (issues.length > 0) {
    throw new RequestValidationError("Invalid request payload", issues, 422);
  }

  return valid;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin") {
    return jsonError("Admin only", 403);
  }

  try {
    const rows = validateRows(await req.text());

    const agentEmails = [...new Set(rows.map((row) => row.assigned_agent_email).filter(Boolean))];
    const emailToId = new Map<string, number>();

    if (agentEmails.length > 0) {
      const placeholders = agentEmails.map(() => "?").join(",");
      const [agentRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email FROM users WHERE email IN (${placeholders})`,
        agentEmails
      );
      for (const row of agentRows) {
        emailToId.set(String(row.email), Number(row.id));
      }
    }

    const conn: Connection = await (pool as unknown as { getConnection(): Promise<Connection> }).getConnection();
    let imported = 0;
    let skipped = 0;

    try {
      await conn.beginTransaction();

      for (const row of rows) {
        const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
        const rnd = Math.floor(Math.random() * 9000 + 1000);
        const customerId = `LEAD-${ts}-${rnd}`;
        const phoneNormalized = normalizePhoneValue(row.phone);
        const phoneLast9 = getPhoneLast9(row.phone);
        const agentId = emailToId.get(row.assigned_agent_email) ?? null;
        const labelsJson = row.labels.length > 0 ? JSON.stringify(row.labels) : null;

        const [result] = await conn.execute(
          `INSERT IGNORE INTO customers
             (customer_id, full_name, phone_number, phone_normalized, phone_last9, country,
              assigned_agent_id, is_lead, lead_stage, labels, created_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'New', ?, NOW(), NOW())`,
          [customerId, row.name, row.phone, phoneNormalized, phoneLast9, row.country, agentId, labelsJson]
        );

        const affectedRows = (result as { affectedRows: number }).affectedRows;
        if (affectedRows > 0) imported++;
        else skipped++;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      (conn as unknown as { release(): void }).release();
    }

    return NextResponse.json({ imported, skipped, errors: [] });
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.message, err.status, err.issues);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/leads/bulk]", message);
    return jsonError(message, 500);
  }
}

