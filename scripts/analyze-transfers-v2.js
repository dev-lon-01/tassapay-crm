const fs = require('fs');
const XLSX = require('xlsx');

const n = v => { const s = String(v).replace(/,/g, ''); return Number(s) || 0; };
const fmt = v => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Parse CSV ──
const lines = fs.readFileSync('data/Belmoney_Analysis_V2 - Sheet6 (1).csv', 'utf8').split('\n').filter(l => l.trim());
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const parts = []; let cur = '', inQ = false;
  for (const ch of lines[i]) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  rows.push({ id: parts[0], date: parts[1], status: parts[2], amount: n(parts[8]), payAmount: n(parts[9]) });
}

// Normalize CSV date M/D/YYYY → YYYY-MM-DD
function csvNorm(d) {
  const p = d.split('/');
  return p[2] + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
}

const paidProc = rows.filter(r => r.status === 'Paid' || r.status === 'Processing Payment');

// Group transfers by normalized date
const trByDate = {};
paidProc.forEach(r => {
  const d = csvNorm(r.date);
  if (!trByDate[d]) trByDate[d] = { c: 0, a: 0 };
  trByDate[d].c++;
  trByDate[d].a += r.amount;
});

console.log('=== CSV TRANSFERS ===');
console.log('Total rows: ' + rows.length);
console.log('Paid: ' + rows.filter(r => r.status === 'Paid').length);
console.log('Processing: ' + rows.filter(r => r.status === 'Processing Payment').length);
console.log('Void: ' + rows.filter(r => r.status === 'Void').length + ' (EUR ' + fmt(rows.filter(r => r.status === 'Void').reduce((s, r) => s + r.amount, 0)) + ')');
console.log('Cancel: ' + rows.filter(r => r.status === 'Cancel').length + ' (EUR ' + fmt(rows.filter(r => r.status === 'Cancel').reduce((s, r) => s + r.amount, 0)) + ')');
console.log('Created: ' + rows.filter(r => r.status === 'Created').length);
console.log('Paid+Processing total: ' + paidProc.length + ' = EUR ' + fmt(paidProc.reduce((s, r) => s + r.amount, 0)));
console.log();

// ── Load invoices ──
const wb = XLSX.readFile('data/Belmoney_Analysis_V2.xlsx');
const inv = XLSX.utils.sheet_to_json(wb.Sheets['Invoices'], { defval: '' });

// Classify invoices: string date vs serial number
const stringDated = [];  // dates parsed as M/D/YYYY strings
const serialDated = [];  // dates stored as Excel serial numbers
inv.forEach(r => {
  const raw = r.date;
  const g = n(r['gross amount']);
  const comm = n(r['commission']);
  if (typeof raw === 'string' && raw.match(/\//)) {
    const p = raw.split('/');
    const norm = p[2] + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
    stringDated.push({ inv: r['Invoice no'], date: norm, raw, gross: g, comm });
  } else {
    const d = new Date(Math.round((Number(raw) - 25569) * 86400000));
    const norm = d.toISOString().slice(0, 10);
    serialDated.push({ inv: r['Invoice no'], serial: Number(raw), date: norm, gross: g, comm });
  }
});

console.log('=== INVOICES ===');
console.log('Total: ' + inv.length + ' invoices');
console.log('String-dated: ' + stringDated.length + ' = EUR ' + fmt(stringDated.reduce((s, r) => s + r.gross, 0)));
console.log('Serial-dated: ' + serialDated.length + ' = EUR ' + fmt(serialDated.reduce((s, r) => s + r.gross, 0)));
console.log('Grand total gross: EUR ' + fmt(inv.reduce((s, r) => s + n(r['gross amount']), 0)));
console.log();

// ── Analyze string-dated invoices (reliable dates) ──
console.log('=== STRING-DATED INVOICES (reliable M/D/YYYY) ===');
// Group by date, summing gross
const invByDate = {};
stringDated.forEach(r => {
  if (!invByDate[r.date]) invByDate[r.date] = { invoices: [], gross: 0, comm: 0 };
  invByDate[r.date].invoices.push(r);
  invByDate[r.date].gross += r.gross;
  invByDate[r.date].comm += r.comm;
});

let totalMatchedInvGross = 0, totalMatchedTrAmt = 0, totalMatchedCount = 0;
let totalMatchedComm = 0;

console.log('Date           | Inv Gross    | Transfers     | # Txns | Diff (fees)  | Comm');
console.log('-'.repeat(90));

Object.keys(invByDate).sort().forEach(d => {
  const ig = invByDate[d];
  const tr = trByDate[d] || { c: 0, a: 0 };
  const diff = ig.gross - tr.a;
  const marker = tr.c === 0 ? ' ⚠ no txns' : '';
  console.log(
    d + '  | ' +
    ('EUR ' + fmt(ig.gross)).padStart(12) + ' | ' +
    ('EUR ' + fmt(tr.a)).padStart(13) + ' | ' +
    String(tr.c).padStart(6) + ' | ' +
    ('EUR ' + fmt(diff)).padStart(12) + ' | ' +
    fmt(ig.comm) + marker
  );
  totalMatchedInvGross += ig.gross;
  totalMatchedTrAmt += tr.a;
  totalMatchedCount += tr.c;
  totalMatchedComm += ig.comm;
});

const totalMatchedDiff = totalMatchedInvGross - totalMatchedTrAmt;
console.log('-'.repeat(90));
console.log(
  'TOTAL          | ' +
  ('EUR ' + fmt(totalMatchedInvGross)).padStart(12) + ' | ' +
  ('EUR ' + fmt(totalMatchedTrAmt)).padStart(13) + ' | ' +
  String(totalMatchedCount).padStart(6) + ' | ' +
  ('EUR ' + fmt(totalMatchedDiff)).padStart(12) + ' | ' +
  fmt(totalMatchedComm)
);
console.log();

// Fee calc for string-dated
const strTxnFees = totalMatchedCount * 1.15;
console.log('String-dated fee breakdown:');
console.log('  Total difference (inv - transfers): EUR ' + fmt(totalMatchedDiff));
console.log('  TXN fees (' + totalMatchedCount + ' × 1.15):        EUR ' + fmt(strTxnFees));
console.log('  Commission:                         EUR ' + fmt(totalMatchedComm));
console.log('  Remainder (platform fees):          EUR ' + fmt(totalMatchedDiff - strTxnFees - totalMatchedComm));
console.log();

// ── Analyze serial-dated invoices ──
console.log('=== SERIAL-DATED INVOICES (Excel serial numbers) ===');
// These come in patterns: X/2 (single) and X/3 (pairs)
const bySerial = {};
serialDated.forEach(r => {
  if (!bySerial[r.date]) bySerial[r.date] = [];
  bySerial[r.date].push(r);
});

let serialTotal = 0;
Object.keys(bySerial).sort().forEach(d => {
  const items = bySerial[d];
  const total = items.reduce((s, r) => s + r.gross, 0);
  serialTotal += total;
  const invNos = items.map(r => 'INV ' + r.inv + ' (' + fmt(r.gross) + ')').join(' + ');
  console.log('  ' + d + ': ' + invNos + ' = EUR ' + fmt(total));
});
console.log('  Serial-dated total: EUR ' + fmt(serialTotal));
console.log();

// ── Check: which CSV transfer dates have NO invoice at all? ──
const allInvDates = new Set([
  ...stringDated.map(r => r.date),
  ...serialDated.map(r => r.date)
]);

console.log('=== UNINVOICED TRANSFER DATES ===');
let uninvoicedAmt = 0, uninvoicedCount = 0;
Object.keys(trByDate).sort().forEach(d => {
  if (!allInvDates.has(d)) {
    const tr = trByDate[d];
    console.log('  ' + d + ': ' + tr.c + ' transfers, EUR ' + fmt(tr.a));
    uninvoicedAmt += tr.a;
    uninvoicedCount += tr.c;
  }
});
console.log('  Total uninvoiced: ' + uninvoicedCount + ' transfers, EUR ' + fmt(uninvoicedAmt));
console.log();

// ── OVERALL RECONCILIATION ──
const totalTrAmt = paidProc.reduce((s, r) => s + r.amount, 0);
const totalInvGross = inv.reduce((s, r) => s + n(r['gross amount']), 0);
const totalComm = inv.reduce((s, r) => s + n(r['commission']), 0);

console.log('=== OVERALL RECONCILIATION ===');
console.log('A. Deposits into Belmoney:       EUR 187,388.57');
console.log('B. Invoice gross (all 80):       EUR ' + fmt(totalInvGross));
console.log('C. Transfer payouts (CSV):       EUR ' + fmt(totalTrAmt));
console.log('D. Difference (B - C):           EUR ' + fmt(totalInvGross - totalTrAmt));
console.log();
console.log('If invoices = transfers + fees, then fees = B - C = EUR ' + fmt(totalInvGross - totalTrAmt));
console.log('But B < C, meaning transfers EXCEED invoices by EUR ' + fmt(totalTrAmt - totalInvGross));
console.log('This means EUR ' + fmt(totalTrAmt - totalInvGross) + ' of transfers are not yet invoiced.');
console.log();

// Uninvoiced = total transfers - only-matched transfers
console.log('Breakdown of the gap:');
console.log('  Mar 19 transfers (no invoice): EUR ' + fmt((trByDate['2026-03-19'] || {a:0}).a) + ' (' + (trByDate['2026-03-19'] || {c:0}).c + ' txns)');
console.log('  Other uninvoiced dates:        EUR ' + fmt(uninvoicedAmt - (trByDate['2026-03-19'] || {a:0}).a));
console.log();

// Expected fees calculation
console.log('=== EXPECTED FEES (using totals) ===');
console.log('Platform fees (3 months × 999):  EUR ' + fmt(3 * 999));
console.log('TXN fees (' + paidProc.length + ' × 1.15):        EUR ' + fmt(paidProc.length * 1.15));
console.log('Commission:                       EUR ' + fmt(totalComm));
const expectedFees = 3 * 999 + paidProc.length * 1.15 + totalComm;
console.log('Total expected fees:              EUR ' + fmt(expectedFees));
console.log();
console.log('Expected invoices = transfers + fees = EUR ' + fmt(totalTrAmt + expectedFees));
console.log('Actual invoice gross:                 EUR ' + fmt(totalInvGross));
console.log('Discrepancy:                          EUR ' + fmt(totalInvGross - (totalTrAmt + expectedFees)));
console.log();

// What should you expect from Belmoney?
console.log('=== WHAT YOU SHOULD EXPECT FROM BELMONEY ===');
const deposited = 187388.57;
const outstanding = deposited - totalInvGross;
console.log('EUR deposited:                   ' + fmt(deposited));
console.log('EUR invoiced (charged):          ' + fmt(totalInvGross));
console.log('EUR remaining in account:        ' + fmt(outstanding));
console.log('  (portal 19 Mar balance:        EUR 4,132.86)');
console.log();
console.log('Outstanding invoices (unpaid by you): EUR ' + fmt(deposited - totalInvGross) + ' approx');
console.log();
const fxRate = 0.854;
console.log('At FX rate ' + fxRate + ':');
console.log('  Remaining EUR ' + fmt(outstanding) + ' ≈ GBP ' + fmt(outstanding * fxRate));
console.log('  GBP already received:          GBP 149,822.88');
console.log('  Total expected GBP:            GBP ' + fmt(149822.88 + outstanding * fxRate));
