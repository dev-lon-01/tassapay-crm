/**
 * Smoke test: GET /api/customers default filter + include_leads opt-in.
 *
 * Run from the project root (dev server must be running):
 *   node --require dotenv/config scripts/test-customer-lead-filter.mjs
 *
 * Required in .env.local (or process env):
 *   CRM_TEST_EMAIL     an agent or admin email
 *   CRM_TEST_PASSWORD  that user's password
 *
 * Optional:
 *   CRM_BASE_URL       defaults to http://localhost:3000
 *
 * What it checks:
 *   1. Login returns a session cookie.
 *   2. GET /api/customers (default) returns rows with is_lead in (0, NULL).
 *   3. GET /api/customers?include_leads=1 may include is_lead = 1 rows.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const BASE = process.env.CRM_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.CRM_TEST_EMAIL;
const PASSWORD = process.env.CRM_TEST_PASSWORD;

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m  ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m  ${msg}`); process.exit(1); }

if (!EMAIL || !PASSWORD) {
  fail("CRM_TEST_EMAIL and CRM_TEST_PASSWORD must be set in .env.local");
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) fail(`Login failed: ${loginRes.status}`);
const cookies = loginRes.headers.raw()["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
if (!cookies) fail("No session cookie returned from login");
pass("Login succeeded");

async function getCustomers(qs) {
  const res = await fetch(`${BASE}/api/customers${qs}`, {
    headers: { cookie: cookies },
  });
  if (!res.ok) fail(`GET /api/customers${qs} failed: ${res.status}`);
  return res.json();
}

const defaultRes = await getCustomers("?limit=200");
const defaultRows = defaultRes.data ?? [];
const leakedLeads = defaultRows.filter((r) => r.is_lead === 1);
if (leakedLeads.length > 0) {
  fail(`Default response leaked ${leakedLeads.length} leads. Sample: ${JSON.stringify(leakedLeads[0])}`);
}
pass(`Default response excludes leads (${defaultRows.length} rows, all is_lead in {0, null})`);

const optInRes = await getCustomers("?limit=200&include_leads=1");
const optInRows = optInRes.data ?? [];
const hasLeads = optInRows.some((r) => r.is_lead === 1);
if (optInRows.length > 0 && !hasLeads) {
  console.log("  \x1b[33m!\x1b[0m  ?include_leads=1 returned rows but none were is_lead=1. " +
              "This is OK if the DB has no leads, but worth verifying.");
} else if (hasLeads) {
  pass(`?include_leads=1 includes leads (${optInRows.length} total rows; ${optInRows.filter((r) => r.is_lead === 1).length} are leads)`);
}

console.log("\nAll customer-lead-filter checks passed.");
