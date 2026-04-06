-- ============================================================================
-- cleanup-duplicate-calls.sql
-- One-time migration: de-duplicate interactions by twilio_call_sid,
-- then enforce uniqueness so the ON DUPLICATE KEY UPDATE upsert works.
--
-- Run with:  mysql -u root tassapay_crm < scripts/cleanup-duplicate-calls.sql
-- ============================================================================

USE tassapay_crm;

-- ── 1. Audit: count before ─────────────────────────────────────────────────
SELECT '── BEFORE CLEANUP ──' AS step;
SELECT COUNT(*) AS total_interactions FROM interactions;
SELECT COUNT(*) AS duplicated_call_sids
FROM (
  SELECT twilio_call_sid
  FROM   interactions
  WHERE  twilio_call_sid IS NOT NULL
  GROUP  BY twilio_call_sid
  HAVING COUNT(*) > 1
) t;

-- ── 2. Delete duplicates ───────────────────────────────────────────────────
-- Strategy: for each duplicated twilio_call_sid keep ONE "best" row:
--   1st priority → has a recording_url
--   2nd priority → longest call_duration_seconds
--   3rd priority → highest id (latest insert)
-- Delete every other row sharing that twilio_call_sid.

DELETE i
FROM   interactions i
JOIN (
  -- For each duplicated SID, find the ONE keeper row
  SELECT twilio_call_sid,
         (
           SELECT id
           FROM   interactions i2
           WHERE  i2.twilio_call_sid = dup.twilio_call_sid
           ORDER  BY (i2.recording_url IS NOT NULL AND i2.recording_url != '') DESC,
                     COALESCE(i2.call_duration_seconds, 0) DESC,
                     i2.id DESC
           LIMIT  1
         ) AS keep_id
  FROM (
    SELECT twilio_call_sid
    FROM   interactions
    WHERE  twilio_call_sid IS NOT NULL
    GROUP  BY twilio_call_sid
    HAVING COUNT(*) > 1
  ) dup
) keeper
  ON  i.twilio_call_sid = keeper.twilio_call_sid
  AND i.id != keeper.keep_id;

-- ── 3. Audit: count after ──────────────────────────────────────────────────
SELECT '── AFTER CLEANUP ──' AS step;
SELECT COUNT(*) AS total_interactions FROM interactions;
SELECT COUNT(*) AS remaining_duplicates
FROM (
  SELECT twilio_call_sid
  FROM   interactions
  WHERE  twilio_call_sid IS NOT NULL
  GROUP  BY twilio_call_sid
  HAVING COUNT(*) > 1
) t;

-- ── 4. Drop the old non-unique index and add a UNIQUE index ────────────────
-- The live DB has a plain INDEX `idx_call_sid`; we need UNIQUE for upsert.
DROP INDEX idx_call_sid ON interactions;
ALTER TABLE interactions
  ADD UNIQUE INDEX uq_interactions_call_sid (twilio_call_sid);

SELECT '── MIGRATION COMPLETE ──' AS step;
