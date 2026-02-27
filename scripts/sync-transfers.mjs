/**
 * scripts/sync-transfers.mjs
 *
 * Pulls transfers from TassaPay Transaction_Search API and upserts
 * them into the MySQL `transfers` table.
 *
 * Usage:
 *   node scripts/sync-transfers.mjs                          # last 30 days (default)
 *   node scripts/sync-transfers.mjs --from 01/01/2025        # custom from-date
 *   node scripts/sync-transfers.mjs --from 01/01/2025 --to 01/03/2026
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}
function fmtDate(d) {
  return [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()].join("/");
}
const today      = new Date();
const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() - 30);
const fromdate   = getArg("--from") ?? fmtDate(defaultFrom);
const todate     = getArg("--to")   ?? fmtDate(today);

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = "https://tassapay.co.uk/backoffice";
const HEADERS = {
  accept: "*/*", "cache-control": "no-cache", origin: "https://tassapay.co.uk",
  "user-agent": "Mozilla/5.0", "x-requested-with": "XMLHttpRequest",
};

function parseSetCookies(headers) {
  const r = [];
  headers.forEach((v, n) => { if (n.toLowerCase() === "set-cookie") r.push(v.split(";")[0].trim()); });
  return r;
}

// ─── field mapping helpers ────────────────────────────────────────────────────

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function stripHtml(raw) {
  if (!raw || !String(raw).trim()) return null;
  const stripped = String(raw)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
  return stripped === "" ? null : stripped;
}

/**
 * "25/02/2026  14:39:44" → "2026-02-25 14:39:44"
 * Handles 1 or 2 spaces between date and time.
 */
function parseDate(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim().replace(/\s+/, " ");
  const [datePart, timePart] = s.split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")} ${timePart ?? "00:00:00"}`;
}

function mapRow(t) {
  return [
    String(t.Customer_ID).trim(),   // customer_id (numeric backoffice ID)
    String(t.ReferenceNo).trim(),   // transaction_ref
    parseDate(t.Date1),             // created_at
    num(t.Totalamount),             // send_amount
    str(t.FromCurrency_Code),       // send_currency
    num(t.Amount_in_other_cur),     // receive_amount
    str(t.Currency_Code),           // receive_currency
    str(t.Country_Name),            // destination_country
    str(t.Reciever),                // beneficiary_name
    str(t.Tx_Status),               // status
    stripHtml(str(t.LatestCust_Comment)), // hold_reason
    str(t.Ptype),                   // payment_method
    str(t.Type_Name),               // delivery_method
  ];
}

const UPSERT_SQL = `
INSERT INTO transfers
  (customer_id, transaction_ref, created_at,
   send_amount, send_currency,
   receive_amount, receive_currency,
   destination_country, beneficiary_name,
   status, hold_reason,
   payment_method, delivery_method)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  customer_id         = VALUES(customer_id),
  created_at          = VALUES(created_at),
  send_amount         = VALUES(send_amount),
  send_currency       = VALUES(send_currency),
  receive_amount      = VALUES(receive_amount),
  receive_currency    = VALUES(receive_currency),
  destination_country = VALUES(destination_country),
  beneficiary_name    = VALUES(beneficiary_name),
  status              = VALUES(status),
  hold_reason         = VALUES(hold_reason),
  payment_method      = VALUES(payment_method),
  delivery_method     = VALUES(delivery_method),
  synced_at           = CURRENT_TIMESTAMP
`;

// ─── main ─────────────────────────────────────────────────────────────────────

console.log(`\n\x1b[1mTassaPay → MySQL transfer sync\x1b[0m`);
console.log(`Date range: ${fromdate} → ${todate}\n`);

// 1. Login
process.stdout.write("Logging in…  ");
const lr = await fetch(`${BASE}/LoginHandler.ashx?Task=1`, {
  method: "POST",
  headers: { ...HEADERS, "content-type": "application/json; charset=UTF-8", referer: "https://tassapay.co.uk/backoffice/login" },
  body: JSON.stringify({ Param: [{ username: process.env.TASSAPAY_USERNAME, password: process.env.TASSAPAY_PASSWORD, BranchKey: process.env.TASSAPAY_BRANCH_KEY, reCaptcha: "", remcondition: true }] }),
});
const ld = (await lr.json())[0];
if (ld.Status !== "0") { console.error(`FAILED – ${ld.ErrorMessage}`); process.exit(1); }
console.log(`\x1b[32m✓\x1b[0m  (${ld.Name})`);

const cookieHeader = [
  `username=${encodeURIComponent(ld.E_User_Nm)}`,
  `password=${encodeURIComponent(ld.E_Password)}`,
  `mtsbranchkey=${encodeURIComponent(ld.E_Branch_key)}`,
  "remember=true", "Till_ID=0",
  ...parseSetCookies(lr.headers),
].join("; ");

// 2. Fetch transfers
process.stdout.write(`Fetching transfers…  `);
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
const transfers = await sr.json();
if (!Array.isArray(transfers)) {
  console.error("Unexpected response:", JSON.stringify(transfers).slice(0, 200));
  process.exit(1);
}
console.log(`\x1b[32m✓\x1b[0m  ${transfers.length} records`);

// 3. Connect to DB
process.stdout.write("Connecting to MySQL…  ");
const db = await mysql.createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});
console.log("\x1b[32m✓\x1b[0m");

// 4. Log sync start
const [logResult] = await db.execute(
  "INSERT INTO sync_log (started_at, status) VALUES (NOW(), 'running')"
);
const syncLogId = logResult.insertId;

// 5. Upsert in batches of 100
const BATCH = 100;
let inserted = 0, updated = 0, skipped = 0;

process.stdout.write(`Upserting ${transfers.length} records`);
await db.beginTransaction();
try {
  for (let i = 0; i < transfers.length; i += BATCH) {
    const batch = transfers.slice(i, i + BATCH);
    for (const t of batch) {
      if (!t.ReferenceNo || !t.Customer_ID) { skipped++; continue; }
      const [res] = await db.execute(UPSERT_SQL, mapRow(t));
      if (res.affectedRows === 1) inserted++;
      else if (res.affectedRows === 2) updated++;
    }
    process.stdout.write(".");
  }
  await db.commit();
  console.log(" \x1b[32m✓\x1b[0m");
} catch (err) {
  await db.rollback();
  await db.execute(
    "UPDATE sync_log SET finished_at=NOW(), status='error', error_message=? WHERE id=?",
    [String(err), syncLogId]
  );
  await db.end();
  console.error("\nSync failed:", err);
  process.exit(1);
}

// 6. Update sync log
await db.execute(
  "UPDATE sync_log SET finished_at=NOW(), records_fetched=?, records_inserted=?, records_updated=?, status='success' WHERE id=?",
  [transfers.length, inserted, updated, syncLogId]
);

await db.end();

console.log(`\n\x1b[32m\x1b[1mSync complete.\x1b[0m`);
console.log(`  Inserted : ${inserted}`);
console.log(`  Updated  : ${updated}`);
console.log(`  Skipped  : ${skipped}`);
console.log(`  Total    : ${inserted + updated}\n`);
