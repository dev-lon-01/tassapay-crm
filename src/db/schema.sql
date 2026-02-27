-- TassaPay CRM – MySQL schema
-- Safe to rerun: uses IF NOT EXISTS / DROP IF EXISTS where needed.

CREATE DATABASE IF NOT EXISTS `tassapay_crm`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `tassapay_crm`;

-- ─── users (CRM agents / admins) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT           NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(255)  NOT NULL,
  `role`          VARCHAR(50)   NOT NULL DEFAULT 'Agent',   -- 'Agent' | 'Admin'
  `email`         VARCHAR(255)  DEFAULT NULL,
  `password_hash` VARCHAR(255)  DEFAULT NULL,
  `is_active`     TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── customers (filtered backoffice data) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS `customers` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `customer_id`          VARCHAR(50)   NOT NULL,                 -- backoffice Customer_ID
  `assigned_user_id`          INT           DEFAULT NULL,             -- FK → users.id
  `kyc_attributed_agent_id`   INT           DEFAULT NULL,             -- FK → users.id (last-touch agent at KYC completion)
  `full_name`                 VARCHAR(255)  DEFAULT NULL,
  `email`                VARCHAR(255)  DEFAULT NULL,
  `phone_number`         VARCHAR(50)   DEFAULT NULL,
  `country`              VARCHAR(100)  DEFAULT NULL,
  `registration_date`    DATETIME      DEFAULT NULL,             -- Record_Insert_DateTime2 parsed
  `kyc_completion_date`  DATETIME      DEFAULT NULL,             -- Record_Insert_DateTime parsed; NULL = KYC not done
  `risk_status`          VARCHAR(50)   DEFAULT NULL,             -- 'Low' | 'High'
  `total_transfers`      INT           NOT NULL DEFAULT 0,
  `synced_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_id` (`customer_id`),
  CONSTRAINT `fk_customers_user`
    FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_customers_kyc_agent`
    FOREIGN KEY (`kyc_attributed_agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_full_name`   (`full_name`),
  INDEX `idx_email`       (`email`),
  INDEX `idx_risk_status` (`risk_status`),
  INDEX `idx_registered`  (`registration_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── interactions (agent activity log) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `interactions` (
  `id`                     INT           NOT NULL AUTO_INCREMENT,
  `customer_id`            VARCHAR(50)   NOT NULL,                  -- FK → customers.customer_id
  `agent_id`               INT           DEFAULT NULL,              -- FK → users.id
  `type`                   VARCHAR(50)   NOT NULL DEFAULT 'System', -- 'Call' | 'Email' | 'Note' | 'System'
  `outcome`                VARCHAR(255)  DEFAULT NULL,
  `note`                   TEXT          DEFAULT NULL,
  `twilio_call_sid`        VARCHAR(64)   DEFAULT NULL,              -- Twilio CallSid (CA...)
  `call_duration_seconds`  INT UNSIGNED  DEFAULT NULL,              -- call length in seconds
  `recording_url`          VARCHAR(500)  DEFAULT NULL,              -- Twilio recording URL
  `created_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  CONSTRAINT `fk_interactions_customer`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_interactions_agent`
    FOREIGN KEY (`agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_interactions_customer` (`customer_id`),
  INDEX `idx_interactions_agent`    (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── sync_log (API pull history) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `sync_log` (
  `id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `started_at`       DATETIME      NOT NULL,
  `finished_at`      DATETIME      DEFAULT NULL,
  `records_fetched`  INT           DEFAULT 0,
  `records_inserted` INT           DEFAULT 0,
  `records_updated`  INT           DEFAULT 0,
  `status`           ENUM('running','success','error') NOT NULL DEFAULT 'running',
  `error_message`    TEXT          DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── templates (canned SMS / Email messages for agents) ─────────────────────

CREATE TABLE IF NOT EXISTS `templates` (
  `id`         INT           NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255)  NOT NULL,
  `channel`    ENUM('SMS', 'Email') NOT NULL,
  `subject`    VARCHAR(255)  DEFAULT NULL,          -- Email only
  `body`       TEXT          NOT NULL,
  `created_at` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_templates_channel` (`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed data (INSERT IGNORE = safe to rerun)
INSERT IGNORE INTO `templates` (`id`, `name`, `channel`, `subject`, `body`) VALUES
(1, 'KYC Reminder (SMS)',        'SMS',   NULL,
 'Hi {{fullName}}, your TassaPay KYC is still pending. Please log in and complete it to unlock money transfers. Thank you!'),
(2, 'First Transfer Promo',      'SMS',   NULL,
 'Hi {{fullName}}, welcome to TassaPay! Send your first transfer today with 0% fees. Visit tassapay.co.uk to get started.'),
(3, 'Zero Transfer Follow-up',   'SMS',   NULL,
 'Hi {{fullName}}, your TassaPay account is active but you haven''t transferred yet. Send money to {{country}} today from tassapay.co.uk.'),
(4, 'KYC Completion Email',      'Email', 'Action Required: Complete Your TassaPay Verification',
 'Dear {{fullName}},\n\nYour KYC verification is still pending on your TassaPay account.\n\nCompleting it takes just a few minutes and unlocks full transfer capabilities.\n\nPlease log in at tassapay.co.uk and navigate to your profile to finish the process.\n\nFor help, contact support@tassapay.co.uk.\n\nBest regards,\nThe TassaPay Team'),
(5, 'Welcome Email',             'Email', 'Welcome to TassaPay, {{fullName}}!',
 'Dear {{fullName}},\n\nWelcome to TassaPay! We are delighted to have you on board.\n\nWith TassaPay, you can send money to {{country}} and over 50 other countries at competitive rates.\n\nTo get started:\n1. Complete your KYC verification\n2. Add a payment method\n3. Send your first transfer\n\nLog in at tassapay.co.uk to begin.\n\nBest regards,\nThe TassaPay Team');

CREATE TABLE IF NOT EXISTS `customers` (
  `customer_id`             VARCHAR(20)   NOT NULL,

  -- Identity
  `full_name`               VARCHAR(255)  DEFAULT NULL,
  `date_of_birth`           VARCHAR(20)   DEFAULT NULL,   -- stored as received (dd/MM/yyyy)
  `gender`                  VARCHAR(20)   DEFAULT NULL,
  `email`                   VARCHAR(255)  DEFAULT NULL,
  `mobile_number`           VARCHAR(50)   DEFAULT NULL,
  `phone_number`            VARCHAR(50)   DEFAULT NULL,
  `address`                 TEXT          DEFAULT NULL,
  `sender_country`          VARCHAR(100)  DEFAULT NULL,

  -- Backoffice references
  `wire_transfer_ref`       VARCHAR(100)  DEFAULT NULL,
  `file_reference`          VARCHAR(50)   DEFAULT NULL,
  `branch_name`             VARCHAR(100)  DEFAULT NULL,
  `user_name`               VARCHAR(100)  DEFAULT NULL,
  `assigned_user_id`        VARCHAR(20)   DEFAULT NULL,
  `referred_by`             VARCHAR(20)   DEFAULT NULL,
  `referred_by_agent`       VARCHAR(20)   DEFAULT NULL,

  -- KYC / compliance
  `risk_status`             VARCHAR(20)   DEFAULT NULL,   -- 'Low' | 'High'
  `total_risk_score`        SMALLINT      DEFAULT NULL,
  `id_verification_status`  VARCHAR(10)   DEFAULT NULL,   -- matches api id_verification_status
  `blacklisted_flag`        TINYINT(1)    DEFAULT 0,
  `delete_status`           TINYINT(1)    DEFAULT 0,
  `block_login_flag`        TINYINT(1)    DEFAULT 0,
  `is_suspicious`           VARCHAR(10)   DEFAULT NULL,
  `is_suspicious1`          VARCHAR(10)   DEFAULT NULL,
  `amlsan`                  TEXT          DEFAULT NULL,
  `adverse_media_flag`      VARCHAR(10)   DEFAULT NULL,
  `watchlist_flag`          TINYINT(1)    DEFAULT NULL,
  `reason_for_watchlist`    TEXT          DEFAULT NULL,
  `sanction_alert_status`   VARCHAR(10)   DEFAULT NULL,
  `third_party_check`       VARCHAR(10)   DEFAULT NULL,
  `security_flag`           VARCHAR(10)   DEFAULT NULL,
  `name_match_flag`         VARCHAR(50)   DEFAULT NULL,

  -- Digital ID checks
  `front_result`            VARCHAR(50)   DEFAULT NULL,
  `liveness_result`         VARCHAR(50)   DEFAULT NULL,
  `face_match_result`       VARCHAR(50)   DEFAULT NULL,
  `verified_count`          SMALLINT      DEFAULT NULL,

  -- Address validation
  `chk_postcode`            TINYINT(1)    DEFAULT NULL,
  `chk_mobile`              VARCHAR(50)   DEFAULT NULL,

  -- Dates
  `registered_date`         VARCHAR(30)   DEFAULT NULL,   -- Record_Insert_DateTime1 (dd/MM/yyyy)
  `registered_datetime`     VARCHAR(30)   DEFAULT NULL,   -- Record_Insert_DateTime2 (dd/MM/yyyy HH:mm:ss)

  -- Sync metadata
  `synced_at`               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`customer_id`),
  INDEX `idx_full_name`     (`full_name`),
  INDEX `idx_email`         (`email`),
  INDEX `idx_mobile`        (`mobile_number`),
  INDEX `idx_risk_status`   (`risk_status`),
  INDEX `idx_registered`    (`registered_date`),
  INDEX `idx_blacklisted`   (`blacklisted_flag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── transfers (money movement records from TassaPay) ────────────────────────

CREATE TABLE IF NOT EXISTS `transfers` (
  `id`                  INT            NOT NULL AUTO_INCREMENT,
  `customer_id`         VARCHAR(50)    NOT NULL,                 -- soft-ref → customers.customer_id (numeric Customer_ID from API)
  `transaction_ref`     VARCHAR(50)    NOT NULL,                 -- ReferenceNo e.g. 'TXN23103690'
  `created_at`          DATETIME       DEFAULT NULL,             -- Date1 (DD/MM/YYYY HH:mm:ss → parsed)
  `send_amount`         DECIMAL(10,2)  DEFAULT NULL,             -- Totalamount
  `send_currency`       VARCHAR(10)    DEFAULT NULL,             -- FromCurrency_Code
  `receive_amount`      DECIMAL(10,2)  DEFAULT NULL,             -- Amount_in_other_cur
  `receive_currency`    VARCHAR(10)    DEFAULT NULL,             -- Currency_Code
  `destination_country` VARCHAR(100)   DEFAULT NULL,             -- Country_Name
  `beneficiary_name`    VARCHAR(255)   DEFAULT NULL,             -- Reciever
  `status`              VARCHAR(50)    DEFAULT NULL,             -- Tx_Status ('Hold', 'Completed', etc.)
  `hold_reason`         TEXT           DEFAULT NULL,             -- LatestCust_Comment (HTML stripped)
  `payment_method`      VARCHAR(100)   DEFAULT NULL,             -- Ptype
  `delivery_method`     VARCHAR(100)   DEFAULT NULL,             -- Type_Name
  `attributed_agent_id` INT            DEFAULT NULL,             -- FK → users.id (last-touch agent at first transfer)
  `data_field_id`       VARCHAR(50)    DEFAULT NULL,             -- rmtNo from DataField / TayoTransfer provider
  `data_field_status`   VARCHAR(50)    DEFAULT NULL,             -- Status from TayoTransfer (e.g. 'Ready', 'Cancel')
  `payment_status`      VARCHAR(50)    DEFAULT NULL,             -- paymentReceived_Name from backoffice (e.g. 'Received')
  `sla_alert_sent_at`   DATETIME       DEFAULT NULL,             -- set when SLA breach alert is fired (spam lock)
  `synced_at`           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_transaction_ref` (`transaction_ref`),
  INDEX `idx_transfers_customer` (`customer_id`),
  INDEX `idx_transfers_status`   (`status`),
  INDEX `idx_transfers_date`     (`created_at`),
  CONSTRAINT `fk_transfers_attributed_agent`
    FOREIGN KEY (`attributed_agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sync run log: records each pull from the TassaPay API
CREATE TABLE IF NOT EXISTS `sync_log` (
  `id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `started_at`    DATETIME      NOT NULL,
  `type`          VARCHAR(50)   DEFAULT NULL,              -- 'customers' | 'transfers'
  `finished_at`   DATETIME      DEFAULT NULL,
  `records_fetched` INT         DEFAULT 0,
  `records_inserted` INT        DEFAULT 0,
  `records_updated`  INT        DEFAULT 0,
  `status`        ENUM('running','success','error') NOT NULL DEFAULT 'running',
  `error_message` TEXT          DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Migrations (run once on existing installs) ───────────────────────────────
-- New installs from this schema get the columns automatically via the CREATE TABLE
-- statements above. For existing databases, run the two ALTERs below once:
--
-- ALTER TABLE `transfers`
--   ADD COLUMN `attributed_agent_id` INT DEFAULT NULL AFTER `delivery_method`,
--   ADD CONSTRAINT `fk_transfers_attributed_agent`
--     FOREIGN KEY (`attributed_agent_id`) REFERENCES `users` (`id`)
--     ON DELETE SET NULL ON UPDATE CASCADE;
--
-- ALTER TABLE `customers`
--   ADD COLUMN `kyc_attributed_agent_id` INT DEFAULT NULL AFTER `assigned_user_id`,
--   ADD CONSTRAINT `fk_customers_kyc_agent`
--     FOREIGN KEY (`kyc_attributed_agent_id`) REFERENCES `users` (`id`)
--     ON DELETE SET NULL ON UPDATE CASCADE;
--
-- ALTER TABLE `transfers`
--   ADD COLUMN `data_field_id` VARCHAR(50) DEFAULT NULL AFTER `attributed_agent_id`;
--
-- ALTER TABLE `transfers`
--   ADD COLUMN `sla_alert_sent_at` DATETIME DEFAULT NULL AFTER `data_field_id`;
--
-- ALTER TABLE `transfers`
--   ADD COLUMN `data_field_status` VARCHAR(50) DEFAULT NULL AFTER `data_field_id`;
--
-- ALTER TABLE `transfers`
--   ADD COLUMN `payment_status` VARCHAR(50) DEFAULT NULL AFTER `data_field_status`;

-- ─── alert_routings (SLA breach notification rules) ──────────────────────────

CREATE TABLE IF NOT EXISTS `alert_routings` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `destination_country`  VARCHAR(100)  NOT NULL DEFAULT 'Somalia',
  `source_currency`      VARCHAR(10)   NOT NULL,               -- 'GBP' | 'EUR' | 'USD' etc.
  `alert_emails`         TEXT          DEFAULT NULL,           -- comma-separated emails
  `alert_phones`         TEXT          DEFAULT NULL,           -- comma-separated E.164 phone numbers
  `is_active`            TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_alert_routing` (`destination_country`, `source_currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
