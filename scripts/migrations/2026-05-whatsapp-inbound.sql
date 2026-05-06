-- WhatsApp Cloud API inbound: extend task_comments for system/channel messages,
-- add unique WAMID dedup, and create an inbox for unmatched inbound messages.
-- Also seeds a System user used as `tasks.created_by` for auto-created WhatsApp tasks.

-- 1. task_comments: allow system messages, capture channel + media + external id
ALTER TABLE `task_comments`
  MODIFY COLUMN `agent_id` INT NULL,
  ADD COLUMN `source` ENUM('Agent','WhatsApp','SMS','Email','System') NOT NULL DEFAULT 'Agent' AFTER `kind`,
  ADD COLUMN `media_url` VARCHAR(1024) NULL AFTER `source`,
  ADD COLUMN `external_message_id` VARCHAR(128) NULL AFTER `media_url`,
  ADD UNIQUE KEY `uq_task_comments_external_msg` (`external_message_id`),
  ADD INDEX `idx_task_comments_source_created` (`source`, `created_at`);

-- 2. whatsapp_inbox: holds inbound messages we couldn't auto-match to a customer
CREATE TABLE IF NOT EXISTS `whatsapp_inbox` (
  `id`                BIGINT        NOT NULL AUTO_INCREMENT,
  `wamid`             VARCHAR(128)  NOT NULL,
  `from_phone`        VARCHAR(32)   NOT NULL,
  `message_type`      VARCHAR(32)   NOT NULL,
  `body`              TEXT          DEFAULT NULL,
  `media_url`         VARCHAR(1024) DEFAULT NULL,
  `raw_payload`       JSON          NOT NULL,
  `attached_task_id`  INT           DEFAULT NULL,
  `attached_at`       DATETIME      DEFAULT NULL,
  `attached_by`       INT           DEFAULT NULL,
  `received_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_whatsapp_inbox_wamid` (`wamid`),
  CONSTRAINT `fk_whatsapp_inbox_task`
    FOREIGN KEY (`attached_task_id`) REFERENCES `tasks` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_whatsapp_inbox_attached_by`
    FOREIGN KEY (`attached_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_whatsapp_inbox_attached` (`attached_task_id`),
  INDEX `idx_whatsapp_inbox_received` (`received_at`),
  INDEX `idx_whatsapp_inbox_from`     (`from_phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. System user for auto-created WhatsApp tasks (tasks.created_by is NOT NULL).
--    Insert if missing; capture id into env SYSTEM_USER_ID afterwards.
INSERT INTO `users` (`name`, `role`, `email`, `is_active`, `allowed_regions`)
SELECT 'System (Inbound)', 'System', 'system-inbound@tassapay.internal', 1, '["UK","EU"]'
WHERE NOT EXISTS (
  SELECT 1 FROM `users` WHERE `email` = 'system-inbound@tassapay.internal'
);

-- After running, capture the id:
--   SELECT id FROM users WHERE email = 'system-inbound@tassapay.internal';
-- Set SYSTEM_USER_ID=<that id> in your .env file.
