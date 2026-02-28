import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const conn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
});

async function addColIfMissing(col, ddl) {
  const [rows] = await conn.execute(`SHOW COLUMNS FROM alert_routings LIKE '${col}'`);
  if (rows.length > 0) { console.log(`  already exists: ${col}`); }
  else { await conn.execute(`ALTER TABLE alert_routings ADD COLUMN ${ddl}`); console.log(`  added: ${col}`); }
}

await addColIfMissing("pushover_keys",     "pushover_keys TEXT DEFAULT NULL");
await addColIfMissing("pushover_sound",    "pushover_sound VARCHAR(50) NOT NULL DEFAULT 'pushover'");
await addColIfMissing("pushover_priority", "pushover_priority INT NOT NULL DEFAULT 0");

await conn.end();
console.log("✓ migrate-pushover complete");
