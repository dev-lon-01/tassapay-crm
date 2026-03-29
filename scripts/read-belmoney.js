const XLSX = require("xlsx");
const path = require("path");

const file = path.resolve(__dirname, "../data/Belmoney_Analysis.xlsx");
const wb = XLSX.readFile(file);

wb.SheetNames.forEach((name) => {
  console.log(`\n=== SHEET: ${name} ===`);
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  data.forEach((row) => {
    console.log(row.map((c) => String(c)).join(" | "));
  });
});
