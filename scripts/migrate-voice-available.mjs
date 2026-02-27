import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const conn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT),
  user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME,
});

const [has] = await conn.execute("SHOW COLUMNS FROM users LIKE 'voice_available'");
if (has.length > 0) {
  console.log("voice_available already exists — nothing to do");
} else {
  await conn.execute(
    "ALTER TABLE users ADD COLUMN voice_available TINYINT(1) NOT NULL DEFAULT 0"
  );
  console.log("added users.voice_available");
}

await conn.end();
console.log("✓ migrate-voice-available complete");
