/**
 * Manual smoke test: POST a comment containing a mention and verify
 * the API accepts it. External email delivery must be verified by hand.
 *
 * Run from the project root (dev server on PORT 3000):
 *   node --require dotenv/config scripts/test-mention-notify.mjs
 *
 * Required .env.local:
 *   CRM_TEST_EMAIL          actor's email
 *   CRM_TEST_PASSWORD       actor's password
 *   CRM_TEST_TASK_ID        an existing task id you have access to
 *   CRM_TEST_MENTION_ID     user id to mention
 *   CRM_TEST_MENTION_NAME   display name to embed in the token
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
const TASK_ID = process.env.CRM_TEST_TASK_ID;
const MENTION_ID = process.env.CRM_TEST_MENTION_ID;
const MENTION_NAME = process.env.CRM_TEST_MENTION_NAME;

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m  ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m  ${msg}`); process.exit(1); }

for (const [k, v] of Object.entries({ EMAIL, PASSWORD, TASK_ID, MENTION_ID, MENTION_NAME })) {
  if (!v) fail(`Set CRM_TEST_${k} in .env.local`);
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) fail(`Login failed: ${loginRes.status}`);
const cookies = loginRes.headers.raw()["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
pass("Login succeeded");

const mention = `@[${MENTION_NAME}](user:${MENTION_ID})`;
const body = `Smoke test ${Date.now()}: ${mention} please take a look.`;

const postRes = await fetch(`${BASE}/api/todos/${TASK_ID}/comments`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: cookies },
  body: JSON.stringify({ comment: body }),
});
if (postRes.status !== 201 && postRes.status !== 200) {
  fail(`POST /api/todos/${TASK_ID}/comments returned ${postRes.status}`);
}
pass(`Posted comment with mention of user ${MENTION_ID} (${MENTION_NAME})`);

console.log("\nNow manually verify:");
console.log(`  - User ${MENTION_ID} received an email at their address.`);
console.log("  - Dev server log shows no [notifyMentions] errors.");
console.log("  - Reload the to-do page; the comment renders with an indigo pill where the mention appears.");
