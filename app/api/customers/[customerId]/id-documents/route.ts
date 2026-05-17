import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import type { RowDataPacket } from "mysql2";

interface IdDocumentRow extends RowDataPacket {
  id: number;
  sender_id_id: string;
  customer_id: string;
  id_type: string | null;
  id_name: string | null;
  id_number: string | null;
  sender_name_on_id: string | null;
  place_of_issue: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  dob: string | null;
  front_image_path: string | null;
  back_image_path: string | null;
  pdf_path: string | null;
  mrz_number: string | null;
  journey_id: string | null;
  is_legacy: number;
  verified: number;
  verified_by: string | null;
  verified_date: string | null;
  comments: string | null;
  source_inserted_at: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { customerId: string } },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const [rows] = await pool.execute<IdDocumentRow[]>(
      `SELECT id, sender_id_id, customer_id, id_type, id_name, id_number,
              sender_name_on_id, place_of_issue, issue_date, expiry_date, dob,
              front_image_path, back_image_path, pdf_path,
              mrz_number, journey_id, is_legacy, verified, verified_by, verified_date,
              comments, source_inserted_at
       FROM customer_id_documents
       WHERE customer_id = ?
       ORDER BY source_inserted_at DESC, id DESC`,
      [params.customerId],
    );
    return NextResponse.json({ data: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/customers/:customerId/id-documents]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
