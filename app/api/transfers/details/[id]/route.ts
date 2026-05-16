import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { requireAdmin } from "@/src/lib/authorization";
import { buildCountryFence } from "@/src/lib/regionFence";
import { buildPaymentDiscrepancies, type PaymentRecord } from "@/src/lib/paymentReconciliation";
import { jsonError } from "@/src/lib/httpResponses";

interface TransferDetailRow extends RowDataPacket {
  id: number;
  customer_id: string;
  transaction_ref: string | null;
  data_field_id: string | null;
  created_at: string | null;
  tayo_date_paid: string | null;
  send_amount: number | null;
  send_currency: string | null;
  receive_amount: number | null;
  receive_currency: string | null;
  destination_country: string | null;
  beneficiary_name: string | null;
  status: string | null;
  hold_reason: string | null;
  payment_method: string | null;
  delivery_method: string | null;
  reconciliation_status: string | null;
  accounting_category: string | null;
  manual_adjustment_note: string | null;
  full_name: string | null;
  customer_country: string | null;
}

interface PaymentRow extends RowDataPacket, PaymentRecord {}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const transferId = Number(params.id);
    if (!Number.isInteger(transferId) || transferId <= 0) {
      return jsonError("Invalid transfer id", 400);
    }

    const fence = buildCountryFence(
      auth.allowed_regions ?? ["UK", "EU"],
      auth.role === "Admin",
    );

    const transferParams: (string | number)[] = [transferId];
    const whereFence = fence ? ` AND c.${fence.sql}` : "";
    if (fence) transferParams.push(...fence.params);

    const [transferRows] = await pool.execute<TransferDetailRow[]>(
      `SELECT t.id,
              t.customer_id,
              t.transaction_ref,
              t.data_field_id,
              t.created_at,
              t.tayo_date_paid,
              t.send_amount,
              t.send_currency,
              t.receive_amount,
              t.receive_currency,
              t.destination_country,
              t.beneficiary_name,
              t.status,
              t.hold_reason,
              t.payment_method,
              t.delivery_method,
              t.reconciliation_status,
              t.accounting_category,
              t.manual_adjustment_note,
              c.full_name,
              c.country AS customer_country
       FROM transfers t
       JOIN customers c ON c.customer_id = t.customer_id
       WHERE t.id = ?${whereFence}
       LIMIT 1`,
      transferParams,
    );

    const transfer = transferRows[0];
    if (!transfer) {
      return jsonError("Transfer not found", 404);
    }

    const refs = [transfer.transaction_ref, transfer.data_field_id].filter(
      (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index,
    );

    let payments: PaymentRow[] = [];
    if (refs.length > 0) {
      const placeholders = refs.map(() => "?").join(", ");
      const [paymentRows] = await pool.execute<PaymentRow[]>(
        `SELECT id,
                provider,
                provider_payment_id,
                transfer_ref,
                payment_type,
                payment_method,
                amount,
                currency,
                status,
                provider_status,
                payment_date
         FROM payments
         WHERE transfer_ref IN (${placeholders})
         ORDER BY COALESCE(payment_date, created_at) DESC, id DESC`,
        refs,
      );
      payments = paymentRows;
    }

    const discrepancies = buildPaymentDiscrepancies(
      {
        id: transfer.id,
        transaction_ref: transfer.transaction_ref,
        data_field_id: transfer.data_field_id,
        send_amount: transfer.send_amount,
        send_currency: transfer.send_currency,
        status: transfer.status,
      },
      payments,
    );

    return NextResponse.json({
      transfer,
      payments,
      discrepancies,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GET /api/transfers/details/${params.id}]`, message);
    return jsonError(message, 500);
  }
}

const VALID_CATEGORIES = new Set([
  "remittance",
  "operational_expense",
  "rounding_difference",
  "suspense",
]);

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const adminError = requireAdmin(auth);
  if (adminError) return adminError;

  try {
    const transferId = Number(params.id);
    if (!Number.isInteger(transferId) || transferId <= 0) {
      return jsonError("Invalid transfer id", 400);
    }

    const body = await req.json();
    const { accounting_category, manual_adjustment_note } = body ?? {};

    if (!accounting_category || !VALID_CATEGORIES.has(accounting_category)) {
      return jsonError(
        `Invalid accounting_category. Must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
        400,
      );
    }

    const note = typeof manual_adjustment_note === "string"
      ? manual_adjustment_note.trim().slice(0, 2000) || null
      : null;

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE transfers
       SET    accounting_category = ?,
              manual_adjustment_note = ?,
              reconciliation_status = 'manual_adjustment'
       WHERE  id = ?`,
      [accounting_category, note, transferId],
    );

    if (result.affectedRows === 0) {
      return jsonError("Transfer not found", 404);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PUT /api/transfers/details/${params.id}]`, message);
    return jsonError(message, 500);
  }
}
