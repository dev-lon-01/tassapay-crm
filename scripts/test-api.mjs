/**
 * Integration test: TassaPay login → customer search
 *
 * Run from the project root:
 *   node --require dotenv/config scripts/test-api.mjs
 *
 * What it checks:
 *   1. Env vars are present
 *   2. Login returns Status "0" and a valid session cookie
 *   3. Customer search returns an array (may be empty)
 *   4. Prints a preview of the first customer record
 */

import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

// Load .env.local from the project root (Next.js convention)
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const BASE = "https://tassapay.co.uk/backoffice";

const SHARED_HEADERS = {
  accept: "*/*",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  origin: "https://tassapay.co.uk",
  pragma: "no-cache",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
};

function formatDDMMYYYY(d) {
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

function parseSetCookies(headers) {
  const results = [];
  headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") {
      const kv = value.split(";")[0].trim();
      if (kv) results.push(kv);
    }
  });
  return results;
}

function pass(msg) {
  console.log(`  \x1b[32m✓\x1b[0m  ${msg}`);
}
function fail(msg) {
  console.error(`  \x1b[31m✗\x1b[0m  ${msg}`);
  process.exit(1);
}
function info(msg) {
  console.log(`     ${msg}`);
}

// ─── Step 0: env vars ─────────────────────────────────────────────────────────

console.log("\n\x1b[1mTassaPay API – integration test\x1b[0m\n");
console.log("Step 1 – Env vars");

const username = process.env.TASSAPAY_USERNAME;
const password = process.env.TASSAPAY_PASSWORD;
const branchKey = process.env.TASSAPAY_BRANCH_KEY;

if (!username) fail("TASSAPAY_USERNAME is not set");
if (!password) fail("TASSAPAY_PASSWORD is not set");
if (!branchKey) fail("TASSAPAY_BRANCH_KEY is not set");

pass(`TASSAPAY_USERNAME = ${username}`);
pass(`TASSAPAY_PASSWORD = ${"*".repeat(password.length)}`);
pass(`TASSAPAY_BRANCH_KEY = ${branchKey}`);

// ─── Step 1: login ────────────────────────────────────────────────────────────

console.log("\nStep 2 – Login");

const loginRes = await fetch(`${BASE}/LoginHandler.ashx?Task=1`, {
  method: "POST",
  headers: {
    ...SHARED_HEADERS,
    "content-type": "application/json; charset=UTF-8",
    referer: "https://tassapay.co.uk/backoffice/login",
  },
  body: JSON.stringify({
    Param: [
      {
        username,
        password,
        BranchKey: branchKey,
        reCaptcha: "",
        remcondition: true,
      },
    ],
  }),
});

if (!loginRes.ok) fail(`HTTP ${loginRes.status} ${loginRes.statusText}`);
pass(`HTTP ${loginRes.status} OK`);

const loginJson = await loginRes.json();
const ld = loginJson[0];

if (ld.Status !== "0") fail(`Login failed – ErrorMessage: "${ld.ErrorMessage}"`);
pass(`Status = 0 (success)`);
pass(`Logged in as: ${ld.Name}  (User_ID=${ld.User_ID}, Branch=${ld.LoginBranch})`);

// Build the cookie header the same way the browser does
const serverCookies = parseSetCookies(loginRes.headers);
info(`Server set ${serverCookies.length} cookie(s): ${serverCookies.map(c => c.split("=")[0]).join(", ")}`);

const cookieHeader = [
  `username=${encodeURIComponent(ld.E_User_Nm)}`,
  `password=${encodeURIComponent(ld.E_Password)}`,
  `mtsbranchkey=${encodeURIComponent(ld.E_Branch_key)}`,
  `remember=true`,
  `Till_ID=${ld.Till_ID ?? "0"}`,
  ...serverCookies,
].join("; ");

pass(`Cookie header assembled (${cookieHeader.length} chars)`);

// ─── Step 2: customer search ──────────────────────────────────────────────────

console.log("\nStep 3 – Customer search");

const today = formatDDMMYYYY(new Date());
const monthAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 31); return formatDDMMYYYY(d); })();

info(`Date range: ${monthAgo} → ${today}`);

const searchRes = await fetch(`${BASE}/CustomerHandler.ashx/?Task=search`, {
  method: "POST",
  headers: {
    ...SHARED_HEADERS,
    "content-type": "application/json;",
    referer: "https://tassapay.co.uk/backoffice/customers",
    cookie: cookieHeader,
  },
  body: JSON.stringify({
    Param: [
      {
        Chk_Date: "false",
        latest_id: "1",
        CustomerName: "",
        WireTransfer_ReferanceNo: "",
        Email_ID: "",
        Post_Code: "",
        Mobile_Number: "",
        BlackList: "-1",
        Delete_Status: null,
        File_Ref: "",
        Branch_ID: -1,
        Client_ID: ld.Client_ID,
        User_ID: ld.User_ID,
        Username: ld.Name,
        id_verification_status: "-1",
        Risk_Level: "-1",
        fromdate: monthAgo,
        todate: today,
        C_User_ID: -1,
        ApplyUserFilter: 0,
        Sourse_of_Registration: "",
        Sender_DateOfBirth: "",
        agent_branch: ld.Agent_branch ?? "1",
        CommentPriority: "-1",
      },
    ],
  }),
});

if (!searchRes.ok) fail(`HTTP ${searchRes.status} ${searchRes.statusText}`);
pass(`HTTP ${searchRes.status} OK`);

const customers = await searchRes.json();

if (!Array.isArray(customers)) fail(`Response is not an array – got: ${JSON.stringify(customers).slice(0, 200)}`);
pass(`Response is an array with ${customers.length} customer(s)`);

if (customers.length > 0) {
  const first = customers[0];
  info(`First customer preview:`);
  info(`  Name  : ${first.Sender_Full_Name ?? first.CustomerName ?? "(field name unknown)"}`);
  info(`  Keys  : ${Object.keys(first).slice(0, 8).join(", ")}…`);
}

console.log("\n\x1b[32m\x1b[1mAll checks passed.\x1b[0m\n");
