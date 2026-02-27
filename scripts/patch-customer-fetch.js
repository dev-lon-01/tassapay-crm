const fs = require("fs");
const p = "c:/Data/work/tassapay-crm/app/customer/[id]/page.tsx";
let c = fs.readFileSync(p, "utf8");

// Add import after normalizePhone import
c = c.replace(
  'import { normalizePhone } from "@/src/lib/phoneUtils";',
  'import { normalizePhone } from "@/src/lib/phoneUtils";\nimport { apiFetch } from "@/src/lib/apiFetch";'
);

// Replace fetch( for API calls with apiFetch(
c = c.replace(/fetch\(`\/api\//g, "apiFetch(`/api/");
c = c.replace(/fetch\("\/api\//g, 'apiFetch("/api/');

fs.writeFileSync(p, c, "utf8");
console.log("Done. apiFetch import count:", (c.match(/apiFetch/g) || []).length);
