/**
 * scripts/sync-customers.mjs
 *
 * Pulls ALL customers from TassaPay API and upserts them into MySQL.
 *
 * Usage:
 *   node scripts/sync-customers.mjs                          # last 30 days (default)
 *   node scripts/sync-customers.mjs --from 01/01/2026        # custom from-date
 *   node scripts/sync-customers.mjs --from 01/01/2026 --to 25/02/2026
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

const today = new Date();
const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() - 30);

const fromdate = getArg("--from") ?? fmtDate(defaultFrom);
const todate   = getArg("--to")   ?? fmtDate(today);

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

// ─── DB upsert ────────────────────────────────────────────────────────────────

function str(v)  { if (!v || !String(v).trim()) return null; return String(v).trim(); }

/**
 * Convert "DD/MM/YYYY HH:mm:ss" → "YYYY-MM-DD HH:mm:ss", null for empty.
 */
function parseDate(raw) {
  if (!raw || !raw.trim()) return null;
  const [datePart, timePart] = raw.trim().split(" ");
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")} ${timePart ?? "00:00:00"}`;
}

function mapRow(c) {
  return [
    c.Customer_ID,
    str(c.Full_Name),
    str(c.Email_ID),
    str(c.Mobile_Number1),
    str(c.sender_country),
    parseDate(c.Record_Insert_DateTime2),  // registration_date
    parseDate(c.Record_Insert_DateTime),   // kyc_completion_date (null = KYC not done)
    str(c.Risk_status),
  ];
}

const UPSERT_SQL = `
INSERT INTO customers
  (customer_id, full_name, email, phone_number, country,
   registration_date, kyc_completion_date, risk_status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  full_name           = VALUES(full_name),
  email               = VALUES(email),
  phone_number        = VALUES(phone_number),
  country             = VALUES(country),
  registration_date   = VALUES(registration_date),
  kyc_completion_date = VALUES(kyc_completion_date),
  risk_status         = VALUES(risk_status),
  synced_at           = CURRENT_TIMESTAMP
`;

// ─── main ─────────────────────────────────────────────────────────────────────

console.log(`\n\x1b[1mTassaPay → MySQL sync\x1b[0m`);
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

// 2. Fetch customers
process.stdout.write("Fetching customers…  ");
const sr = await fetch(`${BASE}/CustomerHandler.ashx/?Task=search`, {
  method: "POST",
  headers: { ...HEADERS, "content-type": "application/json;", referer: "https://tassapay.co.uk/backoffice/customers", cookie: cookieHeader },
  body: JSON.stringify({ Param: [{ Chk_Date:"false", latest_id:"1", CustomerName:"", WireTransfer_ReferanceNo:"", Email_ID:"", Post_Code:"", Mobile_Number:"", BlackList:"-1", Delete_Status:null, File_Ref:"", Branch_ID:-1, Client_ID:ld.Client_ID, User_ID:ld.User_ID, Username:ld.Name, id_verification_status:"-1", Risk_Level:"-1", fromdate, todate, C_User_ID:-1, ApplyUserFilter:0, Sourse_of_Registration:"", Sender_DateOfBirth:"", agent_branch:ld.Agent_branch??"1", CommentPriority:"-1" }] }),
});
const customers = await sr.json();
if (!Array.isArray(customers)) { console.error("Unexpected response:", JSON.stringify(customers).slice(0, 200)); process.exit(1); }
console.log(`\x1b[32m✓\x1b[0m  ${customers.length} records`);

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
let inserted = 0, updated = 0;

process.stdout.write(`Upserting ${customers.length} records`);
await db.beginTransaction();
try {
  for (let i = 0; i < customers.length; i += BATCH) {
    const batch = customers.slice(i, i + BATCH);
    for (const c of batch) {
      if (!c.Customer_ID) continue;
      const [res] = await db.execute(UPSERT_SQL, mapRow(c));
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
  [customers.length, inserted, updated, syncLogId]
);

await db.end();

console.log(`\n\x1b[32m\x1b[1mSync complete.\x1b[0m`);
console.log(`  Inserted : ${inserted}`);
console.log(`  Updated  : ${updated}`);
console.log(`  Total    : ${inserted + updated}\n`);
