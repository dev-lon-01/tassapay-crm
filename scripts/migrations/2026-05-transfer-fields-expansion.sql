-- 2026-05-17: Expanded transfer-sync fields from TassaPay backoffice.

ALTER TABLE transfers
  ADD COLUMN sender_name              VARCHAR(255)   DEFAULT NULL COMMENT 'Sender from TassaPay',
  ADD COLUMN email_id                 VARCHAR(255)   DEFAULT NULL COMMENT 'Email_ID at transfer time',
  ADD COLUMN purpose                  VARCHAR(255)   DEFAULT NULL,
  ADD COLUMN transfer_fees            DECIMAL(10,2)  DEFAULT NULL,
  ADD COLUMN amount_in_gbp            DECIMAL(10,2)  DEFAULT NULL,
  ADD COLUMN exchange_rate            DECIMAL(14,4)  DEFAULT NULL,
  ADD COLUMN branch                   VARCHAR(100)   DEFAULT NULL,
  ADD COLUMN delivery_type            VARCHAR(100)   DEFAULT NULL,
  ADD COLUMN api_branch_details       VARCHAR(255)   DEFAULT NULL,
  ADD COLUMN beneficiary_id           VARCHAR(50)    DEFAULT NULL,
  ADD COLUMN beneficiary_mobile       VARCHAR(50)    DEFAULT NULL,
  ADD COLUMN benf_account_holder_name VARCHAR(255)   DEFAULT NULL,
  ADD COLUMN benf_account_number      VARCHAR(100)   DEFAULT NULL,
  ADD COLUMN benf_bank_name           VARCHAR(255)   DEFAULT NULL,
  ADD COLUMN benf_street              VARCHAR(255)   DEFAULT NULL;
