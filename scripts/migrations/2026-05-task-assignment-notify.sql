-- 2026-05-15: Task assignment notifications — per-user prefs and pushover key.

ALTER TABLE users
  ADD COLUMN pushover_user_key VARCHAR(64) DEFAULT NULL
    COMMENT 'Pushover user/group key for direct notifications (set per agent by admin)',
  ADD COLUMN notify_task_assignment_pushover TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Send Pushover when this user is assigned a task',
  ADD COLUMN notify_task_assignment_email TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Send email when this user is assigned a task',
  ADD COLUMN notify_self_assignments TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Send notifications when this user self-assigns a task';
