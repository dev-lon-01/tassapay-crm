/**
 * migrate-tasks.mjs
 *
 * Creates the `tasks` and `task_comments` tables required for the
 * Task Management & Agent Action Logs module.
 *
 * Safe to re-run — guarded by information_schema checks.
 *
 * Usage:
 *   node scripts/migrate-tasks.mjs
 */

import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const conn = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
});

async function tableExists(table) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?`,
    [table]
  );
  return row.cnt > 0;
}

async function columnExists(table, column) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND COLUMN_NAME  = ?`,
    [table, column]
  );
  return row.cnt > 0;
}

async function indexExists(table, idx) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND INDEX_NAME   = ?`,
    [table, idx]
  );
  return row.cnt > 0;
}

try {
  // ── 1. tasks ────────────────────────────────────────────────────────────────
  if (!(await tableExists("tasks"))) {
    await conn.execute(`
      CREATE TABLE \`tasks\` (
        \`id\`                INT           NOT NULL AUTO_INCREMENT,
        \`customer_id\`       VARCHAR(50)   NOT NULL,
        \`title\`             VARCHAR(255)  NOT NULL,
        \`description\`       TEXT          DEFAULT NULL,
        \`category\`          ENUM('Query','Action','KYC','Payment_Issue') NOT NULL DEFAULT 'Query',
        \`priority\`          ENUM('Low','Medium','High','Urgent')          NOT NULL DEFAULT 'Medium',
        \`status\`            ENUM('Open','In_Progress','Pending','Closed') NOT NULL DEFAULT 'Open',
        \`assigned_agent_id\` INT           DEFAULT NULL,
        \`created_by\`        INT           NOT NULL,
        \`created_at\`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_tasks_customer\`
          FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`customer_id\`)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_tasks_assigned_agent\`
          FOREIGN KEY (\`assigned_agent_id\`) REFERENCES \`users\` (\`id\`)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_tasks_created_by\`
          FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX \`idx_tasks_customer\`       (\`customer_id\`),
        INDEX \`idx_tasks_assigned_agent\` (\`assigned_agent_id\`),
        INDEX \`idx_tasks_status\`         (\`status\`),
        INDEX \`idx_tasks_priority\`       (\`priority\`),
        INDEX \`idx_tasks_created_at\`     (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ tasks table created");
  } else {
    console.log("  tasks table already exists");
  }

  // ── 1b. Add transfer_reference column if missing ────────────────────────────
  if (!(await columnExists("tasks", "transfer_reference"))) {
    await conn.execute(`
      ALTER TABLE \`tasks\`
        ADD COLUMN \`transfer_reference\` VARCHAR(255) DEFAULT NULL AFTER \`customer_id\`
    `);
    console.log("✓ tasks.transfer_reference column added");
  } else {
    console.log("  tasks.transfer_reference already exists");
  }

  // ── 2. task_comments ────────────────────────────────────────────────────────
  if (!(await tableExists("task_comments"))) {
    await conn.execute(`
      CREATE TABLE \`task_comments\` (
        \`id\`         INT       NOT NULL AUTO_INCREMENT,
        \`task_id\`    INT       NOT NULL,
        \`agent_id\`   INT       NOT NULL,
        \`comment\`    TEXT      NOT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_task_comments_task\`
          FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\` (\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_task_comments_agent\`
          FOREIGN KEY (\`agent_id\`) REFERENCES \`users\` (\`id\`)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX \`idx_task_comments_task\`  (\`task_id\`),
        INDEX \`idx_task_comments_agent\` (\`agent_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✓ task_comments table created");
  } else {
    console.log("  task_comments table already exists");
  }

  // ── 3. Verify indexes ───────────────────────────────────────────────────────
  const checks = [
    ["tasks",         "idx_tasks_status"],
    ["tasks",         "idx_tasks_customer"],
    ["task_comments", "idx_task_comments_task"],
  ];
  for (const [tbl, idx] of checks) {
    if (await indexExists(tbl, idx)) {
      console.log(`✓ index ${tbl}.${idx} present`);
    } else {
      console.warn(`⚠ index ${tbl}.${idx} NOT found — schema may be out of date`);
    }
  }

  console.log("\n── MIGRATION COMPLETE ──");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exit(1);
} finally {
  await conn.end();
}
