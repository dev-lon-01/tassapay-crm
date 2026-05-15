/**
 * Smoke test: GET /api/todos?transferReference=...&view=open
 *
 * Run from the project root (dev server on PORT 3000):
 *   node --require dotenv/config scripts/test-todos-transfer-filter.mjs
 *
 * Required in .env.local:
 *   CRM_TEST_EMAIL          an agent or admin email
 *   CRM_TEST_PASSWORD       that user's password
 *   CRM_TEST_TRANSFER_REF   a transfer reference with at least one open task
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
const EMAIL = process.env.CRM_TEST_EMAIL;
const PASSWORD = process.env.CRM_TEST_PASSWORD;
const TRANSFER_REF = process.env.CRM_TEST_TRANSFER_REF;

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m  ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m  ${msg}`); process.exit(1); }

if (!EMAIL || !PASSWORD) fail("Set CRM_TEST_EMAIL and CRM_TEST_PASSWORD in .env.local");
if (!TRANSFER_REF) fail("Set CRM_TEST_TRANSFER_REF in .env.local to a ref with ≥1 open task");

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) fail(`Login failed: ${loginRes.status}`);
const cookies = loginRes.headers.raw()["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
if (!cookies) fail("No session cookie");
pass("Login succeeded");

async function getTodos(qs) {
  const res = await fetch(`${BASE}/api/todos${qs}`, { headers: { cookie: cookies } });
  if (!res.ok) fail(`GET /api/todos${qs} failed: ${res.status}`);
  return res.json();
}

const okRes = await getTodos(`?transferReference=${encodeURIComponent(TRANSFER_REF)}&view=open`);
const okRows = okRes.data ?? [];
if (okRows.length === 0) fail(`Expected ≥1 open task for transfer ${TRANSFER_REF}; got 0`);
const mismatched = okRows.filter((r) => r.transfer_reference !== TRANSFER_REF);
if (mismatched.length > 0) {
  fail(`Got ${mismatched.length} rows whose transfer_reference != ${TRANSFER_REF}. Sample: ${JSON.stringify(mismatched[0])}`);
}
pass(`Open tasks for transfer ${TRANSFER_REF}: ${okRows.length} rows, all match`);

const bogusRes = await getTodos(`?transferReference=__no_such_ref_xyzzy__&view=open`);
const bogusRows = bogusRes.data ?? [];
if (bogusRows.length > 0) fail(`Bogus transfer ref returned ${bogusRows.length} rows`);
pass("Bogus transfer ref returns zero rows");

console.log("\nAll todos-transfer-filter checks passed.");
