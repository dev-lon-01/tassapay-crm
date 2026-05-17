-- 2026-05-17: ID documents pulled from TassaPay backoffice
-- (CustomerHandler.ashx?Task=IDdocuments_bind_grid).

CREATE TABLE IF NOT EXISTS customer_id_documents (
  id                          INT NOT NULL AUTO_INCREMENT,
  sender_id_id                VARCHAR(50)  NOT NULL,
  customer_id                 VARCHAR(50)  NOT NULL,
  id_type                     VARCHAR(100) DEFAULT NULL,
  id_name                     VARCHAR(100) DEFAULT NULL,
  id_number                   VARCHAR(100) DEFAULT NULL,
  sender_name_on_id           VARCHAR(255) DEFAULT NULL,
  place_of_issue              VARCHAR(50)  DEFAULT NULL,
  issue_date                  DATE         DEFAULT NULL,
  expiry_date                 DATETIME     DEFAULT NULL,
  dob                         DATETIME     DEFAULT NULL,
  front_image_path            VARCHAR(500) DEFAULT NULL,
  back_image_path             VARCHAR(500) DEFAULT NULL,
  pdf_path                    VARCHAR(500) DEFAULT NULL,
  mrz_number                  VARCHAR(100) DEFAULT NULL,
  journey_id                  VARCHAR(100) DEFAULT NULL,
  is_legacy                   TINYINT(1) NOT NULL DEFAULT 0,
  verified                    TINYINT(1) NOT NULL DEFAULT 0,
  verified_by                 VARCHAR(100) DEFAULT NULL,
  verified_date               DATETIME     DEFAULT NULL,
  comments                    TEXT         DEFAULT NULL,
  source_inserted_at          DATETIME     DEFAULT NULL,
  synced_at                   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sender_id_id (sender_id_id),
  KEY idx_customer_id (customer_id),
  KEY idx_journey (journey_id),
  CONSTRAINT fk_idd_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
