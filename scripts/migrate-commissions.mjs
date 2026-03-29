/**
 * migrate-commissions.mjs
 *
 * Creates the commissions table for the maker-checker commission workflow.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   node scripts/migrate-commissions.mjs
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const conn = await createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

console.log("▶  Creating commissions table …");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS commissions (
    id                  INT            NOT NULL AUTO_INCREMENT,
    agent_id            INT            NOT NULL,
    customer_id         VARCHAR(50)    NOT NULL,
    transfer_id         INT            NOT NULL,
    commission_amount   DECIMAL(10,2)  NOT NULL,
    currency            VARCHAR(10)    NOT NULL DEFAULT 'GBP',
    status              ENUM('pending_approval','approved','rejected','paid')
                                       NOT NULL DEFAULT 'pending_approval',
    approved_by         INT            DEFAULT NULL,
    approved_at         DATETIME       DEFAULT NULL,
    paid_by             INT            DEFAULT NULL,
    paid_at             DATETIME       DEFAULT NULL,
    rejection_reason    VARCHAR(500)   DEFAULT NULL,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_commission_transfer (transfer_id),
    INDEX idx_commissions_agent    (agent_id),
    INDEX idx_commissions_status   (status),
    INDEX idx_commissions_customer (customer_id),

    CONSTRAINT fk_commissions_agent
      FOREIGN KEY (agent_id) REFERENCES users (id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_commissions_transfer
      FOREIGN KEY (transfer_id) REFERENCES transfers (id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_commissions_approved_by
      FOREIGN KEY (approved_by) REFERENCES users (id)
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_commissions_paid_by
      FOREIGN KEY (paid_by) REFERENCES users (id)
      ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
console.log("✔  commissions table ready");

await conn.end();
console.log("✔  Done.");
