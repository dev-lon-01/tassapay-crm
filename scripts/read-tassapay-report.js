const XLSX = require("xlsx");
const path = require("path");

const wb = XLSX.readFile(path.join(__dirname, "..", "data", "TassaPay-FullReport.xlsx"));

function num(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function fmt(v) { return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function excelDateToStr(v) {
  if (typeof v === "number" && v > 40000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return String(v);
}

console.log("Sheets:", wb.SheetNames.join(", "), "\n");

wb.SheetNames.forEach((name, idx) => {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  console.log("=".repeat(70));
  console.log(`TAB ${idx + 1}: "${name}" (${rows.length} rows)`);
  console.log("=".repeat(70));

  if (rows.length === 0) return;

  const cols = Object.keys(rows[0]);
  console.log("Columns:", cols.join(" | "));

  // Print first 5 rows
  console.log("\n--- First 5 rows ---");
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`Row ${i + 1}:`, cols.map(c => `${c}=${r[c]}`).join(" | "));
  });

  // Print last 5 rows
  console.log("\n--- Last 5 rows ---");
  rows.slice(-5).forEach((r, i) => {
    console.log(`Row ${rows.length - 4 + i}:`, cols.map(c => `${c}=${r[c]}`).join(" | "));
  });

  // Column sums for numeric columns
  console.log("\n--- Column sums (numeric only) ---");
  for (const col of cols) {
    let sum = 0, count = 0;
    for (const r of rows) {
      const v = num(r[col]);
      if (v !== 0) { sum += v; count++; }
    }
    if (count > 0 && isNaN(Number(col))) {
      console.log(`  ${col}: sum=${fmt(sum)}, non-zero count=${count}`);
    }
  }

  // Balance column check
  const balCol = cols.find(c => /balance/i.test(c));
  if (balCol) {
    const lastBal = rows.filter(r => num(r[balCol]) !== 0).pop();
    if (lastBal) console.log(`\n  Last balance (${balCol}): ${fmt(num(lastBal[balCol]))}`);
  }

  // Status breakdown if exists
  const statusCol = cols.find(c => /status/i.test(c));
  const amtCol = cols.find(c => /amount/i.test(c));
  if (statusCol) {
    const st = {};
    for (const r of rows) {
      const s = String(r[statusCol]).trim();
      if (!s) continue;
      if (!st[s]) st[s] = { count: 0, amount: 0 };
      st[s].count++;
      if (amtCol) st[s].amount += num(r[amtCol]);
    }
    console.log(`\n  Status breakdown:`);
    for (const [s, v] of Object.entries(st)) {
      console.log(`    ${s}: ${v.count} rows${amtCol ? `, amount sum=${fmt(v.amount)}` : ""}`);
    }
  }

  console.log("\n");
});
