const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('data/TassaPay-FullReport.xlsx');
const n = v => Number(v) || 0;

const t1 = XLSX.utils.sheet_to_json(wb.Sheets['FromVendor'], { defval: '' });
const t3Raw = XLSX.utils.sheet_to_json(wb.Sheets['Volume-InBound'], { defval: '' });

// Excel serial date to readable string
function exDate(v) {
  if (typeof v === 'number' && v > 40000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  return String(v);
}

// Apply EOD March 12 cutoff to Tab 3 (match Tab 1 & 2 date range)
const CUTOFF = '2026-03-12 23:59:59';
const t3 = t3Raw.filter(r => exDate(r.CREATION_TIME_UTC) <= CUTOFF);
console.log('Tab 3 rows: ' + t3Raw.length + ' total, ' + t3.length + ' within cutoff (EOD 12 Mar)');
console.log('Tab 3 rows after cutoff: ' + (t3Raw.length - t3.length));
console.log();

// Build set of payment IDs in Tab 1
const t1Ids = new Set(
  t1.filter(r => r.type === 'PAYMENT').map(r => r.transaction_id)
);

// CSV-safe value
function csvVal(v) {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Find missing payments (in Tab 3 but not Tab 1)
const missing = t3.filter(r => !t1Ids.has(r.PAYMENT_ID));

const header = [
  'PAYMENT_ID', 'MERCHANT_PAYMENT_ID', 'AMOUNT', 'CURRENCY',
  'PAYMENT_REFERENCE', 'CREATION_TIME', 'STATUS',
  'INSTITUTION_ID', 'IS_REFUNDED', 'AMOUNT_REFUNDED'
];

const csvRows = [header.join(',')];
missing.forEach(r => {
  csvRows.push([
    r.PAYMENT_ID,
    r.MERCHANT_PAYMENT_ID,
    r.AMOUNT,
    r.CURRENCY,
    r.PAYMENT_REFERENCE,
    exDate(r.CREATION_TIME_UTC),
    r.STATUS,
    r.INSTITUTION_ID,
    r.IS_REFUNDED,
    r.AMOUNT_REFUNDED
  ].map(csvVal).join(','));
});

fs.writeFileSync('data/missing-payments.csv', csvRows.join('\n'), 'utf8');

// Summary
const fmt = v => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log('Written ' + missing.length + ' rows to data/missing-payments.csv');
console.log('Total missing amount: GBP ' + fmt(missing.reduce((s, r) => s + n(r.AMOUNT), 0)));
console.log();

// By status
const byStatus = {};
missing.forEach(r => {
  const s = r.STATUS;
  if (!byStatus[s]) byStatus[s] = { count: 0, amount: 0 };
  byStatus[s].count++;
  byStatus[s].amount += n(r.AMOUNT);
});
console.log('Breakdown by status:');
Object.entries(byStatus).forEach(([s, v]) => {
  console.log('  ' + s + ': ' + v.count + ' rows, GBP ' + fmt(v.amount));
});

// Date range
const dates = missing.map(r => exDate(r.CREATION_TIME_UTC)).sort();
console.log();
console.log('Date range: ' + dates[0] + ' to ' + dates[dates.length - 1]);

// Full balance check
console.log();
console.log('=== BALANCE CHECK ===');
const t1Payments = t1.filter(r => r.type === 'PAYMENT').reduce((s, r) => s + n(r.amount), 0);
const t1Refunds = t1.filter(r => r.type === 'REFUND').reduce((s, r) => s + Math.abs(n(r.amount)), 0);
const t1Payouts = t1.filter(r => r.type === 'PAYOUT').reduce((s, r) => s + Math.abs(n(r.amount)), 0);
const t1Balance = n(t1[t1.length - 1]['Expected Balance']);
console.log('Tab 1: ' + t1.filter(r => r.type === 'PAYMENT').length + ' payments = GBP ' + fmt(t1Payments));
console.log('Tab 1: ' + t1.filter(r => r.type === 'REFUND').length + ' refunds = GBP ' + fmt(t1Refunds));
console.log('Tab 1: ' + t1.filter(r => r.type === 'PAYOUT').length + ' payouts = GBP ' + fmt(t1Payouts));
console.log('Tab 1 Expected Balance: GBP ' + fmt(t1Balance));
console.log();
const t3Inbound = t3.reduce((s, r) => s + n(r.AMOUNT), 0);
const t3Refunds = t3.reduce((s, r) => s + n(r.AMOUNT_REFUNDED), 0);
console.log('Tab 3 (cutoff): ' + t3.length + ' payments = GBP ' + fmt(t3Inbound));
console.log('Tab 3 refunds: GBP ' + fmt(t3Refunds));
console.log('Tab 2 payouts: GBP ' + fmt(t1Payouts));
const correctBalance = t3Inbound - t3Refunds - t1Payouts;
console.log('Correct Balance: GBP ' + fmt(correctBalance));
console.log('Difference: GBP ' + fmt(correctBalance - t1Balance));

// Sample rows
console.log();
console.log('=== Sample rows (first 5) ===');
missing.slice(0, 5).forEach(r => {
  console.log(
    exDate(r.CREATION_TIME_UTC) + ' | ' +
    r.PAYMENT_ID + ' | ' +
    r.MERCHANT_PAYMENT_ID + ' | GBP ' +
    n(r.AMOUNT).toFixed(2) + ' | ' +
    r.STATUS
  );
});
