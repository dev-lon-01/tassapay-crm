/**
 * One-off helper: prints the full field list + sample values of the first customer.
 * Run: node scripts/inspect-customer.mjs
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const BASE = "https://tassapay.co.uk/backoffice";
const HEADERS = {
  accept: "*/*",
  "cache-control": "no-cache",
  origin: "https://tassapay.co.uk",
  "user-agent": "Mozilla/5.0",
  "x-requested-with": "XMLHttpRequest",
};

function parseSetCookies(headers) {
  const r = [];
  headers.forEach((v, n) => {
    if (n.toLowerCase() === "set-cookie") r.push(v.split(";")[0].trim());
  });
  return r;
}

// login
const lr = await fetch(`${BASE}/LoginHandler.ashx?Task=1`, {
  method: "POST",
  headers: { ...HEADERS, "content-type": "application/json; charset=UTF-8", referer: "https://tassapay.co.uk/backoffice/login" },
  body: JSON.stringify({ Param: [{ username: process.env.TASSAPAY_USERNAME, password: process.env.TASSAPAY_PASSWORD, BranchKey: process.env.TASSAPAY_BRANCH_KEY, reCaptcha: "", remcondition: true }] }),
});
const ld = (await lr.json())[0];
if (ld.Status !== "0") { console.error("Login failed:", ld.ErrorMessage); process.exit(1); }

const cookieHeader = [
  `username=${encodeURIComponent(ld.E_User_Nm)}`,
  `password=${encodeURIComponent(ld.E_Password)}`,
  `mtsbranchkey=${encodeURIComponent(ld.E_Branch_key)}`,
  `remember=true`, `Till_ID=0`,
  ...parseSetCookies(lr.headers),
].join("; ");

// search
const today = new Date();
const from = new Date(); from.setDate(from.getDate() - 31);
const fmt = d => [String(d.getDate()).padStart(2,"0"), String(d.getMonth()+1).padStart(2,"0"), d.getFullYear()].join("/");

const sr = await fetch(`${BASE}/CustomerHandler.ashx/?Task=search`, {
  method: "POST",
  headers: { ...HEADERS, "content-type": "application/json;", referer: "https://tassapay.co.uk/backoffice/customers", cookie: cookieHeader },
  body: JSON.stringify({ Param: [{ Chk_Date:"false", latest_id:"1", CustomerName:"", WireTransfer_ReferanceNo:"", Email_ID:"", Post_Code:"", Mobile_Number:"", BlackList:"-1", Delete_Status:null, File_Ref:"", Branch_ID:-1, Client_ID:ld.Client_ID, User_ID:ld.User_ID, Username:ld.Name, id_verification_status:"-1", Risk_Level:"-1", fromdate:fmt(from), todate:fmt(today), C_User_ID:-1, ApplyUserFilter:0, Sourse_of_Registration:"", Sender_DateOfBirth:"", agent_branch:ld.Agent_branch??"1", CommentPriority:"-1" }] }),
});

const customers = await sr.json();
const first = customers[0];

console.log("\n=== FIELD INVENTORY (" + Object.keys(first).length + " fields) ===\n");
for (const [k, v] of Object.entries(first)) {
  console.log(`  ${k.padEnd(40)} ${JSON.stringify(v)}`);
}
