import { createRequire } from "module";
import { readFileSync } from "fs";
import https from "https";
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

const [rows] = await pool.execute(
  `SELECT id, destination_country, source_currency, pushover_keys, pushover_sound, pushover_priority, is_active
   FROM alert_routings WHERE is_active = 1`
);
console.log("Active alert routings:");
console.table(rows);
await pool.end();

// Now test sending to each pushover key found
const token = process.env.PUSHOVER_APP_TOKEN;
console.log("\nPUSHOVER_APP_TOKEN:", token ? token.slice(0, 6) + "..." : "(not set)");

for (const row of rows) {
  if (!row.pushover_keys) continue;
  const keys = row.pushover_keys.split(",").map(s => s.trim()).filter(Boolean);
  for (const user of keys) {
    console.log(`\nTesting pushover_key: ${user.slice(0, 6)}... (routing id=${row.id}, ${row.source_currency})`);
    const body = JSON.stringify({ token, user, title: "Debug Test", message: "SLA worker debug test", priority: 0, sound: "pushover" });
    await new Promise((resolve) => {
      const req = https.request(
        { hostname: "api.pushover.net", path: "/1/messages.json", method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => {
          let data = "";
          res.on("data", c => data += c);
          res.on("end", () => { console.log("  Response:", data); resolve(); });
        }
      );
      req.on("error", err => { console.error("  Error:", err.message); resolve(); });
      req.write(body); req.end();
    });
  }
}
