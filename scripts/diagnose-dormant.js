const mysql = require("mysql2/promise");

async function run() {
  const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "Wadani2020",
    database: "tassapay_crm",
  });

  // Dormant using IN subquery (correct approach)
  const [d40] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM customers c WHERE c.customer_id IN (" +
    "  SELECT customer_id FROM transfers GROUP BY customer_id" +
    "  HAVING MAX(created_at) <= DATE_SUB(NOW(), INTERVAL 40 DAY)" +
    ")"
  );
  console.log("dormant via IN subquery (40d):", d40[0].cnt);

  // Distribution of last transfer dates for matched customers
  const [dist] = await pool.query(
    "SELECT " +
    "  SUM(last_tx > DATE_SUB(NOW(), INTERVAL 7 DAY))   AS within_7d," +
    "  SUM(last_tx > DATE_SUB(NOW(), INTERVAL 30 DAY))  AS within_30d," +
    "  SUM(last_tx > DATE_SUB(NOW(), INTERVAL 40 DAY))  AS within_40d," +
    "  SUM(last_tx <= DATE_SUB(NOW(), INTERVAL 40 DAY)) AS older_than_40d," +
    "  COUNT(*) AS total_matched " +
    "FROM (" +
    "  SELECT c.customer_id, MAX(t.created_at) AS last_tx " +
    "  FROM customers c " +
    "  JOIN transfers t ON t.customer_id = c.customer_id " +
    "  GROUP BY c.customer_id" +
    ") x"
  );
  console.log("last-transfer distribution for matched customers:", JSON.stringify(dist[0], null, 2));

  await pool.end();
}

run().catch(console.error);
