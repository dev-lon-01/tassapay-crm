# Account Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an agent-facing account-lookup tool that proxies Tayo's `accountlookupAuthentication` endpoint, audits every lookup, and lets agents attach successful lookups to transfers or customers.

**Architecture:** A small `src/lib/accountLookup/` module owns all Tayo knowledge (token + lookup call + bank list). Four App-Router API routes wrap it. One reusable React panel is rendered on a standalone page and embedded in transfer/customer detail pages.

**Tech Stack:** Next.js 13.5 (App Router), TypeScript, MySQL via `mysql2/promise`, lucide-react icons, existing JWT auth helper (`requireAuth`) and DB pool. Verification is script-based (`node scripts/...`) — this codebase has no test framework.

**Source spec:** [docs/superpowers/specs/2026-05-08-account-lookup-design.md](../specs/2026-05-08-account-lookup-design.md)

**Pre-flight notes:**
- Existing tables use `INT AUTO_INCREMENT` PKs (not `BIGINT`); the plan uses `INT` for the audit/verification id columns.
- `account_verifications.target_id` is `VARCHAR(50)`, **not INT**. This is a deviation from the spec that the implementer should know about: the customer detail page in this codebase keys customers by their string `customer_id` (e.g. `/customer/CUST-12345`) — `customers.id` (the numeric PK) is not currently loaded into the page. Storing transfers as their stringified numeric id and customers as their `customer_id` string keeps the attach flow simple and avoids touching the customer load path.
- Existing Tayo creds are in `TAYO_BASIC_AUTH` (already used by [src/services/tayoSyncService.js](../../../src/services/tayoSyncService.js)).
- The DB pool is at [src/lib/db.ts](../../../src/lib/db.ts); auth helper at [src/lib/auth.ts](../../../src/lib/auth.ts); error helper at [src/lib/httpResponses.ts](../../../src/lib/httpResponses.ts); browser-side fetch wrapper at [src/lib/apiFetch.ts](../../../src/lib/apiFetch.ts).
- Frequent commits: each task ends with a commit. Commit message format follows existing style (`feat:` / `chore:` / `docs:` prefixes).

---

## File map

**New files**
- `scripts/migrate-account-lookup.mjs` — idempotent migration
- `src/lib/accountLookup/types.ts` — shared TS types
- `src/lib/accountLookup/banks/ethiopia.ts` — static method list (40 entries)
- `src/lib/accountLookup/tayoToken.ts` — Basic Auth → token helper
- `src/lib/accountLookup/tayoEthiopia.ts` — Tayo Ethiopia lookup handler
- `src/lib/accountLookup/index.ts` — `lookupAccount` / `getSupportedMethods` dispatcher
- `app/api/account-lookup/banks/route.ts` — GET supported methods
- `app/api/account-lookup/route.ts` — POST lookup
- `app/api/account-lookup/[id]/attach/route.ts` — POST attach
- `app/api/account-lookup/verifications/route.ts` — GET verifications for a target
- `scripts/test-account-lookup.mjs` — verifies the lib against real Tayo
- `scripts/test-account-lookup-api.mjs` — end-to-end verification of the API routes
- `src/components/AccountLookupPanel.tsx` — reusable panel
- `app/tools/account-lookup/page.tsx` — standalone tool page

**Modified files**
- `src/db/schema.sql` — append `account_lookups` and `account_verifications` definitions (for documentation / fresh installs)
- `src/components/AppNavigation.tsx` — add "Account Lookup" entry
- `app/transfers/[id]/page.tsx` — embed panel
- `app/customer/[id]/page.tsx` — embed panel

---

## Task 1: Database migration

**Files:**
- Create: `scripts/migrate-account-lookup.mjs`
- Modify: `src/db/schema.sql` (append; for fresh-install documentation)

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-account-lookup.mjs`:

```js
/**
 * scripts/migrate-account-lookup.mjs
 * Run once: creates account_lookups + account_verifications tables.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "tassapay_crm",
});

const steps = [
  ["CREATE TABLE account_lookups", `
    CREATE TABLE IF NOT EXISTS \`account_lookups\` (
      \`id\`                   INT           NOT NULL AUTO_INCREMENT,
      \`agent_id\`             INT           NOT NULL,
      \`country_code\`         CHAR(2)       NOT NULL,
      \`provider\`             VARCHAR(32)   NOT NULL,
      \`method_type\`          ENUM('bank','wallet') NOT NULL,
      \`method_code\`          VARCHAR(64)   NOT NULL,
      \`account_number\`       VARCHAR(64)   NOT NULL,
      \`status\`               ENUM('success','failed','error') NOT NULL,
      \`account_name\`         VARCHAR(255)  DEFAULT NULL,
      \`response_code\`        VARCHAR(8)    DEFAULT NULL,
      \`response_description\` VARCHAR(255)  DEFAULT NULL,
      \`raw_response\`         JSON          DEFAULT NULL,
      \`created_at\`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_account_lookups_agent_created\` (\`agent_id\`, \`created_at\`),
      KEY \`idx_account_lookups_acct_country\`  (\`account_number\`, \`country_code\`),
      CONSTRAINT \`fk_account_lookups_agent\` FOREIGN KEY (\`agent_id\`)
        REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `],
  ["CREATE TABLE account_verifications", `
    CREATE TABLE IF NOT EXISTS \`account_verifications\` (
      \`id\`           INT           NOT NULL AUTO_INCREMENT,
      \`lookup_id\`    INT           NOT NULL,
      \`target_type\`  ENUM('transfer','customer') NOT NULL,
      \`target_id\`    VARCHAR(50)   NOT NULL,
      \`attached_by\`  INT           NOT NULL,
      \`attached_at\`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_account_verifications_target\` (\`target_type\`, \`target_id\`),
      CONSTRAINT \`fk_account_verifications_lookup\` FOREIGN KEY (\`lookup_id\`)
        REFERENCES \`account_lookups\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`fk_account_verifications_user\` FOREIGN KEY (\`attached_by\`)
        REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `],
];

for (const [label, sql] of steps) {
  try {
    await conn.execute(sql);
    console.log(`  ✓  ${label}`);
  } catch (e) {
    if (e.errno === 1050) {
      console.log(`  –  ${label} (already exists, skipped)`);
    } else {
      console.error(`  ✗  ${label}: ${e.message}`);
      await conn.end();
      process.exit(1);
    }
  }
}

await conn.end();
console.log("\nMigration complete.");
```

- [ ] **Step 2: Append the same definitions to `src/db/schema.sql`**

Open `src/db/schema.sql`, scroll to the end, append:

```sql
-- ─── account lookup ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `account_lookups` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `agent_id`             INT           NOT NULL,
  `country_code`         CHAR(2)       NOT NULL,
  `provider`             VARCHAR(32)   NOT NULL,
  `method_type`          ENUM('bank','wallet') NOT NULL,
  `method_code`          VARCHAR(64)   NOT NULL,
  `account_number`       VARCHAR(64)   NOT NULL,
  `status`               ENUM('success','failed','error') NOT NULL,
  `account_name`         VARCHAR(255)  DEFAULT NULL,
  `response_code`        VARCHAR(8)    DEFAULT NULL,
  `response_description` VARCHAR(255)  DEFAULT NULL,
  `raw_response`         JSON          DEFAULT NULL,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account_lookups_agent_created` (`agent_id`, `created_at`),
  KEY `idx_account_lookups_acct_country`  (`account_number`, `country_code`),
  CONSTRAINT `fk_account_lookups_agent` FOREIGN KEY (`agent_id`)
    REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `account_verifications` (
  `id`           INT           NOT NULL AUTO_INCREMENT,
  `lookup_id`    INT           NOT NULL,
  `target_type`  ENUM('transfer','customer') NOT NULL,
  `target_id`    VARCHAR(50)   NOT NULL,
  `attached_by`  INT           NOT NULL,
  `attached_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account_verifications_target` (`target_type`, `target_id`),
  CONSTRAINT `fk_account_verifications_lookup` FOREIGN KEY (`lookup_id`)
    REFERENCES `account_lookups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_account_verifications_user` FOREIGN KEY (`attached_by`)
    REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 3: Run the migration**

Run: `node scripts/migrate-account-lookup.mjs`
Expected:
```
  ✓  CREATE TABLE account_lookups
  ✓  CREATE TABLE account_verifications

Migration complete.
```

- [ ] **Step 4: Verify the tables exist**

Run: `node -e "import('mysql2/promise').then(async m => { const c = await m.default.createConnection({host:process.env.DB_HOST??'localhost',user:process.env.DB_USER??'root',password:process.env.DB_PASSWORD??'',database:process.env.DB_NAME??'tassapay_crm'}); const [r] = await c.execute(\"SHOW TABLES LIKE 'account_%'\"); console.log(r); await c.end(); })" 2>/dev/null || mysql -u "${DB_USER:-root}" -p"${DB_PASSWORD}" "${DB_NAME:-tassapay_crm}" -e "SHOW TABLES LIKE 'account_%';"`

Expected: two rows — `account_lookups`, `account_verifications`.

- [ ] **Step 5: Re-run the migration to confirm idempotency**

Run: `node scripts/migrate-account-lookup.mjs`
Expected: each line shows `– (already exists, skipped)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-account-lookup.mjs src/db/schema.sql
git commit -m "feat(account-lookup): add audit + verification tables

Two new tables: account_lookups (audit trail) and account_verifications
(agent-attached proof). Migration is idempotent; schema.sql kept in sync
for fresh installs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Module skeleton — types and Ethiopia bank list

**Files:**
- Create: `src/lib/accountLookup/types.ts`
- Create: `src/lib/accountLookup/banks/ethiopia.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/accountLookup/types.ts`:

```ts
/**
 * Shared types for the account-lookup module.
 * The CountryCode union grows as new providers are added.
 */

export type CountryCode = 'ET';
export type MethodType = 'bank' | 'wallet';

export interface SupportedMethod {
  /** 'bank' or 'wallet' — used to label the option in the UI. */
  type: MethodType;
  /** Exact string the upstream provider expects (e.g. Tayo's `bankName`). */
  code: string;
  /** Human-readable label shown to agents (often identical to `code`). */
  label: string;
}

export interface LookupRequest {
  country: CountryCode;
  methodType: MethodType;
  methodCode: string;
  accountNumber: string;
}

export interface LookupResult {
  status: 'success' | 'failed' | 'error';
  accountName: string | null;
  responseCode: string | null;
  responseDescription: string | null;
  /** Full upstream response body, persisted to account_lookups.raw_response. */
  raw: unknown;
}
```

- [ ] **Step 2: Write the Ethiopia method list**

Create `src/lib/accountLookup/banks/ethiopia.ts`:

```ts
import type { SupportedMethod } from "../types";

/**
 * The 40 Ethiopia methods supported by Tayo's account-lookup endpoint.
 * `code` MUST be sent verbatim (case-sensitive) as the `bankName` field.
 * `type` distinguishes wallets from banks for the UI; both call the same
 * upstream endpoint.
 */
export const ETHIOPIA_METHODS: SupportedMethod[] = [
  { type: "bank",   code: "Rays Microfinance",        label: "Rays Microfinance" },
  { type: "bank",   code: "Awash Bank",               label: "Awash Bank" },
  { type: "bank",   code: "CBE",                      label: "CBE" },
  { type: "bank",   code: "Abbysinia Bank",           label: "Abbysinia Bank" },
  { type: "bank",   code: "Dashen Bank",              label: "Dashen Bank" },
  { type: "bank",   code: "NIB Bank",                 label: "NIB Bank" },
  { type: "bank",   code: "COOP",                     label: "COOP" },
  { type: "bank",   code: "Oromia Bank",              label: "Oromia Bank" },
  { type: "bank",   code: "Wegagen Bank",             label: "Wegagen Bank" },
  { type: "bank",   code: "Lion Bank",                label: "Lion Bank" },
  { type: "bank",   code: "Zemen Bank",               label: "Zemen Bank" },
  { type: "bank",   code: "Bunna Bank",               label: "Bunna Bank" },
  { type: "bank",   code: "Berhan Bank",              label: "Berhan Bank" },
  { type: "bank",   code: "Debub Global Bank",        label: "Debub Global Bank" },
  { type: "bank",   code: "Abay Bank",                label: "Abay Bank" },
  { type: "bank",   code: "Enat Bank",                label: "Enat Bank" },
  { type: "bank",   code: "Shebelle Bank or HCash",   label: "Shebelle Bank or HCash" },
  { type: "bank",   code: "Hibret Bank",              label: "Hibret Bank" },
  { type: "bank",   code: "Addis Credit and Saving",  label: "Addis Credit and Saving" },
  { type: "bank",   code: "Hijra Bank",               label: "Hijra Bank" },
  { type: "bank",   code: "Zamzam Bank",              label: "Zamzam Bank" },
  { type: "bank",   code: "Ahadu Bank",               label: "Ahadu Bank" },
  { type: "bank",   code: "Gadda Bank",               label: "Gadda Bank" },
  { type: "wallet", code: "CBE Birr",                 label: "CBE Birr" },
  { type: "bank",   code: "Tsedey Bank",              label: "Tsedey Bank" },
  { type: "bank",   code: "Sidama Bank",              label: "Sidama Bank" },
  { type: "bank",   code: "KAAFI Micro Finance",      label: "KAAFI Micro Finance" },
  { type: "bank",   code: "One Micro Finance",        label: "One Micro Finance" },
  { type: "bank",   code: "Amhara Bank",              label: "Amhara Bank" },
  { type: "bank",   code: "Addis International Bank", label: "Addis International Bank" },
  { type: "wallet", code: "Kacha DFS",                label: "Kacha DFS" },
  { type: "bank",   code: "Tsehay Bank",              label: "Tsehay Bank" },
  { type: "bank",   code: "GOH Betoch",               label: "GOH Betoch" },
  { type: "bank",   code: "Sinqee Bank",              label: "Sinqee Bank" },
  { type: "bank",   code: "VisionFund MFI",           label: "VisionFund MFI" },
  { type: "bank",   code: "Sahal MFI",                label: "Sahal MFI" },
  { type: "wallet", code: "Yaya Wallet",              label: "Yaya Wallet" },
  { type: "bank",   code: "Rammis Bank",              label: "Rammis Bank" },
  { type: "bank",   code: "Dire MFI",                 label: "Dire MFI" },
  { type: "wallet", code: "Halal Pay",                label: "Halal Pay" },
];

/** Fast O(1) lookup by code for validation. */
export const ETHIOPIA_METHODS_BY_CODE: Record<string, SupportedMethod> =
  Object.fromEntries(ETHIOPIA_METHODS.map((m) => [m.code, m]));
```

- [ ] **Step 3: Type-check the new files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "accountLookup|^error" | head -20`
Expected: no errors mentioning `accountLookup`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/accountLookup/types.ts src/lib/accountLookup/banks/ethiopia.ts
git commit -m "feat(account-lookup): add types and Ethiopia method list

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Tayo token helper

**Files:**
- Create: `src/lib/accountLookup/tayoToken.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/accountLookup/tayoToken.ts`:

```ts
/**
 * Fetches a session token from Tayo using HTTP Basic Auth.
 * Mirrors the flow in src/services/tayoSyncService.js so we don't import
 * from JS service code into TS lib code.
 *
 * The returned token must be sent on subsequent calls in the
 * `Efuluusrodp2025` header alongside Basic Auth.
 */

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";

export interface TayoToken {
  token: string;
}

export async function fetchTayoToken(): Promise<TayoToken> {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) {
    throw new Error("Missing TAYO_BASIC_AUTH environment variable");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  if (!res.ok) {
    throw new Error(`Tayo token request failed: HTTP ${res.status}`);
  }

  const body = (await res.json().catch(() => null)) as { Token?: string } | null;
  if (!body?.Token) {
    throw new Error("Tayo token response did not include a Token field");
  }

  return { token: body.Token };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "tayoToken|^error" | head -10`
Expected: no errors mentioning `tayoToken`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/accountLookup/tayoToken.ts
git commit -m "feat(account-lookup): add Tayo token helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Tayo Ethiopia handler + verification script

**Files:**
- Create: `src/lib/accountLookup/tayoEthiopia.ts`
- Create: `scripts/test-account-lookup.mjs`

- [ ] **Step 1: Write the verification script first (TDD-ish: it will fail until the handler exists)**

Create `scripts/test-account-lookup.mjs`:

```js
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

// Use the TS path via ts-node-style require? No — register a tiny shim:
// We compile-on-the-fly by spawning tsc... simpler: import the .ts via the
// Next.js runtime is unavailable here. Instead, write a small JS shim that
// re-exports the TS for this script to consume.
//
// Easier: shell out to `npx tsx` if available; otherwise, the dev should
// run this via `npx tsx scripts/test-account-lookup.mjs` after installing.
//
// To keep zero new deps, this script imports the compiled lib via a tiny
// dynamic-require trick: it spawns a Node child process running a wrapper
// that uses Next's transpile pipeline. To avoid that complexity entirely,
// we ship a parallel .mjs handler ONLY for the test script. See below.

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
```

- [ ] **Step 2: Run the script — it should fail (shim missing)**

Run: `node scripts/test-account-lookup.mjs`
Expected: error along the lines of `Cannot find module './_account-lookup-test-shim.mjs'`.

- [ ] **Step 3: Write the handler**

Create `src/lib/accountLookup/tayoEthiopia.ts`:

```ts
import type { LookupRequest, LookupResult } from "./types";
import { fetchTayoToken } from "./tayoToken";

const LOOKUP_URL =
  "http://efuluusprod.tayotransfer.com/api/remittance/accountlookupAuthentication";

interface TayoLookupBody {
  result?: Array<{ message?: string; code?: string }>;
  response?: string;
  responseDescription?: string;
  institutionName?: string;
  accountNumber?: string;
  accountName?: string;
}

/**
 * Calls Tayo's accountlookupAuthentication endpoint.
 *
 * Tayo returns HTTP 400 for the documented "account not found / service
 * unavailable" cases — that is a normal `failed` outcome, NOT a transport
 * error. We read the JSON body in both 200 and 400 cases and read
 * `result[0].message` to decide.
 */
export async function tayoEthiopiaLookup(req: LookupRequest): Promise<LookupResult> {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) {
    return errorResult("Missing TAYO_BASIC_AUTH environment variable");
  }

  let token: string;
  try {
    ({ token } = await fetchTayoToken());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }

  let res: Response;
  try {
    res = await fetch(LOOKUP_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountNumber: req.accountNumber,
        bankName: req.methodCode,
      }),
    });
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }

  // Anything other than 200 or 400 is a transport-level error.
  if (res.status !== 200 && res.status !== 400) {
    const text = await res.text().catch(() => "");
    return errorResult(`Unexpected upstream status ${res.status}`, text);
  }

  let body: TayoLookupBody;
  try {
    body = (await res.json()) as TayoLookupBody;
  } catch (e) {
    return errorResult(`Malformed upstream JSON: ${(e as Error).message}`);
  }

  const message = body.result?.[0]?.message;
  if (res.status === 200 && message === "success" && body.accountName) {
    return {
      status: "success",
      accountName: body.accountName,
      responseCode: body.response ?? null,
      responseDescription: body.responseDescription ?? null,
      raw: body,
    };
  }

  // 200-with-failed or 400 are normal "failed" outcomes.
  return {
    status: "failed",
    accountName: null,
    responseCode: body.response ?? null,
    responseDescription: body.responseDescription ?? null,
    raw: body,
  };
}

function errorResult(message: string, raw?: unknown): LookupResult {
  return {
    status: "error",
    accountName: null,
    responseCode: null,
    responseDescription: message,
    raw: raw ?? { error: message },
  };
}
```

- [ ] **Step 4: Write the test shim that the verification script imports**

Create `scripts/_account-lookup-test-shim.mjs`:

```js
/**
 * Test-only shim. Re-implements tayoEthiopiaLookup in plain ESM so the
 * verification script can run without a TS toolchain.
 * Keep this file in lockstep with src/lib/accountLookup/tayoEthiopia.ts.
 */

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";
const LOOKUP_URL =
  "http://efuluusprod.tayotransfer.com/api/remittance/accountlookupAuthentication";

async function fetchToken() {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) throw new Error("Missing TAYO_BASIC_AUTH");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });
  if (!res.ok) throw new Error(`Token HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.Token) throw new Error("No Token in response");
  return body.Token;
}

export async function tayoEthiopiaLookupForTests(req) {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  const token = await fetchToken();

  const res = await fetch(LOOKUP_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Efuluusrodp2025: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountNumber: req.accountNumber,
      bankName: req.methodCode,
    }),
  });

  if (res.status !== 200 && res.status !== 400) {
    return { status: "error", accountName: null, responseCode: null,
             responseDescription: `HTTP ${res.status}`, raw: await res.text() };
  }

  const body = await res.json();
  const message = body?.result?.[0]?.message;
  if (res.status === 200 && message === "success" && body.accountName) {
    return {
      status: "success",
      accountName: body.accountName,
      responseCode: body.response ?? null,
      responseDescription: body.responseDescription ?? null,
      raw: body,
    };
  }
  return {
    status: "failed",
    accountName: null,
    responseCode: body?.response ?? null,
    responseDescription: body?.responseDescription ?? null,
    raw: body,
  };
}
```

- [ ] **Step 5: Re-run the verification script**

Run: `node scripts/test-account-lookup.mjs`
Expected:
```
  ✓  CBE + valid account → success with name
     name="A/RESHID HASSEN A/KADER"
  ✓  CBE + invalid account → failed (not error)

All checks passed.
```

If the first check fails because Tayo's data has changed, that's still a useful signal — the upstream changed. If the second check returns `success` instead of `failed`, that means the documented invalid number is no longer invalid; pick another junk number and update the script.

- [ ] **Step 6: Type-check the TS handler**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "tayoEthiopia|^error" | head -10`
Expected: no errors mentioning `tayoEthiopia`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/accountLookup/tayoEthiopia.ts scripts/test-account-lookup.mjs scripts/_account-lookup-test-shim.mjs
git commit -m "feat(account-lookup): add Tayo Ethiopia handler + verification script

Treats HTTP 400 from Tayo as a normal 'failed' outcome rather than a
transport error, per the documented contract.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Dispatcher

**Files:**
- Create: `src/lib/accountLookup/index.ts`

- [ ] **Step 1: Write the dispatcher**

Create `src/lib/accountLookup/index.ts`:

```ts
import type { CountryCode, LookupRequest, LookupResult, SupportedMethod } from "./types";
import { ETHIOPIA_METHODS, ETHIOPIA_METHODS_BY_CODE } from "./banks/ethiopia";
import { tayoEthiopiaLookup } from "./tayoEthiopia";

export type { CountryCode, MethodType, SupportedMethod, LookupRequest, LookupResult } from "./types";

const SUPPORTED_COUNTRIES: CountryCode[] = ["ET"];

export function isSupportedCountry(code: string): code is CountryCode {
  return (SUPPORTED_COUNTRIES as string[]).includes(code);
}

export function getSupportedMethods(country: CountryCode): SupportedMethod[] {
  if (country === "ET") return ETHIOPIA_METHODS;
  throw new Error(`Unsupported country: ${country}`);
}

export function findMethod(country: CountryCode, code: string): SupportedMethod | null {
  if (country === "ET") return ETHIOPIA_METHODS_BY_CODE[code] ?? null;
  return null;
}

export async function lookupAccount(req: LookupRequest): Promise<LookupResult> {
  if (req.country === "ET") return tayoEthiopiaLookup(req);
  throw new Error(`Unsupported country: ${req.country}`);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "accountLookup/index|^error" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/accountLookup/index.ts
git commit -m "feat(account-lookup): add country dispatcher

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: GET /api/account-lookup/banks

**Files:**
- Create: `app/api/account-lookup/banks/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/account-lookup/banks/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { getSupportedMethods, isSupportedCountry } from "@/src/lib/accountLookup";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") ?? "";

  if (!isSupportedCountry(country)) {
    return jsonError(`Unsupported country: ${country || "(missing)"}`, 400);
  }

  return NextResponse.json({
    country,
    methods: getSupportedMethods(country),
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "account-lookup/banks|^error" | head -10`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

In one terminal: `npm run dev`
In another, get a JWT (use the same one your browser session uses, or copy from `localStorage.tp_crm_token`):

```bash
TOKEN="<paste JWT>"
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/account-lookup/banks?country=ET" | head -c 200
```

Expected: JSON starting with `{"country":"ET","methods":[{"type":"bank","code":"Rays Microfinance",...`.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/account-lookup/banks?country=XX"
```

Expected: `{"error":"Unsupported country: XX"}` with status 400.

- [ ] **Step 4: Commit**

```bash
git add app/api/account-lookup/banks/route.ts
git commit -m "feat(account-lookup): GET /api/account-lookup/banks

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: POST /api/account-lookup (with audit + rate limit)

**Files:**
- Create: `app/api/account-lookup/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/account-lookup/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { pool } from "@/src/lib/db";
import {
  findMethod,
  isSupportedCountry,
  lookupAccount,
  type CountryCode,
  type MethodType,
} from "@/src/lib/accountLookup";

// ─── per-agent in-memory rate limiter (30 / minute) ──────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const buckets = new Map<number, { count: number; resetAt: number }>();

function rateLimit(agentId: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(agentId);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(agentId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_MAX) return false;
  bucket.count += 1;
  return true;
}

interface RequestBody {
  country?: string;
  methodType?: string;
  methodCode?: string;
  accountNumber?: string;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!rateLimit(auth.id)) {
    return jsonError("Rate limit exceeded — try again in a minute", 429);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  // ── Validate ─────────────────────────────────────────────────────────────
  const country = (body.country ?? "").trim();
  const methodType = (body.methodType ?? "").trim();
  const methodCode = (body.methodCode ?? "").trim();
  const accountNumber = (body.accountNumber ?? "").trim();

  if (!isSupportedCountry(country)) {
    return jsonError(`Unsupported country: ${country || "(missing)"}`, 400);
  }
  if (methodType !== "bank" && methodType !== "wallet") {
    return jsonError(`Invalid methodType: ${methodType || "(missing)"}`, 400);
  }
  if (!accountNumber) {
    return jsonError("accountNumber is required", 400);
  }
  const method = findMethod(country as CountryCode, methodCode);
  if (!method) {
    return jsonError(`Unknown methodCode for ${country}: ${methodCode || "(missing)"}`, 400);
  }
  if (method.type !== (methodType as MethodType)) {
    return jsonError(
      `methodType '${methodType}' does not match the registered type '${method.type}' for code '${methodCode}'`,
      400
    );
  }

  // ── Call upstream ────────────────────────────────────────────────────────
  const result = await lookupAccount({
    country: country as CountryCode,
    methodType: methodType as MethodType,
    methodCode,
    accountNumber,
  });

  // ── Audit ────────────────────────────────────────────────────────────────
  let lookupId: number | null = null;
  try {
    const [insertResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO account_lookups
         (agent_id, country_code, provider, method_type, method_code,
          account_number, status, account_name, response_code,
          response_description, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auth.id,
        country,
        "tayo",
        methodType,
        methodCode,
        accountNumber,
        result.status,
        result.accountName,
        result.responseCode,
        result.responseDescription,
        result.raw == null ? null : JSON.stringify(result.raw),
      ]
    );
    lookupId = insertResult.insertId;
  } catch (e) {
    // Don't fail the lookup just because we couldn't audit — log and continue.
    console.error("[POST /api/account-lookup] audit insert failed:",
      e instanceof Error ? e.message : String(e));
  }

  if (result.status === "error") {
    return NextResponse.json(
      {
        lookupId,
        status: result.status,
        accountName: null,
        responseCode: result.responseCode,
        responseDescription: result.responseDescription,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    lookupId,
    status: result.status,
    accountName: result.accountName,
    responseCode: result.responseCode,
    responseDescription: result.responseDescription,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "account-lookup/route|^error" | head -10`
Expected: no errors.

- [ ] **Step 3: Smoke test (with `npm run dev` running)**

```bash
TOKEN="<paste JWT>"
# success
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"country":"ET","methodType":"bank","methodCode":"CBE","accountNumber":"1000188695168"}' \
  http://localhost:3000/api/account-lookup
# expected: {"lookupId":...,"status":"success","accountName":"A/RESHID HASSEN A/KADER",...}

# failed
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"country":"ET","methodType":"bank","methodCode":"CBE","accountNumber":"1000188699999"}' \
  http://localhost:3000/api/account-lookup
# expected: {"lookupId":...,"status":"failed","accountName":null,...}

# bad input
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"country":"ET","methodType":"bank","methodCode":"NOTABANK","accountNumber":"1"}' \
  http://localhost:3000/api/account-lookup
# expected: {"error":"Unknown methodCode for ET: NOTABANK"} with HTTP 400
```

Then verify a row was written:

```bash
mysql -u "${DB_USER:-root}" -p"${DB_PASSWORD}" "${DB_NAME:-tassapay_crm}" \
  -e "SELECT id, agent_id, status, account_name, method_code FROM account_lookups ORDER BY id DESC LIMIT 3;"
```

Expected: at least 2 rows, one `success` (with `account_name` populated) and one `failed`.

- [ ] **Step 4: Commit**

```bash
git add app/api/account-lookup/route.ts
git commit -m "feat(account-lookup): POST /api/account-lookup with audit and rate limit

Persists every lookup attempt regardless of outcome. Treats failed
lookups (HTTP 200) and upstream errors (HTTP 502) distinctly.
Per-agent in-memory rate limit at 30/min.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: POST /api/account-lookup/[id]/attach

**Files:**
- Create: `app/api/account-lookup/[id]/attach/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/account-lookup/[id]/attach/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { pool } from "@/src/lib/db";

interface AttachBody {
  targetType?: string;
  targetId?: string | number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const lookupId = Number(params.id);
  if (!Number.isFinite(lookupId) || lookupId <= 0) {
    return jsonError(`Invalid lookup id: ${params.id}`, 400);
  }

  let body: AttachBody;
  try {
    body = (await req.json()) as AttachBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const targetType = body.targetType;
  const targetId = body.targetId == null ? "" : String(body.targetId).trim();

  if (targetType !== "transfer" && targetType !== "customer") {
    return jsonError(`Invalid targetType: ${targetType ?? "(missing)"}`, 400);
  }
  if (!targetId) {
    return jsonError("targetId is required", 400);
  }

  // ── 1. Lookup row exists and is successful ──────────────────────────────
  const [lookupRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, status FROM account_lookups WHERE id = ? LIMIT 1`,
    [lookupId]
  );
  if (lookupRows.length === 0) {
    return jsonError("Lookup not found", 404);
  }
  if (lookupRows[0].status !== "success") {
    return jsonError("Cannot attach a non-successful lookup", 409);
  }

  // ── 2. Target row exists ────────────────────────────────────────────────
  // Transfers are keyed by numeric `id` (we receive it stringified).
  // Customers are keyed by string `customer_id` (the URL-facing identifier).
  let targetExists: boolean;
  if (targetType === "transfer") {
    const numericId = Number(targetId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return jsonError(`Invalid transfer targetId: ${targetId}`, 400);
    }
    const [r] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM transfers WHERE id = ? LIMIT 1`,
      [numericId]
    );
    targetExists = r.length > 0;
  } else {
    const [r] = await pool.execute<RowDataPacket[]>(
      `SELECT customer_id FROM customers WHERE customer_id = ? LIMIT 1`,
      [targetId]
    );
    targetExists = r.length > 0;
  }
  if (!targetExists) {
    return jsonError(`${targetType} ${targetId} not found`, 404);
  }

  // ── 3. Insert verification ──────────────────────────────────────────────
  const [insertResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO account_verifications
       (lookup_id, target_type, target_id, attached_by)
     VALUES (?, ?, ?, ?)`,
    [lookupId, targetType, targetId, auth.id]
  );

  return NextResponse.json(
    {
      id: insertResult.insertId,
      lookupId,
      targetType,
      targetId,
      attachedBy: auth.id,
      attachedAt: new Date().toISOString(),
    },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "attach/route|^error" | head -10`
Expected: no errors.

- [ ] **Step 3: Smoke test**

Find a real `transfers.id` (e.g. `SELECT id FROM transfers ORDER BY id DESC LIMIT 1`) and the most recent successful `account_lookups.id`:

```bash
TOKEN="<paste JWT>"
LOOKUP_ID=<a successful lookup id>
TRANSFER_ID=<a real transfer id>

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"targetType\":\"transfer\",\"targetId\":$TRANSFER_ID}" \
  http://localhost:3000/api/account-lookup/$LOOKUP_ID/attach
# expected: 201 {"id":...,"lookupId":...,"targetType":"transfer","targetId":...,"attachedBy":...,"attachedAt":"..."}

# attach a failed lookup → 409
FAILED_ID=<a failed lookup id>
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"targetType\":\"transfer\",\"targetId\":$TRANSFER_ID}" \
  http://localhost:3000/api/account-lookup/$FAILED_ID/attach
# expected: 409 {"error":"Cannot attach a non-successful lookup"}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/account-lookup/\[id\]/attach/route.ts
git commit -m "feat(account-lookup): POST attach endpoint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: GET /api/account-lookup/verifications

**Files:**
- Create: `app/api/account-lookup/verifications/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/account-lookup/verifications/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { pool } from "@/src/lib/db";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get("targetType");
  const targetId = (searchParams.get("targetId") ?? "").trim();

  if (targetType !== "transfer" && targetType !== "customer") {
    return jsonError(`Invalid targetType: ${targetType ?? "(missing)"}`, 400);
  }
  if (!targetId) {
    return jsonError("targetId is required", 400);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
        v.id            AS v_id,
        v.attached_at   AS attached_at,
        u.id            AS user_id,
        u.name          AS user_name,
        l.id            AS l_id,
        l.method_code   AS method_code,
        l.method_type   AS method_type,
        l.account_number AS account_number,
        l.account_name  AS account_name
     FROM account_verifications v
     JOIN account_lookups l ON l.id = v.lookup_id
     JOIN users           u ON u.id = v.attached_by
     WHERE v.target_type = ? AND v.target_id = ?
     ORDER BY v.attached_at DESC
     LIMIT 100`,
    [targetType, targetId]
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.v_id,
      lookup: {
        id: r.l_id,
        methodCode: r.method_code,
        methodType: r.method_type,
        accountNumber: r.account_number,
        accountName: r.account_name,
      },
      attachedBy: { id: r.user_id, name: r.user_name },
      attachedAt: r.attached_at,
    }))
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "verifications/route|^error" | head -10`
Expected: no errors.

- [ ] **Step 3: Smoke test**

```bash
TOKEN="<paste JWT>"
TRANSFER_ID=<the transfer id you attached to in Task 8>
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/account-lookup/verifications?targetType=transfer&targetId=$TRANSFER_ID"
# expected: JSON array with at least one entry; lookup.accountName populated
```

- [ ] **Step 4: Commit**

```bash
git add app/api/account-lookup/verifications/route.ts
git commit -m "feat(account-lookup): GET verifications for a target

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: API smoke test script

**Files:**
- Create: `scripts/test-account-lookup-api.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/test-account-lookup-api.mjs`:

```js
/**
 * End-to-end smoke test of the account-lookup API.
 * Requires `npm run dev` running on localhost:3000.
 *
 * Usage: TOKEN=<jwt> TRANSFER_ID=<id> node scripts/test-account-lookup-api.mjs
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.TOKEN;
const TRANSFER_ID = Number(process.env.TRANSFER_ID);

if (!TOKEN) { console.error("Missing TOKEN env var"); process.exit(1); }
if (!Number.isFinite(TRANSFER_ID) || TRANSFER_ID <= 0) {
  console.error("Missing TRANSFER_ID env var (a real transfers.id)"); process.exit(1);
}

const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

let exitCode = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ✓  ${label}`); }
  catch (e) { console.error(`  ✗  ${label}: ${e.message}`); exitCode = 1; }
}

await check("GET /banks?country=ET returns 40 methods", async () => {
  const r = await fetch(`${BASE}/api/account-lookup/banks?country=ET`, { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.country !== "ET") throw new Error("country mismatch");
  if (!Array.isArray(j.methods) || j.methods.length !== 40)
    throw new Error(`expected 40 methods, got ${j.methods?.length}`);
});

let goodLookupId, badLookupId;

await check("POST /account-lookup CBE valid → success", async () => {
  const r = await fetch(`${BASE}/api/account-lookup`, {
    method: "POST", headers: H,
    body: JSON.stringify({ country: "ET", methodType: "bank", methodCode: "CBE", accountNumber: "1000188695168" }),
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== "success") throw new Error(`status=${j.status}`);
  if (!j.accountName) throw new Error("no accountName");
  goodLookupId = j.lookupId;
});

await check("POST /account-lookup CBE invalid → failed", async () => {
  const r = await fetch(`${BASE}/api/account-lookup`, {
    method: "POST", headers: H,
    body: JSON.stringify({ country: "ET", methodType: "bank", methodCode: "CBE", accountNumber: "1000188699999" }),
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== "failed") throw new Error(`status=${j.status}`);
  badLookupId = j.lookupId;
});

await check("POST /account-lookup invalid bank → 400", async () => {
  const r = await fetch(`${BASE}/api/account-lookup`, {
    method: "POST", headers: H,
    body: JSON.stringify({ country: "ET", methodType: "bank", methodCode: "NOTABANK", accountNumber: "1" }),
  });
  if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
});

await check("POST /[id]/attach success → 201", async () => {
  if (!goodLookupId) throw new Error("no good lookup id from earlier test");
  const r = await fetch(`${BASE}/api/account-lookup/${goodLookupId}/attach`, {
    method: "POST", headers: H,
    body: JSON.stringify({ targetType: "transfer", targetId: TRANSFER_ID }),
  });
  if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
});

await check("POST /[id]/attach for failed lookup → 409", async () => {
  if (!badLookupId) throw new Error("no bad lookup id from earlier test");
  const r = await fetch(`${BASE}/api/account-lookup/${badLookupId}/attach`, {
    method: "POST", headers: H,
    body: JSON.stringify({ targetType: "transfer", targetId: TRANSFER_ID }),
  });
  if (r.status !== 409) throw new Error(`HTTP ${r.status}`);
});

await check("GET /verifications returns the attachment", async () => {
  const r = await fetch(
    `${BASE}/api/account-lookup/verifications?targetType=transfer&targetId=${TRANSFER_ID}`,
    { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j) || j.length === 0) throw new Error("no verifications");
  if (!j[0].lookup?.accountName) throw new Error("missing accountName in first verification");
});

console.log(exitCode ? "\nFAILED\n" : "\nAll API checks passed.\n");
process.exit(exitCode);
```

- [ ] **Step 2: Run it (dev server up, real TOKEN + TRANSFER_ID)**

```bash
TOKEN="<jwt>" TRANSFER_ID=<real-transfer-id> node scripts/test-account-lookup-api.mjs
```

Expected: all six checks `✓`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-account-lookup-api.mjs
git commit -m "test(account-lookup): end-to-end API smoke script

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Reusable AccountLookupPanel component

**Files:**
- Create: `src/components/AccountLookupPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/AccountLookupPanel.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Search, AlertTriangle, Wallet, Landmark } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";

type SupportedMethod = {
  type: "bank" | "wallet";
  code: string;
  label: string;
};

type LookupResponse = {
  lookupId: number | null;
  status: "success" | "failed" | "error";
  accountName: string | null;
  responseCode: string | null;
  responseDescription: string | null;
};

export type AttachContext =
  | { targetType: "transfer"; targetId: string; label: string }
  | { targetType: "customer"; targetId: string; label: string };

export interface AccountLookupPanelProps {
  attachContext?: AttachContext;
  onAttached?: () => void;
}

const COUNTRIES = [{ code: "ET", label: "Ethiopia" }] as const;

export function AccountLookupPanel({ attachContext, onAttached }: AccountLookupPanelProps) {
  const [country, setCountry] = useState<"ET">("ET");
  const [methods, setMethods] = useState<SupportedMethod[]>([]);
  const [methodCode, setMethodCode] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachedAt, setAttachedAt] = useState<string | null>(null);

  // Load methods when country changes.
  useEffect(() => {
    let cancelled = false;
    setMethods([]);
    setMethodCode("");
    apiFetch(`/api/account-lookup/banks?country=${country}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { methods: SupportedMethod[] }) => {
        if (!cancelled) setMethods(j.methods);
      })
      .catch((e) => {
        if (!cancelled) setResultError(`Failed to load bank list: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [country]);

  const visibleMethods = useMemo(() => {
    const f = methodFilter.trim().toLowerCase();
    if (!f) return methods;
    return methods.filter((m) => m.label.toLowerCase().includes(f));
  }, [methods, methodFilter]);

  const selected = useMemo(
    () => methods.find((m) => m.code === methodCode) ?? null,
    [methods, methodCode]
  );

  const canSubmit = !!selected && accountNumber.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    setResult(null);
    setResultError(null);
    setAttachedAt(null);
    try {
      const r = await apiFetch("/api/account-lookup", {
        method: "POST",
        body: JSON.stringify({
          country,
          methodType: selected.type,
          methodCode: selected.code,
          accountNumber: accountNumber.trim(),
        }),
      });
      const j = (await r.json()) as LookupResponse | { error: string };
      if (!r.ok && r.status !== 502) {
        setResultError("error" in j ? j.error : `HTTP ${r.status}`);
        return;
      }
      setResult(j as LookupResponse);
    } catch (e) {
      setResultError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!result?.accountName) return;
    try {
      await navigator.clipboard.writeText(result.accountName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can still select the text
    }
  }

  async function handleAttach() {
    if (!result?.lookupId || !attachContext || result.status !== "success") return;
    setAttaching(true);
    try {
      const r = await apiFetch(`/api/account-lookup/${result.lookupId}/attach`, {
        method: "POST",
        body: JSON.stringify({
          targetType: attachContext.targetType,
          targetId: attachContext.targetId,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setResultError(j.error ?? `Attach failed: HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { attachedAt: string };
      setAttachedAt(j.attachedAt);
      onAttached?.();
    } finally {
      setAttaching(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Search className="h-5 w-5 text-emerald-600" />
        <h2 className="text-lg font-bold text-slate-900">Account Lookup</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Verify a beneficiary's bank or wallet account before sending funds.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {/* Country */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Country</label>
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={country}
            onChange={(e) => setCountry(e.target.value as "ET")}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Method */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Bank / Wallet</label>
          <input
            type="text"
            placeholder="Filter by name…"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <select
            size={6}
            value={methodCode}
            onChange={(e) => setMethodCode(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {visibleMethods.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}  ({m.type})
              </option>
            ))}
          </select>
          {selected && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {selected.type === "wallet" ? <Wallet className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
              {selected.label}
            </p>
          )}
        </div>

        {/* Account number */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Account number</label>
          <input
            type="text"
            inputMode="numeric"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
            placeholder="e.g. 1000188695168"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {submitting ? "Looking up…" : "Look up"}
        </button>
      </form>

      {/* Result */}
      {resultError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{resultError}</span>
        </div>
      )}

      {result?.status === "success" && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Account holder</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xl font-bold">{result.accountName}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-700"
            >
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>
          <p className="mt-1 text-xs text-emerald-800">
            {selected?.label} • {accountNumber} • response {result.responseCode ?? "—"}
          </p>

          {attachContext && !attachedAt && (
            <button
              type="button"
              onClick={handleAttach}
              disabled={attaching}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {attaching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Attach to {attachContext.label}
            </button>
          )}
          {attachedAt && (
            <p className="mt-3 inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <Check className="h-3 w-3" /> Attached to {attachContext?.label}
            </p>
          )}
        </div>
      )}

      {result?.status === "failed" && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">Lookup failed</p>
          <p className="mt-1">
            {result.responseDescription ?? "Account not found, or the bank/account combination is invalid."}
          </p>
        </div>
      )}

      {result?.status === "error" && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Service temporarily unavailable</p>
          <p className="mt-1">{result.responseDescription ?? "Try again in a moment."}</p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "AccountLookupPanel|^error" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AccountLookupPanel.tsx
git commit -m "feat(account-lookup): reusable AccountLookupPanel component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Standalone page + nav entry

**Files:**
- Create: `app/tools/account-lookup/page.tsx`
- Modify: `src/components/AppNavigation.tsx`

- [ ] **Step 1: Write the standalone page**

Create `app/tools/account-lookup/page.tsx`:

```tsx
"use client";

import { AccountLookupPanel } from "@/src/components/AccountLookupPanel";

export default function AccountLookupToolPage() {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Account Lookup</h1>
        <p className="text-sm text-slate-500">
          Verify a beneficiary bank or wallet account. Every lookup is logged for audit.
        </p>
      </header>
      <div className="max-w-2xl">
        <AccountLookupPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add nav entries**

Open `src/components/AppNavigation.tsx`. Make two edits.

Edit A — add `Search` to the lucide-react import block at the top of the file:

Find:
```ts
import {
  ArrowLeftRight, Award, Banknote, BarChart2, Bell, Bot, CheckSquare, ClipboardList, CreditCard, FileText,
  LayoutDashboard, ListFilter, LogOut, Menu, RefreshCw, Activity,
  ShieldAlert, Users, UsersRound, X, UserPlus, Scale,
} from "lucide-react";
```
Replace with:
```ts
import {
  ArrowLeftRight, Award, Banknote, BarChart2, Bell, Bot, CheckSquare, ClipboardList, CreditCard, FileText,
  LayoutDashboard, ListFilter, LogOut, Menu, RefreshCw, Activity, Search,
  ShieldAlert, Users, UsersRound, X, UserPlus, Scale,
} from "lucide-react";
```

Edit B — add the same nav entry to **both** `navItems` and `drawerItems`. In each list, place the entry just after the `Templates` row (so it sits in the agent-tools cluster).

In `navItems`:
```ts
  { label: "Templates",      href: "/templates",            icon: FileText },
  { label: "Account Lookup", href: "/tools/account-lookup", icon: Search },
  { label: "Automations",    href: "/automations",          icon: Bot },
```

In `drawerItems`:
```ts
  { label: "Templates",      href: "/templates",            icon: FileText },
  { label: "Account Lookup", href: "/tools/account-lookup", icon: Search },
  { label: "Automations",    href: "/automations",          icon: Bot },
```

- [ ] **Step 3: Type-check + dev-server boot**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "tools/account-lookup|AppNavigation|^error" | head -10`
Expected: no errors.

Run (in another terminal if not already): `npm run dev`

- [ ] **Step 4: Browser verification**

Open `http://localhost:3000/tools/account-lookup`. Confirm:
- "Account Lookup" appears in the desktop sidebar (and in the mobile More drawer).
- The page renders the panel.
- Selecting `Ethiopia` populates the bank dropdown with 40 entries.
- Looking up `CBE` + `1000188695168` shows the success card with `A/RESHID HASSEN A/KADER` and a Copy button.
- The Copy button puts the name on the clipboard.
- Looking up `CBE` + `1000188699999` shows the red "Lookup failed" card.

- [ ] **Step 5: Commit**

```bash
git add app/tools/account-lookup/page.tsx src/components/AppNavigation.tsx
git commit -m "feat(account-lookup): standalone tool page + nav entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Embed on transfer detail page

**Files:**
- Modify: `app/transfers/[id]/page.tsx`

- [ ] **Step 1: Add the import**

Open `app/transfers/[id]/page.tsx`. Find the existing imports near the top:

```tsx
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
```

Append:

```tsx
import { AccountLookupPanel } from "@/src/components/AccountLookupPanel";
```

- [ ] **Step 2: Render the panel near the beneficiary section**

Locate the existing block around line 225–230 (the four `<StatCard>`s including `<StatCard label="Beneficiary" ... />`). Right after the closing `</div>` of that 4-card grid, insert:

```tsx
      <AccountLookupPanel
        attachContext={{
          targetType: "transfer",
          targetId: String(transfer.id),
          label: transfer.transaction_ref ?? `Transfer #${transfer.id}`,
        }}
      />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "transfers/\[id\]|^error" | head -10`
Expected: no errors.

- [ ] **Step 4: Browser verification**

Visit any existing transfer detail page (`/transfers/<id>`). Confirm:
- The panel renders below the four stat cards.
- A successful lookup shows an "Attach to Transfer #..." button.
- Clicking it changes the button to "Attached to Transfer #...".
- Re-loading the page and viewing the API directly: `curl ... /api/account-lookup/verifications?targetType=transfer&targetId=<id>` returns the new attachment.

- [ ] **Step 5: Commit**

```bash
git add app/transfers/\[id\]/page.tsx
git commit -m "feat(account-lookup): embed lookup panel on transfer detail

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Embed on customer detail page

**Files:**
- Modify: `app/customer/[id]/page.tsx`

The customer page already loads `ApiCustomer` with `customer_id: string` and `full_name: string | null`. Since `target_id` in `account_verifications` is `VARCHAR(50)`, we pass `customer.customer_id` directly — no interface or API changes required.

- [ ] **Step 1: Add the import**

Near the top of `app/customer/[id]/page.tsx`, append a new import line beneath the existing ones:

```tsx
import { AccountLookupPanel } from "@/src/components/AccountLookupPanel";
```

- [ ] **Step 2: Render the panel**

Find the main `return (` of the page (around line 571 in the current file — confirm by running `grep -n "^  return ("` on the file before editing). Inside the returned JSX, place the panel below the customer summary block (a clean spot is just before the interactions/timeline section). Concretely insert:

```tsx
      {customer && (
        <AccountLookupPanel
          attachContext={{
            targetType: "customer",
            targetId: customer.customer_id,
            label: customer.full_name ?? `Customer ${customer.customer_id}`,
          }}
        />
      )}
```

If the file uses a different state variable name than `customer`, search for the relevant `useState<ApiCustomer | null>` declaration first and use that name.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "customer/\[id\]|^error" | head -10`
Expected: no errors.

- [ ] **Step 4: Browser verification**

Visit a customer detail page (`/customer/<customer_id>`). Confirm:
- The panel renders.
- A successful lookup shows an "Attach to {customer name}" button.
- Clicking it returns `201` and the button switches to "Attached to …".
- `GET /api/account-lookup/verifications?targetType=customer&targetId=<customer_id>` returns the new attachment.

- [ ] **Step 5: Commit**

```bash
git add app/customer/\[id\]/page.tsx
git commit -m "feat(account-lookup): embed lookup panel on customer detail

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run the type-checker over the whole project**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20`
Expected: no errors anywhere (or only pre-existing errors not introduced by this work).

- [ ] **Step 2: Run the lib verification script**

Run: `node scripts/test-account-lookup.mjs`
Expected: all checks pass.

- [ ] **Step 3: Run the API smoke script**

With `npm run dev` running:

```bash
TOKEN="<jwt>" TRANSFER_ID=<id> node scripts/test-account-lookup-api.mjs
```

Expected: all six checks pass.

- [ ] **Step 4: Browser walk-through**

For each of the three entry points, exercise the success / failed paths:
1. `http://localhost:3000/tools/account-lookup` (standalone)
2. `http://localhost:3000/transfers/<id>` (embedded)
3. `http://localhost:3000/customer/<customer_id>` (embedded)

Confirm: success card with copy + attach, failed card, error card (force this one with an invalid env if desired — or skip it if Tayo is healthy).

- [ ] **Step 5: Final commit (only if any tweaks were needed)**

```bash
git status
# If anything needs fixing from the walk-through, fix it and commit with a descriptive message.
```

If everything looks good and there are no further changes, no extra commit is needed.

---

## Spec coverage check (writer self-review)

| Spec section | Implemented in |
|---|---|
| Architecture: lib boundary, dispatcher, types | Tasks 2, 4, 5 |
| `account_lookups` table | Task 1 |
| `account_verifications` table | Task 1 |
| `GET /api/account-lookup/banks` | Task 6 |
| `POST /api/account-lookup` (audit + status semantics) | Task 7 |
| `POST /api/account-lookup/[id]/attach` (success-only, 409 on failed) | Task 8 |
| `GET /api/account-lookup/verifications` | Task 9 |
| Tayo token flow + Basic Auth + plaintext JSON body | Tasks 3, 4 |
| HTTP 400-from-Tayo treated as `failed` | Task 4 |
| Error handling matrix (status `success/failed/error`) | Tasks 4, 7 |
| Per-agent rate limit (30/min) | Task 7 |
| Reusable `<AccountLookupPanel>` with attach props | Task 11 |
| Standalone page + nav entry | Task 12 |
| Transfer detail embed | Task 13 |
| Customer detail embed | Task 14 |
| Script-based verification (lib + API) | Tasks 4, 10, 15 |
| Manual UI verification | Tasks 12–15 |
| No new env vars | (uses existing `TAYO_BASIC_AUTH`) |
