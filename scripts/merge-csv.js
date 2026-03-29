/**
 * Merges all CSV files in data/csv-merge into a single CSV file.
 * Deduplicates by PAYMENT_ID (first column) — keeps the first occurrence.
 * Output: data/csv-merge/merged.csv
 */

const fs = require("fs");
const path = require("path");

const dir = path.resolve(__dirname, "../data/csv-merge");
const outFile = path.join(dir, "merged.csv");

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".csv") && f !== "merged.csv")
  .sort();

if (!files.length) {
  console.log("No CSV files found in data/csv-merge");
  process.exit(0);
}

console.log(`Found ${files.length} CSV files to merge:`);
files.forEach((f) => console.log(`  - ${f}`));

const out = fs.createWriteStream(outFile, { encoding: "utf-8" });
let header = null;
let totalRows = 0;
let duplicates = 0;
const seen = new Set();

for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), "utf-8").trimEnd();
  const lines = content.split(/\r?\n/);

  if (!header) {
    header = lines[0];
    out.write(header + "\n");
  }

  // Process data rows (skip header)
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const paymentId = line.split(",")[0];
    if (seen.has(paymentId)) {
      duplicates++;
      continue;
    }
    seen.add(paymentId);
    out.write(line + "\n");
    totalRows++;
  }
}

out.end();
console.log(`\nMerged ${totalRows} unique rows into ${outFile}`);
if (duplicates) console.log(`Skipped ${duplicates} duplicate PAYMENT_IDs`);
