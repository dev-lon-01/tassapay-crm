const fs = require('fs');
const XLSX = require('xlsx');

const n = v => { const s = String(v).replace(/,/g, ''); return Number(s) || 0; };
const fmt = v => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Parse CSV with proper quoting
const lines = fs.readFileSync('data/Belmoney_Analysis_V2 - Sheet6 (1).csv', 'utf8').split('\n').filter(l => l.trim());
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const parts = [];
  let cur = '', inQ = false;
  for (const ch of lines[i]) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { parts.push(cur); cur = ''; }
    else { cur += ch; }
  }
  parts.push(cur);
  rows.push({ id: parts[0], date: parts[1], status: parts[2], agencyRef: parts[4], amount: n(parts[8]), payAmount: n(parts[9]) });
}

console.log('Total transfers in CSV: ' + rows.length);
console.log('Date range: ' + rows[rows.length - 1].date + ' to ' + rows[0].date);
console.log();

// Status breakdown
const byStatus = {};
rows.forEach(r => {
  if (!byStatus[r.status]) byStatus[r.status] = { c: 0, a: 0 };
  byStatus[r.status].c++;
  byStatus[r.status].a += r.amount;
});
console.log('Status breakdown:');
Object.entries(byStatus).forEach(([s, v]) => console.log('  ' + s + ': ' + v.c + ' transfers, EUR ' + fmt(v.a)));

// By date
const byDate = {};
rows.forEach(r => {
  if (!byDate[r.date]) byDate[r.date] = { c: 0, a: 0 };
  byDate[r.date].c++;
  byDate[r.date].a += r.amount;
});
console.log('\nBy date:');
Object.entries(byDate).sort(([a], [b]) => {
  const pa = a.split('/'), pb = b.split('/');
  return (pa[2] + pa[0].padStart(2, '0') + pa[1].padStart(2, '0')).localeCompare(pb[2] + pb[0].padStart(2, '0') + pb[1].padStart(2, '0'));
}).forEach(([d, v]) => console.log('  ' + d + ': ' + v.c + ' transfers, EUR ' + fmt(v.a)));

const csvTotal = rows.reduce((s, r) => s + r.amount, 0);
console.log('\nCSV grand total: EUR ' + fmt(csvTotal));

// Load invoices from Excel
const wb = XLSX.readFile('data/Belmoney_Analysis_V2.xlsx');
const inv = XLSX.utils.sheet_to_json(wb.Sheets['Invoices'], { defval: '' });
const totalGross = inv.reduce((s, r) => s + n(r['gross amount']), 0);
const totalComm = inv.reduce((s, r) => s + n(r['commission']), 0);

const paidAndProc = rows.filter(r => r.status === 'Paid' || r.status === 'Processing Payment');
const trAmount = paidAndProc.reduce((s, r) => s + r.amount, 0);

console.log('\n=== COST BREAKDOWN ===');
console.log('Transfers (Paid+Processing): ' + paidAndProc.length + ' = EUR ' + fmt(trAmount));
console.log('Invoice gross total:          EUR ' + fmt(totalGross));
console.log('Difference (all fees):        EUR ' + fmt(totalGross - trAmount));
console.log();

const diff = totalGross - trAmount;
const txnFees = paidAndProc.length * 1.15;
console.log('TXN fees (' + paidAndProc.length + ' x 1.15):   EUR ' + fmt(txnFees));
console.log('Remaining after TXN fees:     EUR ' + fmt(diff - txnFees));
console.log('→ Platform fee months:        ' + ((diff - txnFees) / 999).toFixed(1));
console.log();

// Normalize dates
function normD(v) {
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  if (typeof v === 'number' && v > 40000) {
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }
  return s;
}

// CSV dates in normalized form
const csvDates = new Set(Object.keys(byDate).map(d => {
  const p = d.split('/');
  return '20' + p[2].slice(-2) + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
}));

// Normalize CSV row dates for matching
function normCsvDate(d) {
  const p = d.split('/');
  return '20' + p[2].slice(-2) + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
}

// Coverage: which invoices have matching CSV dates
console.log('=== COVERAGE CHECK ===');
let coveredGross = 0, uncoveredGross = 0, coveredInv = 0, uncoveredInv = 0;
inv.forEach(r => {
  const d = normD(r.date);
  const g = n(r['gross amount']);
  if (csvDates.has(d)) {
    coveredGross += g; coveredInv++;
  } else {
    uncoveredGross += g; uncoveredInv++;
    console.log('  NOT in CSV: INV ' + r['Invoice no'] + ' | ' + d + ' | EUR ' + fmt(g));
  }
});
console.log();
console.log('Invoices matched by CSV dates: ' + coveredInv + ' / ' + inv.length + ' = EUR ' + fmt(coveredGross));
console.log('Invoices NOT in CSV:           ' + uncoveredInv + ' = EUR ' + fmt(uncoveredGross));
console.log();

// Get the set of invoice dates for filtering transfers
const invDates = new Set(inv.map(r => normD(r.date)));
// Latest invoice date
const latestInvDate = [...invDates].sort().pop();
console.log('Latest invoice date: ' + latestInvDate);

// Filter transfers to ONLY invoiced dates (Paid+Processing)
const matchedTransfers = paidAndProc.filter(r => invDates.has(normCsvDate(r.date)));
const matchedTrAmount = matchedTransfers.reduce((s, r) => s + r.amount, 0);

// Uninvoiced transfers (dates with no invoice)
const unmatchedTransfers = paidAndProc.filter(r => !invDates.has(normCsvDate(r.date)));
const unmatchedTrAmount = unmatchedTransfers.reduce((s, r) => s + r.amount, 0);

// Group uninvoiced by date
const unmatchedByDate = {};
unmatchedTransfers.forEach(r => {
  if (!unmatchedByDate[r.date]) unmatchedByDate[r.date] = { c: 0, a: 0 };
  unmatchedByDate[r.date].c++;
  unmatchedByDate[r.date].a += r.amount;
});

console.log('\nTransfers on invoiced dates:   ' + matchedTransfers.length + ' = EUR ' + fmt(matchedTrAmount));
console.log('Transfers NOT YET invoiced:    ' + unmatchedTransfers.length + ' = EUR ' + fmt(unmatchedTrAmount));
if (Object.keys(unmatchedByDate).length) {
  console.log('  Uninvoiced dates:');
  Object.entries(unmatchedByDate).forEach(([d, v]) =>
    console.log('    ' + d + ': ' + v.c + ' transfers, EUR ' + fmt(v.a)));
}
console.log();
console.log('=== FEE ANALYSIS (date-matched: invoiced dates only) ===');
console.log('Invoice gross (matched):      EUR ' + fmt(coveredGross));
console.log('Transfer amounts (matched):   EUR ' + fmt(matchedTrAmount));
const feeDiff = coveredGross - matchedTrAmount;
console.log('Difference (= all fees):      EUR ' + fmt(feeDiff));
const matchedTxn = matchedTransfers.length * 1.15;
console.log('TXN fees (' + matchedTransfers.length + ' x 1.15):  EUR ' + fmt(matchedTxn));
const afterTxn = feeDiff - matchedTxn;
console.log('After TXN fees:               EUR ' + fmt(afterTxn));
console.log('Commission (from invoices):   EUR ' + fmt(totalComm));
const afterComm = afterTxn - totalComm;
console.log('After commission:             EUR ' + fmt(afterComm));
console.log('→ Platform fee months:        ' + (afterComm / 999).toFixed(2));
console.log();

// Now check if we can do per-invoice verification
console.log('=== PER-INVOICE VERIFICATION (sample) ===');
// Group transfers by date
const trByDate = {};
paidAndProc.forEach(r => {
  const d = normCsvDate(r.date);
  if (!trByDate[d]) trByDate[d] = { c: 0, a: 0 };
  trByDate[d].c++;
  trByDate[d].a += r.amount;
});

// For each invoice, calculate expected gross = transfers + count*1.15 + platform(?) + commission
inv.forEach(r => {
  const d = normD(r.date);
  const g = n(r['gross amount']);
  const comm = n(r['commission']);
  const tr = trByDate[d];
  if (!tr) return; // skip unmatched
  const expectedFees = tr.c * 1.15;
  const impliedPlatform = g - tr.a - expectedFees - comm;
  if (Math.abs(impliedPlatform) > 0.02) { // only show non-zero
    console.log('INV ' + r['Invoice no'] + ' | ' + d + ' | gross ' + fmt(g) +
      ' | ' + tr.c + ' txns ' + fmt(tr.a) +
      ' | txnFee ' + fmt(expectedFees) +
      ' | comm ' + fmt(comm) +
      ' | platform ' + fmt(impliedPlatform));
  }
});
console.log();
console.log('=== OVERALL SUMMARY ===');
console.log('Total EUR deposited:          EUR 187,388.57 (from ledger)');
console.log('Total invoice gross:          EUR ' + fmt(totalGross));
console.log('Transfer payouts (all):       EUR ' + fmt(trAmount));
console.log('Of which invoiced:            EUR ' + fmt(matchedTrAmount));
console.log('Of which not yet invoiced:    EUR ' + fmt(unmatchedTrAmount));
console.log('Total fees (matched):         EUR ' + fmt(feeDiff));
console.log('  TXN fees:                   EUR ' + fmt(matchedTxn));
console.log('  Commission:                 EUR ' + fmt(totalComm));
console.log('  Platform:                   EUR ' + fmt(afterComm));
console.log('Void+Cancel (excluded):       EUR ' + fmt(rows.filter(r => r.status === 'Void' || r.status === 'Cancel').reduce((s, r) => s + r.amount, 0)));
