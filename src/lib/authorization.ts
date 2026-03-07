import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import type { AuthPayload } from "@/src/lib/auth";
import { pool } from "@/src/lib/db";
import { getAllowedCountries } from "@/src/lib/regionFence";

export interface CustomerAccessRow extends RowDataPacket {
  customer_id: string;
  country: string | null;
  is_lead: number;
}

export function requireAdmin(auth: AuthPayload): NextResponse | null {
  if (auth.role === "Admin") return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function resolveActorAgentId(
  auth: AuthPayload,
  requestedAgentId: unknown
): number {
  if (auth.role === "Admin" && requestedAgentId != null) {
    const parsed = Number(requestedAgentId);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return auth.id;
}

export async function authorizeCustomerWriteAccess(
  customerId: string,
  auth: AuthPayload,
  options?: { requireLead?: boolean }
): Promise<CustomerAccessRow | NextResponse> {
  const [rows] = await pool.execute<CustomerAccessRow[]>(
    `SELECT customer_id, country, is_lead
     FROM   customers
     WHERE  customer_id = ?
     LIMIT 1`,
    [customerId]
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { error: options?.requireLead ? "Lead not found" : "Customer not found" },
      { status: 404 }
    );
  }

  if (options?.requireLead && !row.is_lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (auth.role === "Admin") return row;

  const allowedCountries = getAllowedCountries(auth.allowed_regions ?? ["UK", "EU"]);
  const country = row.country ?? "";
  if (!allowedCountries.includes(country)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return row;
}

export async function authorizeLeadWriteAccess(
  customerId: string,
  auth: AuthPayload
): Promise<CustomerAccessRow | NextResponse> {
  return authorizeCustomerWriteAccess(customerId, auth, { requireLead: true });
}

