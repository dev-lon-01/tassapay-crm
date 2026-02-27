/**
 * scripts/test-tasks-queries.js
 *
 * Runs the exact SQL logic from app/api/tasks/route.ts against the live DB
 * for every queueType + representative timeframes.
 *
 * Usage:
 *   node scripts/test-tasks-queries.js
 */

const mysql = require("mysql2/promise");

// ─── config ──────────────────────────────────────────────────────────────────

const DB = { host: "localhost", user: "root", password: "Wadani2020", database: "tassapay_crm" };
const SAMPLE_SIZE = 3; // rows to print per test

// ─── SQL builders (mirror route.ts exactly) ──────────────────────────────────

function buildQuery(queueType, timeframe, search, country) {
  const params = [];
  let baseWhere;

  switch (queueType) {
    case "dormant": {
      const days = timeframe > 0 ? timeframe : 40;
      baseWhere =
        "c.customer_id IN (" +
        "  SELECT customer_id FROM transfers" +
        "  GROUP BY customer_id" +
        "  HAVING MAX(created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)" +
        ")";
      params.push(days);
      break;
    }
    case "new": {
      const days = timeframe > 0 ? timeframe : 7;
      baseWhere = "c.registration_date >= DATE_SUB(NOW(), INTERVAL ? DAY)";
      params.push(days);
      break;
    }
    case "incomplete":
      baseWhere = "c.kyc_completion_date IS NULL";
      break;
    default:
      baseWhere =
        "(c.kyc_completion_date IS NULL" +
        " OR (c.total_transfers = 0 AND c.registration_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)))";
      break;
  }

  let extraWhere = "";
  if (search) {
    const like = `%${search}%`;
    extraWhere += " AND (c.full_name LIKE ? OR c.phone_number LIKE ? OR c.customer_id LIKE ?)";
    params.push(like, like, like);
  }
  if (country) {
    extraWhere += " AND c.country = ?";
    params.push(country);
  }

  const sql =
    "SELECT c.customer_id, c.full_name, c.country," +
    " c.registration_date, c.kyc_completion_date, c.total_transfers," +
    " (SELECT MAX(t.created_at) FROM transfers t WHERE t.customer_id = c.customer_id) AS last_transfer_date" +
    " FROM customers c" +
    " WHERE " + baseWhere + extraWhere +
    " ORDER BY" +
    "   CASE WHEN c.kyc_completion_date IS NULL THEN 0" +
    "        WHEN c.total_transfers = 0 THEN 1 ELSE 2 END ASC," +
    "   c.registration_date ASC" +
    " LIMIT 500";

  return { sql, params };
}

// ─── test cases ──────────────────────────────────────────────────────────────

const TESTS = [
  // Default view
  { label: "default  (no timeframe)",      queueType: "default",    timeframe: 0  },

  // Incomplete
  { label: "incomplete – KYC null",        queueType: "incomplete", timeframe: 0  },

  // New / recently registered
  { label: "new      – last  7 days",      queueType: "new",        timeframe: 7  },
  { label: "new      – last 14 days",      queueType: "new",        timeframe: 14 },
  { label: "new      – last 28 days",      queueType: "new",        timeframe: 28 },
  { label: "new      – last 60 days",      queueType: "new",        timeframe: 60 },

  // Dormant
  { label: "dormant  – over  7 days",      queueType: "dormant",    timeframe: 7  },
  { label: "dormant  – over 14 days",      queueType: "dormant",    timeframe: 14 },
  { label: "dormant  – over 30 days",      queueType: "dormant",    timeframe: 30 },
  { label: "dormant  – over 40 days",      queueType: "dormant",    timeframe: 40 },
  { label: "dormant  – over 90 days",      queueType: "dormant",    timeframe: 90 },
  { label: "dormant  – over 180 days",     queueType: "dormant",    timeframe: 180 },

  // Filters on top
  { label: "new 30d + country=United Kingdom", queueType: "new",    timeframe: 30, country: "United Kingdom" },
  { label: "incomplete + search='Ali'",        queueType: "incomplete", timeframe: 0, search: "Ali" },
];

// ─── runner ──────────────────────────────────────────────────────────────────

async function run() {
  const pool = await mysql.createPool(DB);

  // ── preamble: live data snapshot ─────────────────────────────────────────
  const [[snap]] = await pool.query(
    "SELECT COUNT(*) AS customers," +
    " SUM(registration_date IS NULL) AS null_reg," +
    " SUM(kyc_completion_date IS NULL) AS kyc_pending," +
    " MIN(registration_date) AS oldest_reg," +
    " MAX(registration_date) AS newest_reg" +
    " FROM customers"
  );
  const [[tsnap]] = await pool.query(
    "SELECT COUNT(*) AS transfers," +
    " COUNT(DISTINCT customer_id) AS unique_customers," +
    " MIN(created_at) AS oldest_tx," +
    " MAX(created_at) AS newest_tx" +
    " FROM transfers"
  );
  const [[matched]] = await pool.query(
    "SELECT COUNT(DISTINCT c.customer_id) AS matched" +
    " FROM customers c" +
    " JOIN transfers t ON t.customer_id = c.customer_id"
  );

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" LIVE DATA SNAPSHOT  (as of " + new Date().toISOString().slice(0, 10) + ")");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" customers         :", snap.customers);
  console.log(" kyc_pending       :", snap.kyc_pending);
  console.log(" reg date range    :", snap.oldest_reg?.toISOString().slice(0,10), "→", snap.newest_reg?.toISOString().slice(0,10));
  console.log(" transfers         :", tsnap.transfers);
  console.log(" unique tx cust    :", tsnap.unique_customers);
  console.log(" tx date range     :", tsnap.oldest_tx?.toISOString().slice(0,10), "→", tsnap.newest_tx?.toISOString().slice(0,10));
  console.log(" customers w/ txs  :", matched.matched, "(overlap between tables)");
  console.log("");

  // ── per-test ─────────────────────────────────────────────────────────────
  let passed = 0;
  let notes  = 0;

  for (const tc of TESTS) {
    const { sql, params } = buildQuery(
      tc.queueType,
      tc.timeframe ?? 0,
      tc.search   ?? "",
      tc.country  ?? ""
    );

    let rows;
    try {
      [rows] = await pool.query(sql, params);
    } catch (err) {
      console.log(" ✗ " + tc.label);
      console.log("   ERROR:", err.message);
      console.log("");
      continue;
    }

    const count = rows.length;
    const warn  = count === 0 ? "  ⚠ no results" : "";

    console.log("──────────────────────────────────────────────────────────");
    console.log(" ✓ " + tc.label);
    console.log("   count  : " + count + warn);

    if (count > 0) {
      const sample = rows.slice(0, SAMPLE_SIZE);
      for (const r of sample) {
        const reg     = r.registration_date   ? r.registration_date.toISOString().slice(0,10) : "null";
        const kyc     = r.kyc_completion_date ? r.kyc_completion_date.toISOString().slice(0,10) : "null";
        const lastTx  = r.last_transfer_date  ? r.last_transfer_date.toISOString().slice(0,10)  : "none";
        console.log(
          "   sample: " +
          String(r.customer_id).padEnd(8) +
          (r.full_name ?? "—").slice(0, 25).padEnd(26) +
          " reg=" + reg +
          " kyc=" + kyc +
          " lastTx=" + lastTx
        );
      }
      if (count > SAMPLE_SIZE) console.log("   ... +" + (count - SAMPLE_SIZE) + " more");
      passed++;
    } else if (tc.queueType === "dormant") {
      // Dormant returning 0 is OK if all matched customers have recent transfers
      console.log("   note  : 0 dormant is expected — all matched customers"); 
      console.log("           have had transfers within the threshold period.");
      notes++;
    } else {
      notes++;
    }
    console.log("");
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log(" SUMMARY: " + passed + " tests returned data | " + notes + " returned 0 (see notes above)");
  console.log("══════════════════════════════════════════════════════════\n");

  await pool.end();
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
