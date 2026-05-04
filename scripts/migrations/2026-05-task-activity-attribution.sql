-- Adds first-class close attribution to tasks and a comment kind discriminator
-- so closing a task isn't double-counted as a comment in agent activity metrics.
-- Also backfills closed_by/closed_at for existing closed tasks (best-effort,
-- using the heuristic "last comment author = closer").

ALTER TABLE `tasks`
  ADD COLUMN `closed_by` INT NULL AFTER `status`,
  ADD COLUMN `closed_at` DATETIME NULL AFTER `closed_by`,
  ADD CONSTRAINT `fk_tasks_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD INDEX `idx_tasks_closed_at` (`closed_at`),
  ADD INDEX `idx_tasks_closed_by` (`closed_by`);

ALTER TABLE `task_comments`
  ADD COLUMN `kind` ENUM('user','close_resolution') NOT NULL DEFAULT 'user' AFTER `comment`,
  ADD INDEX `idx_task_comments_kind_created` (`kind`, `created_at`);

-- Best-effort backfill: assume the most recent comment on a closed task was
-- the resolution comment authored by whoever closed it. May be wrong for old
-- tasks that received later admin comments; field is authoritative going forward.
UPDATE `tasks` t
JOIN (
  SELECT
    `task_id`,
    `agent_id`,
    `created_at`,
    ROW_NUMBER() OVER (PARTITION BY `task_id` ORDER BY `id` DESC) AS rn
  FROM `task_comments`
) tc
  ON tc.`task_id` = t.`id` AND tc.rn = 1
SET
  t.`closed_by` = tc.`agent_id`,
  t.`closed_at` = tc.`created_at`
WHERE t.`status` = 'Closed'
  AND t.`closed_by` IS NULL;

-- Best-effort backfill: tag the inferred resolution comment as such so it's
-- excluded from taskComments counts.
UPDATE `task_comments` tc
JOIN `tasks` t
  ON t.`id` = tc.`task_id`
 AND t.`closed_at` IS NOT NULL
 AND t.`closed_by` = tc.`agent_id`
 AND tc.`created_at` = t.`closed_at`
SET tc.`kind` = 'close_resolution'
WHERE tc.`kind` = 'user';
