/**
 * End-to-end smoke test of the account-lookup API.
 * Requires `npm run dev` running on localhost:3000.
 *
 * Usage: TOKEN=<jwt> TRANSFER_ID=<id> node scripts/test-account-lookup-api.mjs
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.TOKEN;
const TRANSFER_ID = Number(process.env.TRANSFER_ID);

if (!TOKEN) { console.error("Missing TOKEN env var"); process.exit(1); }
if (!Number.isFinite(TRANSFER_ID) || TRANSFER_ID <= 0) {
  console.error("Missing TRANSFER_ID env var (a real transfers.id)"); process.exit(1);
}

const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

let exitCode = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ✓  ${label}`); }
  catch (e) { console.error(`  ✗  ${label}: ${e.message}`); exitCode = 1; }
}

await check("GET /banks?country=ET returns 40 methods", async () => {
  const r = await fetch(`${BASE}/api/account-lookup/banks?country=ET`, { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.country !== "ET") throw new Error("country mismatch");
  if (!Array.isArray(j.methods) || j.methods.length !== 40)
    throw new Error(`expected 40 methods, got ${j.methods?.length}`);
});

let goodLookupId, badLookupId;

await check("POST /account-lookup CBE valid → success", async () => {
  const r = await fetch(`${BASE}/api/account-lookup`, {
    method: "POST", headers: H,
    body: JSON.stringify({ country: "ET", methodType: "bank", methodCode: "CBE", accountNumber: "1000188695168" }),
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== "success") throw new Error(`status=${j.status}`);
  if (!j.accountName) throw new Error("no accountName");
  goodLookupId = j.lookupId;
});

await check("POST /account-lookup CBE invalid → failed", async () => {
  const r = await fetch(`${BASE}/api/account-lookup`, {
    method: "POST", headers: H,
    body: JSON.stringify({ country: "ET", methodType: "bank", methodCode: "CBE", accountNumber: "1000188699999" }),
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== "failed") throw new Error(`status=${j.status}`);
  badLookupId = j.lookupId;
});

await check("POST /account-lookup invalid bank → 400", async () => {
  const r = await fetch(`${BASE}/api/account-lookup`, {
    method: "POST", headers: H,
    body: JSON.stringify({ country: "ET", methodType: "bank", methodCode: "NOTABANK", accountNumber: "1" }),
  });
  if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
});

await check("POST /[id]/attach success → 201", async () => {
  if (!goodLookupId) throw new Error("no good lookup id from earlier test");
  const r = await fetch(`${BASE}/api/account-lookup/${goodLookupId}/attach`, {
    method: "POST", headers: H,
    body: JSON.stringify({ targetType: "transfer", targetId: TRANSFER_ID }),
  });
  if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
});

await check("POST /[id]/attach for failed lookup → 409", async () => {
  if (!badLookupId) throw new Error("no bad lookup id from earlier test");
  const r = await fetch(`${BASE}/api/account-lookup/${badLookupId}/attach`, {
    method: "POST", headers: H,
    body: JSON.stringify({ targetType: "transfer", targetId: TRANSFER_ID }),
  });
  if (r.status !== 409) throw new Error(`HTTP ${r.status}`);
});

await check("GET /verifications returns the attachment", async () => {
  const r = await fetch(
    `${BASE}/api/account-lookup/verifications?targetType=transfer&targetId=${TRANSFER_ID}`,
    { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j) || j.length === 0) throw new Error("no verifications");
  if (!j[0].lookup?.accountName) throw new Error("missing accountName in first verification");
});

console.log(exitCode ? "\nFAILED\n" : "\nAll API checks passed.\n");
process.exit(exitCode);
