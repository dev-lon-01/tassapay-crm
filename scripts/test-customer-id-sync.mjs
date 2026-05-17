/**
 * Manual smoke: pull ID documents for one customer and confirm
 * the rows landed in customer_id_documents.
 *
 * Run from project root:
 *   node --require dotenv/config scripts/test-customer-id-sync.mjs
 *
 * Required .env.local:
 *   CRM_TEST_EMAIL          actor's email
 *   CRM_TEST_PASSWORD       actor's password
 *   CRM_TEST_FROM_DATE      YYYY-MM-DD
 *   CRM_TEST_TO_DATE        YYYY-MM-DD (small range — 1-2 days)
 *
 * Optional:
 *   CRM_BASE_URL            defaults to http://localhost:3000
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const BASE = process.env.CRM_BASE_URL ?? "http://localhost:3000";
const env = (k) => { const v = process.env[k]; if (!v) { console.log(`  ✗ Set ${k}`); process.exit(1); } return v; };

const EMAIL = env("CRM_TEST_EMAIL");
const PW = env("CRM_TEST_PASSWORD");
const FROM = env("CRM_TEST_FROM_DATE");
const TO = env("CRM_TEST_TO_DATE");

function pass(msg) { console.log(`  ✓  ${msg}`); }
function fail(msg) { console.log(`  ✗  ${msg}`); process.exit(1); }

const lr = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
if (!lr.ok) fail(`Login failed: ${lr.status}`);
const cookies = lr.headers.raw()["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
pass("Login");

const u = new URL(`${BASE}/api/sync/customer-ids`);
u.searchParams.set("fromDate", FROM);
u.searchParams.set("toDate", TO);
const sr = await fetch(u, { method: "POST", headers: { cookie: cookies } });
if (!sr.ok) fail(`POST /api/sync/customer-ids returned ${sr.status}`);
const body = await sr.json();
pass(`Manual sync ran: ${body.customers} customers, ${body.fetched} fetched, ${body.upserted} upserted, ${body.errors} errors`);

if (body.upserted === 0) {
  console.log("  (no rows upserted — either no customers in the date range or all already up-to-date)");
}

console.log("\nManually verify in MySQL:\n  SELECT customer_id, COUNT(*) FROM customer_id_documents GROUP BY customer_id ORDER BY MAX(synced_at) DESC LIMIT 10;");
