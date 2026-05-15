/**
 * Smoke test: end-to-end task-assignment notification.
 *
 * Run from project root (dev server on PORT 3000):
 *   node --require dotenv/config scripts/test-task-notifications.mjs
 *
 * Required .env.local:
 *   CRM_TEST_EMAIL          admin or agent email (the actor)
 *   CRM_TEST_PASSWORD       that user's password
 *   CRM_TEST_CUSTOMER_ID    a customer_id that exists
 *   CRM_TEST_ASSIGNEE_ID    another user's id (the recipient)
 *
 * Optional:
 *   CRM_BASE_URL            defaults to http://localhost:3000
 *
 * What it checks:
 *   1. Login.
 *   2. POST /api/todos with assigned_agent_id = ASSIGNEE_ID returns 201.
 *   3. Pause for the fire-and-forget dispatch.
 *   4. PATCH the task assigning it to the actor (self-assign) — expect 200.
 *
 * Note: the script cannot verify external delivery (Pushover/email).
 * Manually check the assignee's inbox + Pushover and the dev server
 * console for [notifyAssignee] errors.
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
const CUSTOMER_ID = process.env.CRM_TEST_CUSTOMER_ID;
const ASSIGNEE_ID = process.env.CRM_TEST_ASSIGNEE_ID;

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m  ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m  ${msg}`); process.exit(1); }

for (const [k, v] of Object.entries({ EMAIL, PASSWORD, CUSTOMER_ID, ASSIGNEE_ID })) {
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

const createRes = await fetch(`${BASE}/api/todos`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: cookies },
  body: JSON.stringify({
    customer_id: CUSTOMER_ID,
    title: `[notif smoke ${Date.now()}] Test assignment`,
    description: "Created by scripts/test-task-notifications.mjs",
    category: "Query",
    priority: "Low",
    assigned_agent_id: Number(ASSIGNEE_ID),
  }),
});
if (createRes.status !== 201) fail(`POST /api/todos returned ${createRes.status}`);
const created = await createRes.json();
pass(`Created task ${created.id} assigned to user ${ASSIGNEE_ID}`);

await new Promise((r) => setTimeout(r, 1500));

const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: cookies } });
const me = await meRes.json();
const myId = me.id ?? me.user?.id;
if (!myId) fail("Could not resolve actor user id from /api/auth/me");

const patchRes = await fetch(`${BASE}/api/todos/${created.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", cookie: cookies },
  body: JSON.stringify({ assigned_agent_id: myId }),
});
if (!patchRes.ok) fail(`PATCH /api/todos/${created.id} returned ${patchRes.status}`);
pass(`Reassigned task ${created.id} to self (user ${myId})`);

console.log("\nSmoke passed. Now manually verify:");
console.log("  - The assignee received an email (check inbox).");
console.log("  - The assignee received a Pushover ping (if pushover_user_key is populated).");
console.log("  - The dev server log shows no [notifyAssignee] errors.");
