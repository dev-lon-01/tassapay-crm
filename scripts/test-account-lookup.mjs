/**
 * Verifies tayoEthiopiaLookup against real Tayo.
 * Requires TAYO_BASIC_AUTH in .env.local.
 *
 * Run: node scripts/test-account-lookup.mjs
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { tayoEthiopiaLookupForTests } from "./_account-lookup-test-shim.mjs";

async function expect(label, fn) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
  } catch (e) {
    console.error(`  ✗  ${label}: ${e.message}`);
    process.exitCode = 1;
  }
}

await expect("CBE + valid account → success with name", async () => {
  const r = await tayoEthiopiaLookupForTests({
    country: "ET",
    methodType: "bank",
    methodCode: "CBE",
    accountNumber: "1000188695168",
  });
  if (r.status !== "success") throw new Error(`status=${r.status}`);
  if (!r.accountName) throw new Error("accountName empty");
  console.log(`     name="${r.accountName}"`);
});

await expect("CBE + invalid account → failed (not error)", async () => {
  const r = await tayoEthiopiaLookupForTests({
    country: "ET",
    methodType: "bank",
    methodCode: "CBE",
    accountNumber: "1000188699999",
  });
  if (r.status !== "failed") throw new Error(`status=${r.status}`);
  if (r.accountName) throw new Error(`accountName should be null, got "${r.accountName}"`);
});

console.log(process.exitCode === 1 ? "\nFAILED\n" : "\nAll checks passed.\n");
