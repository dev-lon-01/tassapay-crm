const fs = require("fs");

function patch(filePath, addReqParam) {
  let c = fs.readFileSync(filePath, "utf8");

  // Add requireAuth import after the db import
  c = c.replace(
    /^(import \{ pool \} from "@\/src\/lib\/db";)/m,
    '$1\nimport { requireAuth } from "@/src/lib/auth";'
  );

  if (addReqParam) {
    // Change GET() → GET(req: NextRequest), need NextRequest in import too
    c = c.replace(
      /^import \{ NextResponse \} from "next\/server";/m,
      'import { NextRequest, NextResponse } from "next/server";'
    );
    c = c.replace(/^export async function GET\(\)/m, "export async function GET(req: NextRequest)");
  }

  // Insert auth guard after every exported async function opening (before try {)
  c = c.replace(
    /(export async function \w+\([^)]*\) \{)\n  try \{/g,
    (match, sig, offset, str) => {
      // Determine req variable name: look for req or _req in the signature
      const reqVar = sig.includes("_req") ? "_req" : "req";
      return `${sig}\n  const auth = requireAuth(${reqVar});\n  if (auth instanceof NextResponse) return auth;\n  try {`;
    }
  );

  // Also handle multi-line signatures ending with ') {' + newline + '  try {'
  c = c.replace(
    /(\) \{)\n  try \{/g,
    (m, close, offset, str) => {
      // Only replace if not already patched
      const preceding = str.substring(0, offset);
      if (preceding.match(/export async function \w+[^;{]*$/)) {
        return `${close}\n  const auth = requireAuth(_req);\n  if (auth instanceof NextResponse) return auth;\n  try {`;
      }
      return m;
    }
  );

  fs.writeFileSync(filePath, c, "utf8");
  console.log("Patched:", filePath);
}

patch("c:/Data/work/tassapay-crm/app/api/customers/[customerId]/route.ts", false);
patch("c:/Data/work/tassapay-crm/app/api/templates/[id]/route.ts", false);
patch("c:/Data/work/tassapay-crm/app/api/transfers/[customerId]/route.ts", false);
