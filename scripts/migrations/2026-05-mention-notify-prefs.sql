-- 2026-05-15: Per-user email toggle for @mention notifications.

ALTER TABLE users
  ADD COLUMN notify_mentions_email TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Send email when this user is @-mentioned on a task';
