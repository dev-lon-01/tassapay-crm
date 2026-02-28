import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
Object.assign(process.env, env);

const mysql = require("mysql2/promise");
const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

const [r] = await pool.execute(
  `UPDATE transfers SET sla_alert_sent_at = NULL
   WHERE destination_country = 'Somalia'
     AND status NOT IN ('Completed','Deposited','Cancel')
     AND sla_alert_sent_at IS NOT NULL
   LIMIT 5`
);
console.log(`Reset ${r.affectedRows} transfers`);
await pool.end();
