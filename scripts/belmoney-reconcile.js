/**
 * Belmoney Reconciliation Analysis
 * Reads Belmoney_Analysis.xlsx and reconciles:
 *  - BelmoneyTransactions ledger (debits vs credits, balance verification)
 *  - Deposits to ledger entries
 *  - MyBank-GBP to iBanFirst deposits
 *  - Outstanding invoices
 *  - BelmoneyTransfers summary
 */

const XLSX = require("xlsx");
const path = require("path");

const wb = XLSX.readFile(path.join(__dirname, "..", "data", "Belmoney_Analysis_V2.xlsx"));

// ---------- helpers ----------
function parseSheet(name) {
  const ws = wb.Sheets[name];
  if (!ws) { console.error("Sheet not found:", name); process.exit(1); }
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function excelDateToStr(v) {
  if (typeof v === "number" && v > 40000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return String(v);
}

function num(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function fmt(v) { return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// =========================================================
// 1. BELMONEY TRANSACTIONS LEDGER
// =========================================================
console.log("=".repeat(70));
console.log("1. BELMONEY TRANSACTIONS LEDGER ANALYSIS");
console.log("=".repeat(70));

const txRows = parseSheet("BelmoneyTransactions");
let totalDebits = 0, totalCredits = 0;
let invoiceCount = 0, depositCount = 0, refundCount = 0, voidCount = 0;
const deposits = [];
const invoices = [];

for (const r of txRows) {
  const desc = String(r["Desc"] || "").trim();
  if (!desc) continue;
  const debit = num(r["Debit"]);
  const credit = num(r["Credit"]);
  const date = excelDateToStr(r["Date"]);
  const balance = num(r["Balance"]);

  totalDebits += debit;
  totalCredits += credit;

  if (desc.startsWith("INV NO.")) {
    invoiceCount++;
    const invNo = desc.match(/INV NO\. (\d+)/)?.[1];
    invoices.push({ invNo, debit, date, balance });
  } else if (desc.startsWith("DEP.") && !desc.startsWith("VOID")) {
    depositCount++;
    const depId = desc.match(/DEP\.(\d+)/)?.[1];
    const isIban = desc.toLowerCase().includes("iban") || desc.toLowerCase().includes("ibanfirst");
    const isBelmoney = desc.toLowerCase().includes("belmoney");
    deposits.push({ depId, credit, date, isIban, isBelmoney, desc });
  } else if (desc.startsWith("REFUND")) {
    refundCount++;
    totalCredits += 0; // already counted above
  } else if (desc.startsWith("VOID")) {
    voidCount++;
  }
}

console.log(`\nTransaction rows: ${txRows.filter(r => String(r["Desc"] || "").trim()).length}`);
console.log(`  Invoice debits:   ${invoiceCount} entries`);
console.log(`  Deposit credits:  ${depositCount} entries`);
console.log(`  Refund credits:   ${refundCount} entries`);
console.log(`  Void debits:      ${voidCount} entries`);
console.log(`\nTotal Debits  (invoices + voids):  EUR ${fmt(totalDebits)}`);
console.log(`Total Credits (deposits + refunds): EUR ${fmt(totalCredits)}`);
console.log(`Net Balance (Credits - Debits):      EUR ${fmt(totalCredits - totalDebits)}`);
console.log(`Ledger Ending Balance:               EUR ${fmt(txRows.filter(r => num(r["Balance"]) !== 0).pop()?.["Balance"] || 0)}`);

// Verify
const lastBal = num(txRows.filter(r => String(r["Desc"] || "").trim()).pop()?.["Balance"]);
const calcBal = totalCredits - totalDebits;
const diff = Math.abs(calcBal - lastBal);
console.log(`\nBalance verification: calculated=${fmt(calcBal)} vs ledger=${fmt(lastBal)} => diff=${fmt(diff)} ${diff < 0.02 ? "✓ MATCH" : "✗ MISMATCH"}`);

// =========================================================
// 2. DEPOSITS ANALYSIS
// =========================================================
console.log("\n" + "=".repeat(70));
console.log("2. DEPOSITS ANALYSIS");
console.log("=".repeat(70));

const depSheet = parseSheet("Deposits");
const depRows = depSheet.filter(r => num(r["Amount"] || r["__EMPTY_4"]) > 0 || r["Results"]);

// Re-parse with raw column names
let ibanFirstTotal = 0, belmoneyTotal = 0, voidedTotal = 0, approvedTotal = 0;
let ibanCount = 0, belCount = 0;

for (const r of depSheet) {
  const amount = num(Object.values(r)[4]); // Amount is 5th column
  const status = String(Object.values(r)[5] || "");
  const account = String(Object.values(r)[2] || "");
  
  if (amount <= 0 || !status) continue;
  
  if (status === "Voided") {
    voidedTotal += amount;
    continue;
  }
  
  if (account.includes("iBanFirst")) {
    ibanFirstTotal += amount;
    ibanCount++;
  } else if (account.includes("Kbc")) {
    belmoneyTotal += amount;
    belCount++;
  }
  approvedTotal += amount;
}

console.log(`\niBanFirst EUR deposits: ${ibanCount} entries, EUR ${fmt(ibanFirstTotal)}`);
console.log(`KBC/Belmoney SA deposits: ${belCount} entries, EUR ${fmt(belmoneyTotal)}`);
console.log(`Voided deposits: EUR ${fmt(voidedTotal)}`);
console.log(`Total Approved deposits: EUR ${fmt(approvedTotal)}`);

// Cross-check with ledger credits
console.log(`\nLedger total credits: EUR ${fmt(totalCredits)}`);
console.log(`Deposits sheet total (approved): EUR ${fmt(approvedTotal)}`);
const depDiff = totalCredits - approvedTotal;
console.log(`Difference: EUR ${fmt(depDiff)} (should be ~66 = refund credit)`);

// =========================================================
// 3. INVOICES ANALYSIS
// =========================================================
console.log("\n" + "=".repeat(70));
console.log("3. INVOICES ANALYSIS");
console.log("=".repeat(70));

const invSheet = parseSheet("Invoices");
let totalGross = 0, totalCommission = 0, totalPayment = 0, totalOutstanding = 0;
let paidCount = 0, unpaidCount = 0, partialCount = 0;
const unpaidInvoices = [];

for (const r of invSheet) {
  const invNo = r["Invoice no"];
  if (!invNo) continue;
  const gross = num(r["gross amount"]);
  const commission = num(r["commission"]);
  const payment = num(r["payment amount"]);
  const outstanding = num(r["outstanding amount"]);
  
  totalGross += gross;
  totalCommission += commission;
  totalPayment += payment;
  totalOutstanding += outstanding;
  
  if (Math.abs(outstanding) < 0.01) {
    paidCount++;
  } else if (payment === 0 || payment < 0) {
    unpaidCount++;
    unpaidInvoices.push({ invNo, date: excelDateToStr(r["date"]), gross, payment, outstanding });
  } else {
    partialCount++;
    unpaidInvoices.push({ invNo, date: excelDateToStr(r["date"]), gross, payment, outstanding });
  }
}

console.log(`\nTotal invoices: ${paidCount + unpaidCount + partialCount}`);
console.log(`  Fully paid:   ${paidCount}`);
console.log(`  Unpaid:        ${unpaidCount}`);
console.log(`  Partial:       ${partialCount}`);
console.log(`\nTotal Gross Amount:     EUR ${fmt(totalGross)}`);
console.log(`Total Commission:       EUR ${fmt(totalCommission)}`);
console.log(`Total Payments Made:    EUR ${fmt(totalPayment)}`);
console.log(`Total Outstanding:      EUR ${fmt(totalOutstanding)}`);

console.log(`\nUnpaid / Partially Paid Invoices:`);
console.log(`${"INV#".padEnd(10)} ${"Date".padEnd(12)} ${"Gross".padStart(12)} ${"Paid".padStart(12)} ${"Outstanding".padStart(12)}`);
console.log("-".repeat(58));
for (const inv of unpaidInvoices) {
  console.log(`${String(inv.invNo).padEnd(10)} ${inv.date.padEnd(12)} ${fmt(inv.gross).padStart(12)} ${fmt(inv.payment).padStart(12)} ${fmt(inv.outstanding).padStart(12)}`);
}

// =========================================================
// 4. BELMONEY TRANSFERS SUMMARY
// =========================================================
console.log("\n" + "=".repeat(70));
console.log("4. BELMONEY TRANSFERS SUMMARY");
console.log("=".repeat(70));

const trSheet = parseSheet("BelmoneyTransfers");
let paidTx = 0, cancelTx = 0, voidTx = 0, processingTx = 0;
let paidEur = 0, cancelEur = 0, voidEur = 0, processingEur = 0;

for (const r of trSheet) {
  const status = String(r["Status"] || "").trim();
  const amount = num(r["Amount"]);
  if (!status || amount === 0) continue;
  
  switch (status) {
    case "Paid":
      paidTx++; paidEur += amount; break;
    case "Cancel":
      cancelTx++; cancelEur += amount; break;
    case "Void":
      voidTx++; voidEur += amount; break;
    case "Processing Payment":
      processingTx++; processingEur += amount; break;
  }
}

console.log(`\nTransfer Status Breakdown:`);
console.log(`  Paid:               ${paidTx} transfers, EUR ${fmt(paidEur)}`);
console.log(`  Cancelled:          ${cancelTx} transfers, EUR ${fmt(cancelEur)}`);
console.log(`  Void:               ${voidTx} transfers, EUR ${fmt(voidEur)}`);
console.log(`  Processing Payment: ${processingTx} transfers, EUR ${fmt(processingEur)}`);
console.log(`  TOTAL:              ${paidTx + cancelTx + voidTx + processingTx} transfers, EUR ${fmt(paidEur + cancelEur + voidEur + processingEur)}`);

// Date range
const dates = trSheet.map(r => r["Date"]).filter(Boolean).map(excelDateToStr).sort();
console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}`);

// =========================================================
// 5. MYBANK-GBP ANALYSIS
// =========================================================
console.log("\n" + "=".repeat(70));
console.log("5. MYBANK-GBP (Your GBP Bank Account)");
console.log("=".repeat(70));

const gbpSheet = parseSheet("MyBank-GBP");
let totalGbp = 0, gbpCount = 0;
const gbpEntries = [];

for (const r of gbpSheet) {
  const amount = num(r["Amount"]);
  if (amount <= 0) continue;
  gbpCount++;
  totalGbp += amount;
  
  const date = excelDateToStr(r["Date"]);
  const ref = String(r["Reference"] || "");
  // Unnamed columns for EUR amount and FX rate
  const keys = Object.keys(r);
  const eurAmount = num(r[keys[keys.length - 2]]); // second to last
  const fxRate = num(r[keys[keys.length - 1]]);     // last
  
  gbpEntries.push({ date, amount, ref, eurAmount, fxRate });
}

console.log(`\nTotal GBP credits: ${gbpCount} payments`);
console.log(`Total GBP received: GBP ${fmt(totalGbp)}`);

const totalEurMapped = gbpEntries.reduce((s, e) => s + e.eurAmount, 0);
console.log(`Total EUR mapped:   EUR ${fmt(totalEurMapped)}`);

console.log(`\nGBP Bank Credits from Belmoney SA:`);
console.log(`${"Date".padEnd(12)} ${"GBP".padStart(12)} ${"EUR".padStart(12)} ${"FX Rate".padStart(10)} Reference`);
console.log("-".repeat(75));
for (const e of gbpEntries) {
  const eurStr = e.eurAmount > 0 ? fmt(e.eurAmount) : "-";
  const fxStr = e.fxRate > 0 ? e.fxRate.toFixed(4) : "-";
  const refShort = e.ref.replace(/FXB\w+\s+/, "").trim();
  console.log(`${e.date.padEnd(12)} ${fmt(e.amount).padStart(12)} ${eurStr.padStart(12)} ${fxStr.padStart(10)} ${refShort}`);
}

// =========================================================
// 6. RECONCILIATION: Deposits → GBP Bank
// =========================================================
console.log("\n" + "=".repeat(70));
console.log("6. RECONCILIATION: iBanFirst Deposits → GBP Bank Credits");
console.log("=".repeat(70));

// Match GBP entries (with EUR amounts) to Deposits
const depList = [];
for (const r of depSheet) {
  const vals = Object.values(r);
  const id = vals[0];
  const amount = num(vals[4]);
  const status = String(vals[5] || "");
  const account = String(vals[2] || "");
  const desc = String(vals[3] || "");
  if (amount <= 0 || !status || status === "Voided") continue;
  depList.push({ id, amount, status, account, desc, date: excelDateToStr(vals[1]) });
}

console.log(`\nDeposit → GBP Matching (by EUR amount):`);
let matched = 0, unmatched = 0;
const matchedDepIds = new Set();

for (const gbp of gbpEntries) {
  if (gbp.eurAmount <= 0) {
    console.log(`  ${gbp.date}: GBP ${fmt(gbp.amount)} → EUR amount not recorded → UNMATCHED`);
    unmatched++;
    continue;
  }
  // Find matching deposit
  const dep = depList.find(d => Math.abs(d.amount - gbp.eurAmount) < 0.02 && !matchedDepIds.has(d.id));
  if (dep) {
    matchedDepIds.add(dep.id);
    const avgRate = gbp.eurAmount / gbp.amount;
    console.log(`  ${gbp.date}: GBP ${fmt(gbp.amount)} ← EUR ${fmt(gbp.eurAmount)} (DEP.${dep.id}, rate ${avgRate.toFixed(4)}) ✓`);
    matched++;
  } else {
    console.log(`  ${gbp.date}: GBP ${fmt(gbp.amount)} ← EUR ${fmt(gbp.eurAmount)} → NO MATCHING DEPOSIT ✗`);
    unmatched++;
  }
}
console.log(`\nMatched: ${matched}, Unmatched: ${unmatched}`);

// =========================================================
// 7. OVERALL RECONCILIATION SUMMARY
// =========================================================
console.log("\n" + "=".repeat(70));
console.log("7. OVERALL RECONCILIATION SUMMARY");
console.log("=".repeat(70));

console.log(`
MONEY IN (Credits to Belmoney Account):
  iBanFirst EUR deposits:     EUR ${fmt(ibanFirstTotal)}
  KBC/Belmoney SA deposits:   EUR ${fmt(belmoneyTotal)}
  Refund credit:              EUR 66.00
  VOID reversal (net zero):   EUR 0.00
                              ─────────────────
  Total Credits:              EUR ${fmt(totalCredits)}

MONEY OUT (Debits from Belmoney Account):
  Invoice debits:             EUR ${fmt(totalDebits - (voidCount > 0 ? 13500.55 : 0))}
  VOID DEP debit:             EUR ${fmt(voidCount > 0 ? 13500.55 : 0)}
                              ─────────────────
  Total Debits:               EUR ${fmt(totalDebits)}

BELMONEY ACCOUNT BALANCE:     EUR ${fmt(totalCredits - totalDebits)}
                              (Negative = you owe Belmoney)

OUTSTANDING INVOICES:         EUR ${fmt(totalOutstanding)}
                              (Invoices not yet settled)

TRANSFERS PROCESSED:          ${paidTx} paid transfers
                              EUR ${fmt(paidEur)} total send amount

GBP RECEIVED IN BANK:        GBP ${fmt(totalGbp)}
                              (from ${gbpCount} payments by Belmoney SA)
`);

// Key insight: relationship between deposits and GBP
console.log("KEY RELATIONSHIPS:");
console.log("─".repeat(50));
console.log(`1. EUR deposited to Belmoney from iBanFirst:    EUR ${fmt(ibanFirstTotal)}`);
console.log(`2. EUR invoiced (transfers paid out):           EUR ${fmt(totalGross)}`);
console.log(`3. EUR outstanding (unpaid invoices):           EUR ${fmt(totalOutstanding)}`);
console.log(`4. GBP received from Belmoney in your bank:    GBP ${fmt(totalGbp)}`);
console.log(`5. EUR equivalent of GBP (mapped entries):     EUR ${fmt(totalEurMapped)}`);
console.log(`6. Belmoney account balance:                   EUR ${fmt(calcBal)}`);
console.log(`\nThe ${fmt(Math.abs(calcBal))} EUR deficit represents invoiced amounts`);
console.log(`not yet covered by deposits. Combined with the outstanding`);
console.log(`invoices (EUR ${fmt(totalOutstanding)}), there are EUR ${fmt(totalOutstanding + Math.abs(calcBal))} in`);
console.log(`total obligations still pending.`);
