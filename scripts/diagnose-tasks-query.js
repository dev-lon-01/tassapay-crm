const mysql = require("mysql2/promise");

async function run() {
  const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "Wadani2020",
    database: "tassapay_crm",
    waitForConnections: true,
  });

  const [rows] = await pool.query(`
    SELECT
      COUNT(*) AS total_customers,
      SUM(total_transfers = 0) AS zero_transfers,
      SUM(total_transfers > 0) AS has_transfers,
      SUM(registration_date IS NULL) AS null_reg_date,
      MIN(registration_date) AS oldest_reg,
      MAX(registration_date) AS newest_reg
    FROM customers
  `);
  console.log("customers summary:", JSON.stringify(rows[0], null, 2));

  const [t] = await pool.query(`
    SELECT COUNT(*) AS total_transfers,
           COUNT(DISTINCT customer_id) AS unique_customers_in_transfers,
           MIN(created_at) AS oldest_transfer,
           MAX(created_at) AS newest_transfer
    FROM transfers
  `);
  console.log("transfers summary:", JSON.stringify(t[0], null, 2));

  // Are customer_ids in transfers actually present in customers?
  const [matchCheck] = await pool.query(`
    SELECT COUNT(*) AS transfers_with_matching_customer
    FROM transfers tr
    WHERE EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = tr.customer_id)
  `);
  console.log("transfer→customer match:", JSON.stringify(matchCheck[0], null, 2));

  // Sample IDs from both tables
  const [cSample] = await pool.query("SELECT customer_id FROM customers LIMIT 3");
  console.log("sample customer IDs:", cSample.map((r) => r.customer_id));

  const [tSample] = await pool.query("SELECT DISTINCT customer_id FROM transfers LIMIT 3");
  console.log("sample transfer customer_ids:", tSample.map((r) => r.customer_id));

  // How many customers have total_transfers=0 but actual records in transfers table?
  const [mismatch] = await pool.query(`
    SELECT COUNT(*) AS customers_with_transfers_but_zero_count
    FROM customers c
    WHERE c.total_transfers = 0
      AND EXISTS (SELECT 1 FROM transfers t WHERE t.customer_id = c.customer_id)
  `);
  console.log("total_transfers mismatch:", JSON.stringify(mismatch[0], null, 2));

  // Dormant query check: how many would match?
  const [dormant] = await pool.query(`
    SELECT COUNT(*) AS dormant_40d
    FROM customers c
    WHERE c.total_transfers > 0
      AND (
        SELECT MAX(t.created_at)
        FROM transfers t
        WHERE t.customer_id = c.customer_id
      ) <= DATE_SUB(NOW(), INTERVAL 40 DAY)
  `);
  console.log("dormant (total_transfers>0, last tx >40d): ", JSON.stringify(dormant[0], null, 2));

  // Alternative dormant using actual transfers table to derive count
  const [dormantAlt] = await pool.query(`
    SELECT COUNT(DISTINCT c.customer_id) AS dormant_40d_alt
    FROM customers c
    INNER JOIN (
      SELECT customer_id, MAX(created_at) AS last_tx
      FROM transfers
      GROUP BY customer_id
    ) tx ON tx.customer_id = c.customer_id
    WHERE tx.last_tx <= DATE_SUB(NOW(), INTERVAL 40 DAY)
  `);
  console.log("dormant alt (via join, any transfers >40d): ", JSON.stringify(dormantAlt[0], null, 2));

  // New query check: how many registered in last 7 / 30 / 90 / 365 days?
  for (const days of [7, 30, 90, 365]) {
    const [nr] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM customers WHERE registration_date >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );
    console.log(`new (last ${days}d):`, nr[0].cnt);
  }

  await pool.end();
}

run().catch(console.error);
