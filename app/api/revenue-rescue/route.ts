import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence } from "@/src/lib/regionFence";
import { jsonError } from "@/src/lib/httpResponses";

const VALID_DAYS = new Set([1, 2, 7, 14, 30, 60]);
const VALID_BUCKETS = new Set([
  "all",
  "somalia_sla",
  "standard_sla",
  "payment_received_not_processed",
  "processed_not_paid",
  "cancelled_recent",
]);
const VALID_SORTS = new Set(["severity", "oldest", "amount_desc", "recent"]);

const BUCKET_COLUMN: Record<string, string> = {
  somalia_sla: "somalia_sla",
  standard_sla: "standard_sla",
  payment_received_not_processed: "payment_received_not_processed",
  processed_not_paid: "processed_not_paid",
  cancelled_recent: "cancelled_recent",
};

const SORT_SQL: Record<string, string> = {
  severity: "severity_score DESC, created_at ASC, transfer_id ASC",
  oldest: "created_at ASC, transfer_id ASC",
  amount_desc: "COALESCE(send_amount, 0) DESC, created_at ASC",
  recent: "created_at DESC, transfer_id DESC",
};

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value: string | null): string {
  return value?.trim() ?? "";
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeRiskSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}somalia_sla = 1 OR ${prefix}standard_sla = 1 OR ${prefix}payment_received_not_processed = 1 OR ${prefix}processed_not_paid = 1)`;
}

function anyRiskSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `(${activeRiskSql(alias)} OR ${prefix}cancelled_recent = 1)`;
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (auth.role !== "Admin" && !auth.can_view_dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  const requestedDays = Number(searchParams.get("days") ?? "30");
  const days = VALID_DAYS.has(requestedDays) ? requestedDays : 30;

  const requestedBucket = searchParams.get("bucket") ?? "all";
  const bucket = VALID_BUCKETS.has(requestedBucket) ? requestedBucket : "all";

  const requestedSort = searchParams.get("sort") ?? "severity";
  const sort = VALID_SORTS.has(requestedSort) ? requestedSort : "severity";

  const page = parsePositiveInt(searchParams.get("page"), 1);
  const limit = Math.min(200, parsePositiveInt(searchParams.get("limit"), 50));
  const offset = (page - 1) * limit;

  const search = normalizeText(searchParams.get("search"));
  const country = normalizeText(searchParams.get("country"));
  const agentIdRaw = normalizeText(searchParams.get("agentId"));
  let agentId: number | null = null;

  if (agentIdRaw) {
    const parsedAgentId = Number(agentIdRaw);
    if (!Number.isInteger(parsedAgentId) || parsedAgentId <= 0) {
      return jsonError("Invalid agentId", 400);
    }
    agentId = parsedAgentId;
  }

  const where: string[] = [
    "t.created_at IS NOT NULL",
    "t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)",
  ];
  const params: (string | number)[] = [days, days];

  const fence = buildCountryFence(
    auth.allowed_regions ?? ["UK", "EU"],
    auth.role === "Admin",
  );
  if (fence) {
    where.push(`c.${fence.sql}`);
    params.push(...fence.params);
  }

  if (country) {
    where.push("t.destination_country = ?");
    params.push(country);
  }

  if (agentId) {
    where.push(
      "(t.attributed_agent_id = ? OR c.assigned_agent_id = ? OR c.assigned_user_id = ? OR ot.assigned_agent_id = ?)",
    );
    params.push(agentId, agentId, agentId, agentId);
  }

  if (search) {
    where.push(
      `(t.transaction_ref LIKE ?
        OR t.data_field_id LIKE ?
        OR c.full_name LIKE ?
        OR c.email LIKE ?
        OR c.phone_number LIKE ?
        OR c.phone_normalized LIKE ?)`,
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const bucketSql = bucket === "all" ? "" : `WHERE ${BUCKET_COLUMN[bucket]} = 1`;

  const cte = `
    WITH latest_open_task AS (
      SELECT *
      FROM (
        SELECT
          task_rows.id,
          task_rows.transfer_reference,
          task_rows.title,
          task_rows.priority,
          task_rows.status,
          task_rows.assigned_agent_id,
          task_rows.updated_at,
          task_owner.name AS assigned_agent_name,
          ROW_NUMBER() OVER (
            PARTITION BY task_rows.transfer_reference
            ORDER BY task_rows.updated_at DESC, task_rows.id DESC
          ) AS rn
        FROM tasks task_rows
        LEFT JOIN users task_owner ON task_owner.id = task_rows.assigned_agent_id
        WHERE task_rows.status != 'Closed'
          AND task_rows.transfer_reference IS NOT NULL
          AND task_rows.transfer_reference != ''
      ) ranked_tasks
      WHERE rn = 1
    ),
    latest_interaction AS (
      SELECT *
      FROM (
        SELECT
          interaction_rows.id,
          interaction_rows.customer_id,
          interaction_rows.type,
          interaction_rows.outcome,
          interaction_rows.direction,
          interaction_rows.created_at,
          interaction_agent.name AS agent_name,
          ROW_NUMBER() OVER (
            PARTITION BY interaction_rows.customer_id
            ORDER BY interaction_rows.created_at DESC, interaction_rows.id DESC
          ) AS rn
        FROM interactions interaction_rows
        LEFT JOIN users interaction_agent ON interaction_agent.id = interaction_rows.agent_id
        WHERE interaction_rows.customer_id IS NOT NULL
      ) ranked_interactions
      WHERE rn = 1
    ),
    base AS (
      SELECT
        t.id AS transfer_id,
        t.transaction_ref,
        t.data_field_id,
        t.customer_id,
        t.created_at,
        t.send_amount,
        t.send_currency,
        t.destination_country,
        t.beneficiary_name,
        t.status,
        t.payment_status,
        t.hold_reason,
        TIMESTAMPDIFF(MINUTE, t.created_at, NOW()) AS age_minutes,

        c.full_name AS customer_name,
        c.email AS customer_email,
        c.phone_number AS customer_phone,
        c.country AS customer_country,

        COALESCE(t.attributed_agent_id, c.assigned_agent_id, c.assigned_user_id) AS owner_agent_id,
        COALESCE(attributed_user.name, assigned_agent.name, assigned_user.name) AS owner_agent_name,

        ot.id AS open_task_id,
        ot.title AS open_task_title,
        ot.priority AS open_task_priority,
        ot.status AS open_task_status,
        ot.assigned_agent_id AS open_task_assigned_agent_id,
        ot.assigned_agent_name AS open_task_assigned_agent_name,
        ot.updated_at AS open_task_updated_at,

        li.id AS latest_interaction_id,
        li.type AS latest_interaction_type,
        li.outcome AS latest_interaction_outcome,
        li.direction AS latest_interaction_direction,
        li.created_at AS latest_interaction_at,
        li.agent_name AS latest_interaction_agent_name,

        CASE
          WHEN t.destination_country = 'Somalia'
           AND COALESCE(t.status, '') NOT IN ('Completed', 'Deposited', 'Paid', 'Cancel', 'Cancelled', 'Rejected', 'Failed', 'Refunded', 'Returned', 'Chargeback')
           AND t.created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
          THEN 1 ELSE 0
        END AS somalia_sla,

        CASE
          WHEN COALESCE(t.destination_country, '') != 'Somalia'
           AND COALESCE(t.status, '') NOT IN ('Completed', 'Deposited', 'Paid', 'Cancel', 'Cancelled', 'Rejected', 'Failed', 'Refunded', 'Returned', 'Chargeback')
           AND t.created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          THEN 1 ELSE 0
        END AS standard_sla,

        CASE
          WHEN t.payment_status = 'Received'
           AND COALESCE(t.status, '') NOT IN ('Completed', 'Deposited', 'Cancel', 'Cancelled')
          THEN 1 ELSE 0
        END AS payment_received_not_processed,

        CASE WHEN t.status = 'Processed' THEN 1 ELSE 0 END AS processed_not_paid,

        CASE
          WHEN t.status IN ('Cancel', 'Cancelled')
           AND t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          THEN 1 ELSE 0
        END AS cancelled_recent
      FROM transfers t
      LEFT JOIN customers c ON c.customer_id = t.customer_id
      LEFT JOIN users attributed_user ON attributed_user.id = t.attributed_agent_id
      LEFT JOIN users assigned_agent ON assigned_agent.id = c.assigned_agent_id
      LEFT JOIN users assigned_user ON assigned_user.id = c.assigned_user_id
      LEFT JOIN latest_open_task ot ON ot.transfer_reference = t.transaction_ref
      LEFT JOIN latest_interaction li ON li.customer_id = t.customer_id
      ${whereSql}
    ),
    flagged AS (
      SELECT
        base.*,
        CASE
          WHEN somalia_sla = 1 THEN 'somalia_sla'
          WHEN payment_received_not_processed = 1 THEN 'payment_received_not_processed'
          WHEN standard_sla = 1 THEN 'standard_sla'
          WHEN processed_not_paid = 1 THEN 'processed_not_paid'
          ELSE 'cancelled_recent'
        END AS primary_bucket,
        CASE
          WHEN somalia_sla = 1 THEN 5000 + age_minutes
          WHEN payment_received_not_processed = 1 THEN 4000 + age_minutes
          WHEN standard_sla = 1 THEN 3000 + age_minutes
          WHEN processed_not_paid = 1 THEN 2000 + age_minutes
          WHEN cancelled_recent = 1 THEN 1000 + age_minutes
          ELSE 0
        END AS severity_score
      FROM base
      WHERE ${anyRiskSql()}
    ),
    filtered AS (
      SELECT *
      FROM flagged
      ${bucketSql}
    )
  `;

  try {
    const [summaryRows] = await pool.execute<RowDataPacket[]>(
      `${cte}
       SELECT
         COALESCE(SUM(CASE WHEN ${anyRiskSql("base")} THEN 1 ELSE 0 END), 0) AS total_rows,
         COALESCE(SUM(somalia_sla), 0) AS somalia_sla,
         COALESCE(SUM(standard_sla), 0) AS standard_sla,
         COALESCE(SUM(payment_received_not_processed), 0) AS payment_received_not_processed,
         COALESCE(SUM(processed_not_paid), 0) AS processed_not_paid,
         COALESCE(SUM(cancelled_recent), 0) AS cancelled_recent,
         COALESCE(SUM(CASE WHEN ${activeRiskSql("base")} THEN COALESCE(send_amount, 0) ELSE 0 END), 0) AS total_money_at_risk,
         COALESCE(MAX(CASE WHEN ${activeRiskSql("base")} THEN age_minutes ELSE NULL END), 0) AS oldest_stuck_minutes,
         COALESCE(SUM(CASE WHEN ${activeRiskSql("base")} AND open_task_id IS NULL THEN 1 ELSE 0 END), 0) AS no_open_task,
         COALESCE(SUM(CASE WHEN ${activeRiskSql("base")} AND (latest_interaction_at IS NULL OR latest_interaction_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)) THEN 1 ELSE 0 END), 0) AS no_contact_24h
       FROM base`,
      params,
    );

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `${cte} SELECT COUNT(*) AS total FROM filtered`,
      params,
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `${cte}
       SELECT *
       FROM filtered
       ORDER BY ${SORT_SQL[sort]}
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const summary = summaryRows[0] ?? {};
    const total = Number(countRows[0]?.total ?? 0);

    return NextResponse.json({
      summary: {
        totalRows: Number(summary.total_rows ?? 0),
        buckets: {
          somalia_sla: Number(summary.somalia_sla ?? 0),
          standard_sla: Number(summary.standard_sla ?? 0),
          payment_received_not_processed: Number(summary.payment_received_not_processed ?? 0),
          processed_not_paid: Number(summary.processed_not_paid ?? 0),
          cancelled_recent: Number(summary.cancelled_recent ?? 0),
        },
        totalMoneyAtRisk: Number(summary.total_money_at_risk ?? 0),
        oldestStuckMinutes: Number(summary.oldest_stuck_minutes ?? 0),
        noOpenTask: Number(summary.no_open_task ?? 0),
        noContact24h: Number(summary.no_contact_24h ?? 0),
      },
      data: rows.map((row) => ({
        transfer: {
          id: Number(row.transfer_id),
          transactionRef: row.transaction_ref as string | null,
          dataFieldId: row.data_field_id as string | null,
          customerId: row.customer_id as string | null,
          createdAt: row.created_at,
          sendAmount: numberOrNull(row.send_amount),
          sendCurrency: row.send_currency as string | null,
          destinationCountry: row.destination_country as string | null,
          beneficiaryName: row.beneficiary_name as string | null,
          status: row.status as string | null,
          paymentStatus: row.payment_status as string | null,
          holdReason: row.hold_reason as string | null,
        },
        customer: {
          id: row.customer_id as string | null,
          name: row.customer_name as string | null,
          email: row.customer_email as string | null,
          phone: row.customer_phone as string | null,
          country: row.customer_country as string | null,
        },
        owner: row.owner_agent_id
          ? {
              id: Number(row.owner_agent_id),
              name: row.owner_agent_name as string | null,
            }
          : null,
        openTask: row.open_task_id
          ? {
              id: Number(row.open_task_id),
              title: row.open_task_title as string | null,
              priority: row.open_task_priority as string | null,
              status: row.open_task_status as string | null,
              assignedAgentId: numberOrNull(row.open_task_assigned_agent_id),
              assignedAgentName: row.open_task_assigned_agent_name as string | null,
              updatedAt: row.open_task_updated_at,
            }
          : null,
        latestInteraction: row.latest_interaction_id
          ? {
              id: Number(row.latest_interaction_id),
              type: row.latest_interaction_type as string | null,
              outcome: row.latest_interaction_outcome as string | null,
              direction: row.latest_interaction_direction as string | null,
              createdAt: row.latest_interaction_at,
              agentName: row.latest_interaction_agent_name as string | null,
            }
          : null,
        riskFlags: {
          somalia_sla: Number(row.somalia_sla) === 1,
          standard_sla: Number(row.standard_sla) === 1,
          payment_received_not_processed: Number(row.payment_received_not_processed) === 1,
          processed_not_paid: Number(row.processed_not_paid) === 1,
          cancelled_recent: Number(row.cancelled_recent) === 1,
        },
        primaryBucket: row.primary_bucket as string,
        severityScore: Number(row.severity_score ?? 0),
        ageMinutes: Number(row.age_minutes ?? 0),
      })),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/revenue-rescue]", message);
    return jsonError(message, 500);
  }
}
