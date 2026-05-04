import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/src/lib/db";
import { requireAuth } from "@/src/lib/auth";
import { buildCountryFence, getAllowedCountries, REGION_MAP } from "@/src/lib/regionFence";
import type { RowDataPacket } from "mysql2";

/**
 * GET /api/activity/agents
 *
 * Returns agent interactions plus task events (created / closed / commented),
 * fenced to the caller's allowed regions.
 *
 * Query params (all optional):
 *   ?region=UK|EU
 *   ?type=Call|SMS|Note     - if set, task events are excluded (type is interaction-specific)
 *   ?agentId=
 *   ?from=YYYY-MM-DD
 *   ?to=YYYY-MM-DD
 *   ?limit=50, ?page=1
 *
 * Response: Array of {
 *   id, source ('interaction'|'task_created'|'task_closed'|'task_comment'),
 *   type, outcome, note, created_at, call_duration_seconds, direction, metadata,
 *   customer_id, recording_url, phone_number, agent_name, agent_id,
 *   customer_name, customer_country, task_id, task_title
 * }
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const regionParam = searchParams.get("region");
  const typeParam   = searchParams.get("type");
  const agentIdParam = searchParams.get("agentId");
  const fromParam    = searchParams.get("from");
  const toParam      = searchParams.get("to");
  const limit  = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const page   = Math.max(1, Number(searchParams.get("page") ?? 1));
  const offset = (page - 1) * limit;

  const callerRegions = auth.allowed_regions ?? ["UK", "EU"];
  let effectiveRegions: string[];

  if (regionParam) {
    if (!callerRegions.includes(regionParam) && auth.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    effectiveRegions = [regionParam];
  } else {
    effectiveRegions = auth.role === "Admin" ? Object.keys(REGION_MAP) : callerRegions;
  }

  const isAdmin = auth.role === "Admin" && !regionParam;
  const fence = buildCountryFence(effectiveRegions, isAdmin);
  const fenceCols = fence ? `(${fence.params.map(() => "?").join(",")})` : "";
  const fenceParams = fence?.params ?? [];

  try {
    const interactionFenceClause = fence
      ? `AND (c.country IN ${fenceCols} OR i.customer_id IS NULL)`
      : "";
    const taskFenceClause = fence ? `AND c.country IN ${fenceCols}` : "";

    const typeClause  = typeParam ? "AND i.type = ?" : "";
    const typeParams  = typeParam ? [typeParam] : [];

    const interactionAgentClause = agentIdParam ? "AND i.agent_id = ?" : "";
    const interactionAgentParams = agentIdParam ? [agentIdParam] : [];

    const interactionFromClause = fromParam ? "AND i.created_at >= ?" : "";
    const interactionFromParams = fromParam ? [fromParam] : [];

    const interactionToClause = toParam ? "AND i.created_at <= ?" : "";
    const interactionToParams = toParam ? [`${toParam} 23:59:59`] : [];

    const includeTaskEvents = !typeParam;

    let taskCreatedSql = "";
    let taskClosedSql = "";
    let taskCommentSql = "";
    const taskCreatedParams: (string | number)[] = [];
    const taskClosedParams: (string | number)[] = [];
    const taskCommentParams: (string | number)[] = [];

    if (includeTaskEvents) {
      const fromTs = fromParam ?? "1970-01-01 00:00:00";
      const toTs   = toParam ? `${toParam} 23:59:59` : "9999-12-31 23:59:59";
      const agentFilter = (col: string) => (agentIdParam ? `AND ${col} = ?` : "");

      taskCreatedSql = `
        SELECT
          t.id                AS id,
          'task_created'      AS source,
          NULL                AS type,
          NULL                AS outcome,
          t.title             AS note,
          t.created_at        AS created_at,
          NULL                AS call_duration_seconds,
          NULL                AS direction,
          NULL                AS metadata,
          t.customer_id       AS customer_id,
          NULL                AS recording_url,
          c.phone_number      AS phone_number,
          u.name              AS agent_name,
          u.id                AS agent_id,
          c.full_name         AS customer_name,
          c.country           AS customer_country,
          t.id                AS task_id,
          t.title             AS task_title
        FROM tasks t
        LEFT JOIN customers c ON c.customer_id = t.customer_id
        LEFT JOIN users u     ON u.id = t.created_by
        WHERE t.created_at BETWEEN ? AND ?
          ${taskFenceClause}
          ${agentFilter("t.created_by")}
      `;
      taskCreatedParams.push(fromTs, toTs, ...fenceParams);
      if (agentIdParam) taskCreatedParams.push(agentIdParam);

      taskClosedSql = `
        SELECT
          t.id                AS id,
          'task_closed'       AS source,
          NULL                AS type,
          NULL                AS outcome,
          t.title             AS note,
          t.closed_at         AS created_at,
          NULL                AS call_duration_seconds,
          NULL                AS direction,
          NULL                AS metadata,
          t.customer_id       AS customer_id,
          NULL                AS recording_url,
          c.phone_number      AS phone_number,
          u.name              AS agent_name,
          u.id                AS agent_id,
          c.full_name         AS customer_name,
          c.country           AS customer_country,
          t.id                AS task_id,
          t.title             AS task_title
        FROM tasks t
        LEFT JOIN customers c ON c.customer_id = t.customer_id
        LEFT JOIN users u     ON u.id = t.closed_by
        WHERE t.closed_at IS NOT NULL
          AND t.closed_at BETWEEN ? AND ?
          ${taskFenceClause}
          ${agentFilter("t.closed_by")}
      `;
      taskClosedParams.push(fromTs, toTs, ...fenceParams);
      if (agentIdParam) taskClosedParams.push(agentIdParam);

      taskCommentSql = `
        SELECT
          tc.id               AS id,
          'task_comment'      AS source,
          NULL                AS type,
          NULL                AS outcome,
          tc.comment          AS note,
          tc.created_at       AS created_at,
          NULL                AS call_duration_seconds,
          NULL                AS direction,
          NULL                AS metadata,
          t.customer_id       AS customer_id,
          NULL                AS recording_url,
          c.phone_number      AS phone_number,
          u.name              AS agent_name,
          u.id                AS agent_id,
          c.full_name         AS customer_name,
          c.country           AS customer_country,
          t.id                AS task_id,
          t.title             AS task_title
        FROM task_comments tc
        JOIN tasks t          ON t.id = tc.task_id
        LEFT JOIN customers c ON c.customer_id = t.customer_id
        LEFT JOIN users u     ON u.id = tc.agent_id
        WHERE tc.kind = 'user'
          AND tc.created_at BETWEEN ? AND ?
          ${taskFenceClause}
          ${agentFilter("tc.agent_id")}
      `;
      taskCommentParams.push(fromTs, toTs, ...fenceParams);
      if (agentIdParam) taskCommentParams.push(agentIdParam);
    }

    const interactionSql = `
      SELECT
        i.id                    AS id,
        'interaction'           AS source,
        i.type                  AS type,
        i.outcome               AS outcome,
        i.note                  AS note,
        i.created_at            AS created_at,
        i.call_duration_seconds AS call_duration_seconds,
        i.direction             AS direction,
        i.metadata              AS metadata,
        i.customer_id           AS customer_id,
        i.recording_url         AS recording_url,
        c.phone_number          AS phone_number,
        u.name                  AS agent_name,
        u.id                    AS agent_id,
        c.full_name             AS customer_name,
        c.country               AS customer_country,
        NULL                    AS task_id,
        NULL                    AS task_title
      FROM   interactions i
      LEFT JOIN customers c ON c.customer_id = i.customer_id
      LEFT JOIN users u     ON u.id = i.agent_id
      WHERE  (i.agent_id IS NOT NULL OR (i.type = 'SMS' AND i.direction = 'inbound'))
        ${interactionFenceClause}
        ${typeClause}
        ${interactionAgentClause}
        ${interactionFromClause}
        ${interactionToClause}
    `;
    const interactionParams = [
      ...fenceParams,
      ...typeParams,
      ...interactionAgentParams,
      ...interactionFromParams,
      ...interactionToParams,
    ];

    const branches: string[] = [interactionSql];
    const params: (string | number)[] = [...interactionParams];
    if (includeTaskEvents) {
      branches.push(taskCreatedSql, taskClosedSql, taskCommentSql);
      params.push(...taskCreatedParams, ...taskClosedParams, ...taskCommentParams);
    }

    const finalSql =
      branches.map((b) => `(${b})`).join(" UNION ALL ") +
      ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const [rows] = await pool.execute<RowDataPacket[]>(finalSql, params);

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/activity/agents]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
