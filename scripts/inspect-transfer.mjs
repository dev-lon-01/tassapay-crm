/**
 * scripts/inspect-transfer.mjs
 *
 * Fetches the first 3 transfers from the TassaPay API and prints them as
 * formatted JSON so we can verify the exact field names before writing
 * the full sync.
 *
 * Usage:
 *   node scripts/inspect-transfer.mjs
 *   node scripts/inspect-transfer.mjs --from 01/01/2025 --to 01/03/2026
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}
function fmtDate(d) {
  return [String(d.getDate()).padStart(2,"0"), String(d.getMonth()+1).padStart(2,"0"), d.getFullYear()].join("/");
}
const today    = new Date();
const fromDef  = new Date(); fromDef.setDate(fromDef.getDate() - 31);
const fromdate = getArg("--from") ?? fmtDate(fromDef);
const todate   = getArg("--to")   ?? fmtDate(today);

const BASE = "https://tassapay.co.uk/backoffice";
const HEADERS = {
  accept: "*/*", "cache-control": "no-cache", origin: "https://tassapay.co.uk",
  "user-agent": "Mozilla/5.0", "x-requested-with": "XMLHttpRequest",
};

function parseSetCookies(headers) {
  const r = [];
  headers.forEach((v,n) => { if (n.toLowerCase() === "set-cookie") r.push(v.split(";")[0].trim()); });
  return r;
}

// 1. Login
process.stdout.write("Logging in…  ");
const lr = await fetch(`${BASE}/LoginHandler.ashx?Task=1`, {
  method: "POST",
  headers: { ...HEADERS, "content-type": "application/json; charset=UTF-8", referer: "https://tassapay.co.uk/backoffice/login" },
  body: JSON.stringify({ Param: [{ username: process.env.TASSAPAY_USERNAME, password: process.env.TASSAPAY_PASSWORD, BranchKey: process.env.TASSAPAY_BRANCH_KEY, reCaptcha: "", remcondition: true }] }),
});
const ld = (await lr.json())[0];
if (ld.Status !== "0") { console.error(`FAILED – ${ld.ErrorMessage}`); process.exit(1); }
console.log(`✓  (${ld.Name})`);

const cookieHeader = [
  `username=${encodeURIComponent(ld.E_User_Nm)}`,
  `password=${encodeURIComponent(ld.E_Password)}`,
  `mtsbranchkey=${encodeURIComponent(ld.E_Branch_key)}`,
  "remember=true", "Till_ID=0",
  ...parseSetCookies(lr.headers),
].join("; ");

// 2. Search transfers
process.stdout.write(`Fetching transfers (${fromdate} → ${todate})…  `);
const sr = await fetch(`${BASE}/Send.ashx/?Task=Transaction_Search`, {
  method: "POST",
  headers: { ...HEADERS, "content-type": "application/json;", referer: "https://tassapay.co.uk/backoffice/transfer-history", cookie: cookieHeader },
  body: JSON.stringify({ Param: [{
    Chk_Date: "false", ID: -1,
    Username: ld.Name, User_ID: ld.User_ID, UserRole_ID: "1", Client_ID: ld.Client_ID,
    trn_referenceNo: "", GCCTransactionNo: "", WireTransfer_ReferanceNo: "",
    sender_name: "", Beneficiary_Name: "",
    TrnStatus: -1, payment_type: -1, payment_status: -1,
    Branch_ID1: -1, Branch_ID: -1, CountryId: -1,
    collection_type: -1, delivery_type: -1, user_id_new: -1,
    search_activity: "1", From_View_Transfers: "Yes",
    fromdate, todate,
    Coll_PointId: "-1", agent_branch: ld.Agent_branch ?? "1",
    PinNumber: "", Mobile_Number: "", Sender_DateOfBirth: "",
  }] }),
});
const raw = await sr.json();

if (!Array.isArray(raw)) {
  console.error("\nUnexpected response:", JSON.stringify(raw).slice(0, 400));
  process.exit(1);
}

console.log(`✓  ${raw.length} records returned\n`);

// Print first 3 records
const sample = raw.slice(0, 3);
console.log("=== FIRST 3 RECORDS ===\n");
for (const rec of sample) {
  console.log(JSON.stringify(rec, null, 2));
  console.log("─".repeat(60));
}

// Print all KEYS from first record
if (raw.length > 0) {
  console.log("\n=== ALL FIELD KEYS (from record[0]) ===");
  console.log(Object.keys(raw[0]).join(", "));
}
