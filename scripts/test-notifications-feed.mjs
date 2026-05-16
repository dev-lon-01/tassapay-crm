/**
 * Manual smoke: post a comment containing a mention, then GET the
 * notifications feed as the mentioned user to verify the row appeared.
 *
 * Run from project root (dev server on PORT 3000):
 *   node --require dotenv/config scripts/test-notifications-feed.mjs
 *
 * Required .env.local:
 *   CRM_ACTOR_EMAIL          email of the user posting the comment
 *   CRM_ACTOR_PASSWORD
 *   CRM_MENTIONED_EMAIL      email of the user being mentioned
 *   CRM_MENTIONED_PASSWORD
 *   CRM_MENTIONED_ID         numeric id of the mentioned user
 *   CRM_MENTIONED_NAME       display name embedded in the token
 *   CRM_TEST_TASK_ID         existing task id the actor can comment on
 *
 * Optional:
 *   CRM_BASE_URL             defaults to http://localhost:3000
 */

import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const BASE = process.env.CRM_BASE_URL ?? "http://localhost:3000";
const env = (name) => {
  const v = process.env[name];
  if (!v) { console.log(`  \x1b[31m✗\x1b[0m  Set ${name} in .env.local`); process.exit(1); }
  return v;
};

const ACTOR_EMAIL = env("CRM_ACTOR_EMAIL");
const ACTOR_PW    = env("CRM_ACTOR_PASSWORD");
const MEN_EMAIL   = env("CRM_MENTIONED_EMAIL");
const MEN_PW      = env("CRM_MENTIONED_PASSWORD");
const MEN_ID      = env("CRM_MENTIONED_ID");
const MEN_NAME    = env("CRM_MENTIONED_NAME");
const TASK_ID     = env("CRM_TEST_TASK_ID");

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m  ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m  ${msg}`); process.exit(1); }

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) fail(`Login failed for ${email}: ${res.status}`);
  const cookies = res.headers.raw()["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
  if (!cookies) fail(`No session cookie for ${email}`);
  return cookies;
}

const actorCookies = await login(ACTOR_EMAIL, ACTOR_PW);
pass(`Actor login (${ACTOR_EMAIL})`);

const menCookies = await login(MEN_EMAIL, MEN_PW);
pass(`Mentioned login (${MEN_EMAIL})`);

const mention = `@[${MEN_NAME}](user:${MEN_ID})`;
const commentBody = `Smoke ${Date.now()}: ${mention} please review.`;

const postRes = await fetch(`${BASE}/api/todos/${TASK_ID}/comments`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: actorCookies },
  body: JSON.stringify({ comment: commentBody }),
});
if (postRes.status !== 201 && postRes.status !== 200) {
  fail(`POST comment returned ${postRes.status}`);
}
pass(`Posted comment with mention of user ${MEN_ID}`);

await new Promise((r) => setTimeout(r, 800));

const feedRes = await fetch(`${BASE}/api/notifications`, { headers: { cookie: menCookies } });
if (!feedRes.ok) fail(`GET /api/notifications returned ${feedRes.status}`);
const feed = await feedRes.json();
const found = (feed.data ?? []).find(
  (n) => n.type === "mention" && Number(n.task_id) === Number(TASK_ID)
);
if (!found) {
  fail(`No mention row for task ${TASK_ID} in feed. Got: ${JSON.stringify(feed)}`);
}
pass(`Mentioned user sees the new row (id=${found.id}, unread_count=${feed.unread_count})`);

console.log("\nAll notifications-feed smoke checks passed.");
