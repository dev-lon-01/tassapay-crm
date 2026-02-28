import { config } from "dotenv";
config({ path: ".env.local" });
import { createConnection } from "mysql2/promise";

const agentId = 2;

const conn = await createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [result] = await conn.execute(
  "UPDATE interactions SET agent_id = ? WHERE agent_id IS NULL AND type != 'System'",
  [agentId]
);

console.log(`Rows updated: ${result.affectedRows}`);
await conn.end();
