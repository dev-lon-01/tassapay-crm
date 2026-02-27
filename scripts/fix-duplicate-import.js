const fs = require("fs");
const p = "c:/Data/work/tassapay-crm/app/customer/[id]/page.tsx";
let c = fs.readFileSync(p, "utf8");
const line = 'import { apiFetch } from "@/src/lib/apiFetch";\n';
const idx = c.indexOf(line);
if (idx !== -1) {
  const second = c.indexOf(line, idx + line.length);
  if (second !== -1) {
    c = c.slice(0, second) + c.slice(second + line.length);
    fs.writeFileSync(p, c, "utf8");
    console.log("Removed duplicate import");
  } else {
    console.log("No duplicate found");
  }
} else {
  console.log("Import not found");
}
