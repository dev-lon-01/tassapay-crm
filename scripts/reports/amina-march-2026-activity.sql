-- Agent Daily Activity Report (gap-based active time)
-- Agent: amina@tassapay.com | Period: March 2026
-- Gap threshold: 30 minutes (gaps > 30 min treated as offline)

WITH ordered AS (
  SELECT
    DATE(i.created_at) AS day,
    i.created_at AS ts,
    i.type,
    i.call_duration_seconds,
    i.customer_id,
    LAG(i.created_at) OVER (PARTITION BY DATE(i.created_at) ORDER BY i.created_at) AS prev_ts
  FROM interactions i
  JOIN users u ON u.id = i.agent_id
  WHERE u.email = 'amina@tassapay.com'
    AND i.created_at >= '2026-03-01'
    AND i.created_at <  '2026-04-01'
),
gaps AS (
  SELECT
    day, ts, type, call_duration_seconds, customer_id,
    TIMESTAMPDIFF(SECOND, prev_ts, ts) AS gap_seconds,
    CASE
      WHEN prev_ts IS NULL THEN 0
      WHEN TIMESTAMPDIFF(MINUTE, prev_ts, ts) <= 30 THEN TIMESTAMPDIFF(SECOND, prev_ts, ts)
      ELSE 0
    END AS active_seconds
  FROM ordered
)
SELECT
  day,
  TIME(MIN(ts))                                                                        AS first_activity,
  TIME(MAX(ts))                                                                        AS last_activity,
  TIMEDIFF(MAX(ts), MIN(ts))                                                          AS wall_clock_span,
  SEC_TO_TIME(SUM(active_seconds))                                                    AS active_working_time,
  COUNT(*)                                                                             AS total_activities,
  SUM(type = 'Call')                                                                   AS calls,
  SUM(type = 'SMS')                                                                    AS sms,
  SUM(type = 'Note')                                                                   AS notes,
  SUM(type = 'Email')                                                                  AS emails,
  COUNT(DISTINCT customer_id)                                                          AS unique_customers,
  SEC_TO_TIME(SUM(COALESCE(call_duration_seconds, 0)))                                AS total_call_time,
  SUM(CASE WHEN type = 'Call' AND call_duration_seconds > 0 THEN 1 ELSE 0 END)       AS connected_calls,
  SUM(CASE WHEN type = 'Call' AND COALESCE(call_duration_seconds, 0) = 0 THEN 1 ELSE 0 END) AS no_answer_calls,
  SUM(CASE WHEN gap_seconds > 1800 THEN 1 ELSE 0 END)                                AS session_breaks
FROM gaps
GROUP BY day
ORDER BY day ASC;
