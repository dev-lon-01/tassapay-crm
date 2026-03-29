-- TassaPay CRM â€“ MySQL schema
-- Safe to rerun: uses IF NOT EXISTS / DROP IF EXISTS where needed.

CREATE DATABASE IF NOT EXISTS `tassapay_crm`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `tassapay_crm`;

-- â”€â”€â”€ users (CRM agents / admins) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT           NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(255)  NOT NULL,
  `role`          VARCHAR(50)   NOT NULL DEFAULT 'Agent',   -- 'Agent' | 'Admin'
  `email`         VARCHAR(255)  DEFAULT NULL,
  `password_hash` VARCHAR(255)  DEFAULT NULL,
  `is_active`          TINYINT(1)    NOT NULL DEFAULT 1,
  `voice_available`    TINYINT(1)    NOT NULL DEFAULT 0,
  `voice_last_seen_at` DATETIME      DEFAULT NULL,
  `sip_username`       VARCHAR(100)  DEFAULT NULL,                       -- Twilio SIP domain username (e.g. abdi)
  `allowed_regions`    JSON          NOT NULL DEFAULT ('["UK","EU"]'),   -- e.g. ["UK","EU"]
  `can_view_dashboard` TINYINT(1)    NOT NULL DEFAULT 0,                 -- grants Agent access to Manager Dashboard
  `created_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- â”€â”€â”€ customers (filtered backoffice data) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `customers` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `customer_id`          VARCHAR(50)   NOT NULL,                 -- backoffice Customer_ID
  `assigned_user_id`          INT           DEFAULT NULL,             -- FK â†’ users.id
  `kyc_attributed_agent_id`   INT           DEFAULT NULL,             -- FK â†’ users.id (last-touch agent at KYC completion)
  `full_name`                 VARCHAR(255)  DEFAULT NULL,
  `email`                VARCHAR(255)  DEFAULT NULL,
  `phone_number`         VARCHAR(50)   DEFAULT NULL,
  `phone_normalized`     VARCHAR(32)   DEFAULT NULL,
  `phone_last9`          VARCHAR(9)    DEFAULT NULL,
  `country`              VARCHAR(100)  DEFAULT NULL,
  `registration_date`    DATETIME      DEFAULT NULL,             -- Record_Insert_DateTime2 parsed
  `kyc_completion_date`  DATETIME      DEFAULT NULL,             -- Record_Insert_DateTime parsed; NULL = KYC not done
  `risk_status`          VARCHAR(50)   DEFAULT NULL,             -- 'Low' | 'High'
  `total_transfers`      INT           NOT NULL DEFAULT 0,
  `synced_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Lead pipeline fields
  `is_lead`              TINYINT(1)    NOT NULL DEFAULT 0,            -- 1 = prospect; 0 = full customer
  `lead_stage`           ENUM('New','Contacted','Follow-up','Converted','Dead') DEFAULT NULL,
  `assigned_agent_id`    INT           DEFAULT NULL,                  -- FK â†’ users.id
  `labels`               JSON          DEFAULT NULL,                  -- e.g. ["VIP","facebook_ad"]

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_id` (`customer_id`),
  CONSTRAINT `fk_customers_user`
    FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_customers_kyc_agent`
    FOREIGN KEY (`kyc_attributed_agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_customers_assigned_agent`
    FOREIGN KEY (`assigned_agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_full_name`         (`full_name`),
  INDEX `idx_email`             (`email`),
  INDEX `idx_phone_normalized`  (`phone_normalized`),
  INDEX `idx_phone_last9`       (`phone_last9`),
  INDEX `idx_risk_status`       (`risk_status`),
  INDEX `idx_registered`  (`registration_date`),
  INDEX `idx_is_lead`      (`is_lead`),
  INDEX `idx_lead_stage`   (`lead_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- â”€â”€â”€ interactions (agent activity log) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `interactions` (
  `id`                     INT           NOT NULL AUTO_INCREMENT,
  `customer_id`            VARCHAR(50)   NULL,                       -- FK â†’ customers.customer_id (nullable: unknown callers still logged)
  `agent_id`               INT           DEFAULT NULL,              -- FK â†’ users.id
  `type`                   VARCHAR(50)   NOT NULL DEFAULT 'System', -- 'Call' | 'Email' | 'Note' | 'System'
  `outcome`                VARCHAR(255)  DEFAULT NULL,
  `note`                   TEXT          DEFAULT NULL,
  `direction`              VARCHAR(20)   DEFAULT NULL,              -- 'inbound' | 'outbound'
  `metadata`               JSON          DEFAULT NULL,              -- channel-specific data e.g. {"from":"+447..."}
  `twilio_call_sid`        VARCHAR(64)   DEFAULT NULL,              -- Twilio CallSid (CA...)
  `call_duration_seconds`  INT UNSIGNED  DEFAULT NULL,              -- call length in seconds
  `recording_url`          VARCHAR(500)  DEFAULT NULL,              -- Twilio recording URL
  `call_status`            VARCHAR(50)   DEFAULT NULL,
  `request_id`             VARCHAR(64)   DEFAULT NULL,
  `provider_message_id`    VARCHAR(128)  DEFAULT NULL,
  `created_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  CONSTRAINT `fk_interactions_customer`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_interactions_agent`
    FOREIGN KEY (`agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_interactions_customer` (`customer_id`),
  INDEX `idx_interactions_agent`    (`agent_id`),
  INDEX `idx_interactions_call_status` (`call_status`),
  UNIQUE KEY `uq_interactions_call_sid` (`twilio_call_sid`),
  UNIQUE KEY `uq_interactions_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voice_webhook_events` (
  `id`               BIGINT        NOT NULL AUTO_INCREMENT,
  `source`           VARCHAR(50)   NOT NULL,
  `canonical_sid`    VARCHAR(64)   DEFAULT NULL,
  `event_type`       VARCHAR(50)   DEFAULT NULL,
  `payload`          JSON          NOT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_voice_webhook_events_sid` (`canonical_sid`),
  INDEX `idx_voice_webhook_events_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- â”€â”€â”€ sync_log (API pull history) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


-- â”€â”€â”€ templates (canned SMS / Email messages for agents) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
 'Dear {{fullName}},\n\nWelcome to TassaPay! We are delighted to have you on board.\n\nWith TassaPay, you can send money to {{country}} and over 50 other countries at competitive rates.\n\nTo get started:\n1. Complete your KYC verification\n2. Add a payment method\n3. Send your first transfer\n\nLog in at tassapay.co.uk to begin.\n\nBest regards,\nThe TassaPay Team'),
(6, 'Beneficiary Information Update Required', 'Email',
 'Action Required: Update to your TassaPay Transfer [Transfer ID]',
 'Dear {{fullName}},\n\nWe are reaching out regarding your recent transfer ([Transfer ID] for [Amount]). Unfortunately, we have encountered an issue with the beneficiary details provided, and the receiving bank/mobile provider has temporarily halted the transaction.\n\nTo ensure your funds are delivered quickly, please reply to this email or call our support team to confirm the correct recipient Name, Account Number, and Phone Number.\n\nThank you,\nThe TassaPay Team'),
(7, 'Beneficiary Issue - App Push', 'Email',
 'Action Required: Update to your recent TassaPay Transfer',
 'Dear {{customerName}},\n\nWe are reaching out regarding your recent transfer. Unfortunately, we have encountered an issue with the beneficiary details provided, and the receiving provider has temporarily halted the transaction.\n\nTo ensure your funds are delivered as quickly as possible, please verify and update the recipient''s name, account number, or phone number directly in our app.\n\n<a href="http://lnkz.app/feay">Tap here to open the TassaPay app and resolve this issue.</a>\n\nFor further information, <a href="https://api.whatsapp.com/send?phone=%20+447836%20695516&text=Hello%20There,%20I%20would%20like%20to%20enquire%20about%20money%20transfer.">contact us on WhatsApp</a>.\n\nThank you,\n\nThe TassaPay Team'),
(8, 'Lead Follow-Up - New Prospect', 'Email',
 'Welcome to TassaPay! Send money securely today.',
 'Hi {{customerName}},\n\nThank you for your interest in TassaPay! We offer some of the most competitive exchange rates and fastest delivery times on the market.\n\nTo see today''s live rates and track your transfers in real-time, the best way to get started is by downloading our mobile app. You can set up your account and send money in just a few minutes.\n\n<a href="http://lnkz.app/feay">Tap here to get the app and make your first transfer.</a>\n\nFor further information, <a href="https://api.whatsapp.com/send?phone=%20+447836%20695516&text=Hello%20There,%20I%20would%20like%20to%20enquire%20about%20money%20transfer.">contact us on WhatsApp</a>.\n\nBest,\n\nThe TassaPay Team'),
(9, 'Customer Onboarding - Welcome', 'Email',
 'Welcome to TassaPay, {{customerName}}! Let''s get started.',
 'Dear {{customerName}},\n\nWelcome to TassaPay! Your account is now fully active.\n\nMaking your first secure, fast, and low-cost money transfer is just a tap away. With our app, you can save your favourite recipients, track your money in real-time, and access exclusive exchange rates.\n\n<a href="http://lnkz.app/feay">Open the app now to send your first transfer.</a>\n\nFor further information, <a href="https://api.whatsapp.com/send?phone=%20+447836%20695516&text=Hello%20There,%20I%20would%20like%20to%20enquire%20about%20money%20transfer.">contact us on WhatsApp</a>.\n\nThank you for choosing TassaPay.\n\nThe TassaPay Team'),
(10, 'Promo - Zero Fees', 'Email',
 'Enjoy ZERO Fees on Your Next Transfer! ðŸš€',
 'Hi {{customerName}},\n\nGreat news! For a limited time, we are offering absolutely ZERO FEES on your next money transfer.\n\nWhether you are sending money to family or paying for business, you keep more of your money with TassaPay. Don''t miss out on this offerâ€”it gets applied automatically when you use the app.\n\n<a href="http://lnkz.app/feay">Tap here to open the app and claim your fee-free transfer today.</a>\n\nFor further information, <a href="https://api.whatsapp.com/send?phone=%20+447836%20695516&text=Hello%20There,%20I%20would%20like%20to%20enquire%20about%20money%20transfer.">contact us on WhatsApp</a>.\n\nBest,\n\nThe TassaPay Team');

CREATE TABLE IF NOT EXISTS `customers` (
  `customer_id`             VARCHAR(20)   NOT NULL,

  -- Identity
  `full_name`               VARCHAR(255)  DEFAULT NULL,
  `date_of_birth`           VARCHAR(20)   DEFAULT NULL,   -- stored as received (dd/MM/yyyy)
  `gender`                  VARCHAR(20)   DEFAULT NULL,
  `email`                   VARCHAR(255)  DEFAULT NULL,
  `mobile_number`           VARCHAR(50)   DEFAULT NULL,
  `phone_number`            VARCHAR(50)   DEFAULT NULL,
  `phone_normalized`     VARCHAR(32)   DEFAULT NULL,
  `phone_last9`          VARCHAR(9)    DEFAULT NULL,
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

-- â”€â”€â”€ transfers (money movement records from TassaPay) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `transfers` (
  `id`                  INT            NOT NULL AUTO_INCREMENT,
  `customer_id`         VARCHAR(50)    NOT NULL,                 -- soft-ref â†’ customers.customer_id (numeric Customer_ID from API)
  `transaction_ref`     VARCHAR(50)    NOT NULL,                 -- ReferenceNo e.g. 'TXN23103690'
  `created_at`          DATETIME       DEFAULT NULL,             -- Date1 (DD/MM/YYYY HH:mm:ss â†’ parsed)
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
  `attributed_agent_id` INT            DEFAULT NULL,             -- FK â†’ users.id (last-touch agent at first transfer)
  `data_field_id`       VARCHAR(50)    DEFAULT NULL,             -- rmtNo from DataField / TayoTransfer provider
  `data_field_status`   VARCHAR(50)    DEFAULT NULL,             -- Status from TayoTransfer (e.g. 'Ready', 'Cancel')
  `payment_status`      VARCHAR(50)    DEFAULT NULL,             -- paymentReceived_Name from backoffice (e.g. 'Received')
  `tayo_date_paid`      DATETIME       DEFAULT NULL,             -- Datepaid from Tayo API (funds released timestamp)
  `sla_alert_sent_at`   DATETIME       DEFAULT NULL,             -- set when SLA breach alert is fired (spam lock)
  `primary_payment_id`  INT            DEFAULT NULL,             -- FK → payments.id (matched gateway row)
  `reconciliation_status` ENUM('pending','matched','mismatch','manual_adjustment') DEFAULT 'pending',
  `accounting_category` ENUM('remittance','operational_expense','rounding_difference','suspense') DEFAULT NULL,
  `manual_adjustment_note` TEXT         DEFAULT NULL,
  `synced_at`           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_transaction_ref` (`transaction_ref`),
  INDEX `idx_transfers_customer`      (`customer_id`),
  INDEX `idx_transfers_status`        (`status`),
  INDEX `idx_transfers_date`          (`created_at`),
  INDEX `idx_transfers_data_field_id` (`data_field_id`),
  INDEX `idx_transfers_recon_status`  (`reconciliation_status`),
  CONSTRAINT `fk_transfers_attributed_agent`
    FOREIGN KEY (`attributed_agent_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_primary_payment`
    FOREIGN KEY (`primary_payment_id`) REFERENCES `payments` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- â”€â”€â”€ payments (gateway reconciliation imports) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `payments` (
  `id`                  INT            NOT NULL AUTO_INCREMENT,
  `provider`            VARCHAR(50)    NOT NULL,                 -- volume | emerchantpay | paycross
  `provider_payment_id` VARCHAR(191)   NOT NULL,                 -- unique gateway-side transaction / refund id
  `transfer_ref`        VARCHAR(50)    DEFAULT NULL,             -- matches transfers.transaction_ref where possible
  `payment_type`        VARCHAR(50)    NOT NULL DEFAULT 'payment', -- payment | refund
  `payment_method`      VARCHAR(100)   DEFAULT NULL,             -- card, bank transfer, wallet, etc.
  `amount`              DECIMAL(12,2)  DEFAULT NULL,
  `currency`            VARCHAR(10)    DEFAULT NULL,
  `status`              VARCHAR(20)    NOT NULL,                 -- success | failed | refunded
  `provider_status`     VARCHAR(100)   DEFAULT NULL,             -- raw provider-native status
  `payment_date`        DATETIME       DEFAULT NULL,
  `raw_data`            JSON           DEFAULT NULL,
  `is_reconciled`       BOOLEAN        DEFAULT FALSE,
  `reconciliation_note` VARCHAR(255)   DEFAULT NULL,             -- e.g. 'Orphan: Transfer ID not found' | 'Amount Mismatch'
  `created_at`          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_payment_id` (`provider_payment_id`),
  INDEX `idx_payments_transfer_ref` (`transfer_ref`),
  INDEX `idx_payments_provider` (`provider`),
  INDEX `idx_payments_payment_date` (`payment_date`),
  INDEX `idx_payments_status` (`status`),
  INDEX `idx_payments_reconciled` (`is_reconciled`)
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
-- â"€â"€â"€ commissions (agent commission tracking with maker-checker workflow) â"€â"€â"€â"€â"€â"€

CREATE TABLE IF NOT EXISTS `commissions` (
  `id`                  INT            NOT NULL AUTO_INCREMENT,
  `agent_id`            INT            NOT NULL,                   -- FK â†' users.id
  `customer_id`         VARCHAR(50)    NOT NULL,                   -- FK â†' customers.customer_id
  `transfer_id`         INT            NOT NULL,                   -- FK â†' transfers.id (the first non-Failed transfer)
  `commission_amount`   DECIMAL(10,2)  NOT NULL,                   -- calculated payout amount
  `currency`            VARCHAR(10)    NOT NULL DEFAULT 'GBP',
  `status`              ENUM('pending_approval','approved','rejected','paid','cancelled')
                                       NOT NULL DEFAULT 'pending_approval',
  `approved_by`         INT            DEFAULT NULL,               -- FK â†' users.id (Admin who approved)
  `approved_at`         DATETIME       DEFAULT NULL,
  `paid_by`             INT            DEFAULT NULL,               -- FK â†' users.id (Finance user who marked paid)
  `paid_at`             DATETIME       DEFAULT NULL,
  `rejection_reason`    VARCHAR(500)   DEFAULT NULL,
  `cancellation_reason` VARCHAR(500)   DEFAULT NULL,
  `cancelled_at`        DATETIME       DEFAULT NULL,
  `created_at`          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commission_transfer` (`transfer_id`),            -- one commission per transfer (idempotency gate)
  INDEX `idx_commissions_agent`    (`agent_id`),
  INDEX `idx_commissions_status`   (`status`),
  INDEX `idx_commissions_customer` (`customer_id`),

  CONSTRAINT `fk_commissions_agent`
    FOREIGN KEY (`agent_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_commissions_transfer`
    FOREIGN KEY (`transfer_id`) REFERENCES `transfers` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_commissions_approved_by`
    FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_commissions_paid_by`
    FOREIGN KEY (`paid_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- â”€â”€â”€ Migrations (run once on existing installs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€ alert_routings (SLA breach notification rules) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `alert_routings` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `destination_country`  VARCHAR(100)  NOT NULL DEFAULT 'Somalia',
  `source_currency`      VARCHAR(10)   NOT NULL,               -- 'GBP' | 'EUR' | 'USD' etc.
  `alert_emails`         TEXT          DEFAULT NULL,           -- comma-separated emails
  `alert_phones`         TEXT          DEFAULT NULL,           -- comma-separated E.164 phone numbers
  `pushover_sound`       VARCHAR(50)   NOT NULL DEFAULT 'pushover',
  `pushover_priority`    INT           NOT NULL DEFAULT 0,
  `pushover_enabled`     TINYINT(1)    NOT NULL DEFAULT 1,
  `is_active`            TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_alert_routing` (`destination_country`, `source_currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- â”€â”€â”€ system_dropdowns (configurable outcome lists) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS `system_dropdowns` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `category`    VARCHAR(50)   NOT NULL,
  `label`       VARCHAR(100)  NOT NULL,
  `sort_order`  INT           NOT NULL DEFAULT 0,
  `is_active`   TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dropdown` (`category`, `label`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- automation_rules (configurable nudge / workflow rules) -------------------

CREATE TABLE IF NOT EXISTS `automation_rules` (
  `id`                INT           NOT NULL AUTO_INCREMENT,
  `rule_name`         VARCHAR(255)  NOT NULL,
  `trigger_key`       VARCHAR(100)  NOT NULL UNIQUE,
  `delay_hours`       INT           NOT NULL,
  `is_active`         BOOLEAN       DEFAULT FALSE,
  `email_subject`     VARCHAR(255)  NOT NULL,
  `email_template_id` VARCHAR(100)  NOT NULL,
  `updated_at`        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `automation_rules`
  (`rule_name`, `trigger_key`, `delay_hours`, `is_active`, `email_subject`, `email_template_id`)
VALUES
  ('72-Hour First Transfer Nudge', 'NUDGE_FIRST_TRANSFER', 72, FALSE,
   'Your first transfer is free!', 'first-transfer-nudge');

-- --- communications_log (prevents double-sending per customer/rule) -----------

CREATE TABLE IF NOT EXISTS `communications_log` (
  `id`           VARCHAR(36)   PRIMARY KEY,
  `customer_id`  INT           NOT NULL,
  `rule_id`      INT           NOT NULL,
  `sent_at`      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)        ON DELETE CASCADE,
  FOREIGN KEY (`rule_id`)     REFERENCES `automation_rules` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_customer_rule` (`customer_id`, `rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
