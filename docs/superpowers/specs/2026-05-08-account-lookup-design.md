# Account Lookup — Design Spec

**Date:** 2026-05-08
**Status:** Approved (design phase)

## Summary

Add a manual account-lookup tool for agents that verifies a beneficiary's bank or wallet account against Tayo's `POST /api/remittance/accountlookupAuthentication` endpoint. Ethiopia-only at launch; the data model and module shape accommodate additional countries and providers (e.g. M-Pesa) without migration or refactor.

## Goals

- Agents can verify an Ethiopian bank account from a dedicated tools page or inline on transfer/customer detail pages.
- Every lookup is recorded for audit and abuse-detection.
- Successful lookups can be attached as verification proof to a specific transfer or customer.
- The integration is shaped so a new country/provider can be added by writing one handler file and one method-list file.

## Non-goals

- Caching or deduping lookups (every request hits Tayo).
- Background or scheduled re-verification.
- Bank list management UI (the list is code-defined).
- M-Pesa or other non-Ethiopia integrations in this iteration.
- Bulk lookup / CSV upload.
- A test framework rollout (this codebase uses script-based verification today; we match that pattern rather than introduce one).

## Architecture

```
┌─ UI ──────────────────────────────────────────────────────────┐
│  app/tools/account-lookup/page.tsx           (standalone)    │
│  src/components/AccountLookupPanel.tsx       (reusable)      │
│      ↳ embedded on transfer detail + customer detail pages   │
└──────────────────────────────────────────────────────────────┘
                          │ fetch
                          ▼
┌─ API routes (Next 13 App Router) ────────────────────────────┐
│  GET  /api/account-lookup/banks?country=ET                   │
│  POST /api/account-lookup                                    │
│  POST /api/account-lookup/[id]/attach                        │
│  GET  /api/account-lookup/verifications                      │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ src/lib/accountLookup/ ─────────────────────────────────────┐
│  index.ts        → lookupAccount() dispatcher                │
│  tayoEthiopia.ts → handler: token + call Tayo + normalize    │
│  tayoToken.ts    → shared Basic-auth → token helper          │
│  banks/ethiopia.ts → static method list (40 entries)         │
│  types.ts        → LookupRequest/Result, CountryCode, etc.   │
└──────────────────────────────────────────────────────────────┘
                          │ Basic Auth + Efuluusrodp2025 token
                          ▼
       Tayo: POST /api/remittance/accountlookupAuthentication
```

**Boundaries**

- The `accountLookup` lib is the only place that knows about Tayo. UI and API routes never touch Tayo directly.
- Adding M-Pesa later: add `mpesa.ts` handler, `wallets/kenya.ts` list, and a `'KE'` branch in the dispatcher — no UI or DB changes.
- Auth reuses the existing `TAYO_BASIC_AUTH` env var and the same token flow used by `src/services/tayoSyncService.js` (POST `/api/Token` with Basic Auth → use returned token in the `Efuluusrodp2025` header on subsequent calls).
- All routes go through the same agent-session auth middleware/helper used elsewhere in the CRM.

## Data model

Two new MySQL tables. Naming and types follow the existing `src/db/schema.sql` conventions. Migration ships as `scripts/migrate-account-lookup.mjs`, matching the existing `scripts/migrate-*.mjs` pattern.

### `account_lookups` — every attempt (audit trail)

| column | type | notes |
|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT PK` | |
| `agent_id` | `BIGINT NOT NULL` | FK to `users.id` |
| `country_code` | `CHAR(2) NOT NULL` | `'ET'` today |
| `provider` | `VARCHAR(32) NOT NULL` | `'tayo'` today |
| `method_type` | `ENUM('bank','wallet') NOT NULL` | future-proofs M-Pesa |
| `method_code` | `VARCHAR(64) NOT NULL` | bank/wallet identifier (e.g. `'CBE'`) — exact string Tayo expects |
| `account_number` | `VARCHAR(64) NOT NULL` | as submitted (trimmed) |
| `status` | `ENUM('success','failed','error') NOT NULL` | see below |
| `account_name` | `VARCHAR(255) NULL` | populated only on `success` |
| `response_code` | `VARCHAR(8) NULL` | Tayo's `response` field (`'000'` / `'999'`) |
| `response_description` | `VARCHAR(255) NULL` | Tayo's `responseDescription` |
| `raw_response` | `JSON NULL` | full upstream body for forensics |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | |

Indexes:
- `(agent_id, created_at)` — "my recent lookups"
- `(account_number, country_code)` — future dedupe / abuse queries

**Status semantics**
- `success` — Tayo returned 200 with `result[0].message='success'` and an `accountName`.
- `failed` — Tayo returned 400, or 200 with `result[0].message='failed'` (account not found, invalid bank, service unavailable per Tayo's response).
- `error` — non-2xx-non-400 from Tayo, network error, malformed response, or token-fetch failure.

### `account_verifications` — agent-attached proof

| column | type | notes |
|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT PK` | |
| `lookup_id` | `BIGINT NOT NULL` | FK to `account_lookups.id`; app layer enforces referenced row has `status='success'` |
| `target_type` | `ENUM('transfer','customer') NOT NULL` | |
| `target_id` | `BIGINT NOT NULL` | `transfers.id` or `customers.id` |
| `attached_by` | `BIGINT NOT NULL` | FK to `users.id` |
| `attached_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | |

Index: `(target_type, target_id)` for fast detail-page reads.

No unique constraint — multiple verifications per target over time are allowed and useful as history.

## API routes

All routes require an authenticated agent session (existing helper, to be located during implementation).

### `GET /api/account-lookup/banks?country=ET`

Returns the supported method list for a country, used to populate the method dropdown.

**Response (200):**
```json
{
  "country": "ET",
  "methods": [
    { "type": "bank",   "code": "CBE",        "label": "CBE" },
    { "type": "bank",   "code": "Awash Bank", "label": "Awash Bank" },
    { "type": "wallet", "code": "CBE Birr",   "label": "CBE Birr" },
    { "type": "wallet", "code": "Yaya Wallet","label": "Yaya Wallet" }
  ]
}
```

`code` matches Tayo's exact-string requirement (sent verbatim as `bankName`); `label` is what the agent sees. The 40 entries from Tayo's documentation are pre-classified as `bank` vs `wallet` (e.g. `CBE Birr`, `Yaya Wallet`, `Halal Pay` are wallets).

**Errors:** `400` if `country` is missing or unsupported.

### `POST /api/account-lookup`

Performs the lookup and writes one row to `account_lookups`.

**Request:**
```json
{
  "country": "ET",
  "methodType": "bank",
  "methodCode": "CBE",
  "accountNumber": "1000188695168"
}
```

**Server flow:**
1. Validate input: country supported; `methodCode` is present in that country's list **and** its `type` matches the supplied `methodType` (mismatched type → 400, no Tayo call); `accountNumber` non-empty after trim.
2. Call `lookupAccount(req)` from `src/lib/accountLookup`.
3. Persist an `account_lookups` row regardless of outcome.
4. Return the result.

**Response (200) — for both `success` and `failed`:**
```json
{
  "lookupId": 1234,
  "status": "success",
  "accountName": "A/RESHID HASSEN A/KADER",
  "responseCode": "000",
  "responseDescription": "success"
}
```

**Status codes**
- `200` — lookup completed (status=`success` or `failed`); both are normal product outcomes the UI renders.
- `400` — invalid request (bad country/method, empty account).
- `401` — no agent session.
- `502` — upstream Tayo unreachable, auth failure, or malformed response. Audit row written with `status='error'`.

The `failed` vs `error` split matters: a failed lookup is normal output (agent learns the account is invalid); an error is a system problem ops needs to see.

### `POST /api/account-lookup/[id]/attach`

Attaches a successful lookup to a transfer or customer.

**Request:**
```json
{ "targetType": "transfer", "targetId": 9876 }
```

**Server flow:**
1. Load `account_lookups` row by `id`. `404` if not found.
2. `409` if `status != 'success'` (`{ "error": "Cannot attach a failed lookup" }`).
3. Verify target row exists in the appropriate table. `404` if not.
4. Insert into `account_verifications` (no de-dup).
5. Return the new verification row.

**Response (201):**
```json
{
  "id": 42,
  "lookupId": 1234,
  "targetType": "transfer",
  "targetId": 9876,
  "attachedBy": 7,
  "attachedAt": "2026-05-08T12:34:56Z"
}
```

### `GET /api/account-lookup/verifications?targetType=transfer&targetId=9876`

Returns the attached verifications for a transfer or customer, joined to `account_lookups` and `users`. Used by the embedded panel to show prior verifications above the form.

**Response (200):**
```json
[
  {
    "id": 42,
    "lookup": {
      "id": 1234,
      "methodCode": "CBE",
      "methodType": "bank",
      "accountNumber": "1000188695168",
      "accountName": "A/RESHID HASSEN A/KADER"
    },
    "attachedBy": { "id": 7, "name": "Jane Doe" },
    "attachedAt": "2026-05-08T12:34:56Z"
  }
]
```

## `src/lib/accountLookup` module

### `types.ts`

```ts
export type CountryCode = 'ET'; // union grows over time
export type MethodType = 'bank' | 'wallet';

export interface SupportedMethod {
  type: MethodType;
  code: string;   // exact string the upstream provider expects
  label: string;  // shown to agents
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
  raw: unknown;
}
```

### `banks/ethiopia.ts`

A static `SupportedMethod[]` containing all 40 entries from Tayo's documentation, pre-classified as `bank` or `wallet`. The `code` field is sent verbatim as `bankName` to Tayo (no transformation, case-sensitive).

### `tayoToken.ts`

Small shared helper that POSTs to `http://efuluusprod.tayotransfer.com/api/Token` with `Authorization: Basic ${TAYO_BASIC_AUTH}` and returns the `Token` field from the response. Mirrors the existing logic in `src/services/tayoSyncService.js` so we don't import from `.js` service code into TS lib code.

### `tayoEthiopia.ts`

```ts
export async function tayoEthiopiaLookup(req: LookupRequest): Promise<LookupResult>
```

Responsibilities:
- Fetch a Tayo token via `tayoToken.ts`.
- POST to `http://efuluusprod.tayotransfer.com/api/remittance/accountlookupAuthentication` with `{ accountNumber, bankName: req.methodCode }` as plaintext JSON (per the docs — no AES wrapping like `RemittanceList`).
- Headers: `Authorization: Basic ${TAYO_BASIC_AUTH}`, `Efuluusrodp2025: <token>`, `Content-Type: application/json`.
- The HTTP client must **not throw on HTTP 400** — Tayo uses 400 for the documented "account not found / service unavailable" case, which we treat as a normal `failed` outcome (parse the JSON body, read `result[0].message`).
- Map outcomes:
  - `200` + `result[0].message === 'success'` → `status: 'success'`, `accountName` populated.
  - `200` or `400` with `result[0].message === 'failed'` → `status: 'failed'`.
  - Network error / non-2xx-non-400 / token failure / malformed body → `status: 'error'`.
- Always include the full raw upstream body in `raw`.

### `index.ts`

```ts
export async function lookupAccount(req: LookupRequest): Promise<LookupResult> {
  if (req.country === 'ET') return tayoEthiopiaLookup(req);
  throw new Error(`Unsupported country: ${req.country}`);
}

export function getSupportedMethods(country: CountryCode): SupportedMethod[] {
  if (country === 'ET') return ETHIOPIA_METHODS;
  throw new Error(`Unsupported country: ${country}`);
}
```

Adding M-Pesa later means: drop `mpesa.ts` + `wallets/kenya.ts`, add a `'KE'` branch to each function. No other code changes.

## UI components

### `src/components/AccountLookupPanel.tsx` (reusable)

Used by both the standalone page and embedded views.

```ts
type Props = {
  // When set, shows an "Attach to {label}" button on success.
  attachContext?:
    | { targetType: 'transfer'; targetId: number; label: string }
    | { targetType: 'customer'; targetId: number; label: string };
  onAttached?: () => void; // called after a successful attach
};
```

**Layout (top → bottom):**
1. **Country selector** — dropdown, only Ethiopia enabled today.
2. **Method dropdown** — populated from `GET /api/account-lookup/banks?country=ET`. Type-to-filter (40 entries). Each option shows a small `Bank` or `Wallet` pill.
3. **Account number** — text input, trims whitespace.
4. **Lookup button** — primary, disabled until country + method + non-empty account.
5. **Result card** (after submit):
   - **Success**: account name in large text + copy-to-clipboard button; subtitle with `method • account number • response code`. If `attachContext` set, an "Attach to {label}" button.
   - **Failed**: red banner with `responseDescription` and a hint ("Account not found, or the bank/account combination is invalid").
   - **Error**: amber banner ("Service temporarily unavailable — try again in a moment"). No attach button.
6. **Recent lookups** (standalone page only): collapsed list of the agent's last 10 lookups, click to repopulate the form. Skipped on embedded views to keep them compact. **Descoped to v2** — not implemented in the initial release. Requires a new `GET /api/account-lookup/recent` route plus UI; defer to a follow-up when there's actual demand.

State is component-local (`useState`); no global store. Loading state on the button. Errors surface inline, not via toast.

### `app/tools/account-lookup/page.tsx` (standalone)

Thin page: header + `<AccountLookupPanel />` (no `attachContext`) + recent-lookups list. New nav entry added to `src/components/AppNavigation.tsx` matching the existing pattern (under a "Tools" group if one exists, otherwise as a top-level item).

### Embedded placements

- **Transfer detail page**: render an existing-verifications list followed by `<AccountLookupPanel attachContext={{ targetType: 'transfer', targetId, label: \`Transfer #${ref}\` }} />` near the beneficiary section.
- **Customer detail page**: same pattern with `targetType: 'customer'`.
- The verifications list reads from `GET /api/account-lookup/verifications?...` and shows: account name, masked-ish account number, who verified, when.

## Error handling

| Layer | Failure | Behavior |
|---|---|---|
| `tayoToken.ts` | Token fetch fails | Throw; handler returns `status: 'error'`. |
| `tayoEthiopia.ts` | Lookup returns 400 / `result.message='failed'` | Return `{ status: 'failed', accountName: null, raw }`. Route returns 200; UI renders red banner. |
| `tayoEthiopia.ts` | Unexpected shape, non-JSON, missing fields | `status: 'error'`. `raw_response` retains original body for forensics. |
| `POST /api/account-lookup` | Audit-row insert fails | Log via existing logger; still return upstream result to UI. |
| `POST /api/account-lookup/[id]/attach` | `lookup.status !== 'success'` | `409` `{ error: 'Cannot attach a failed lookup' }`. |
| All routes | Missing/expired session | `401` via existing auth helper. |

## Security

- Tayo credentials stay server-side; the browser never sees `TAYO_BASIC_AUTH` or the token.
- Per-agent rate limit on `POST /api/account-lookup` (e.g. 30/min). If a project-wide limiter exists, use it; otherwise a small per-route in-memory bucket.
- Account numbers are PII; logged deliberately in the audit table but not echoed to client logs or third-party telemetry.
- `target_id` on attach is always validated against the actual transfers/customers tables — never trusted from the client.

## Testing

Codebase uses script-based verification (no Jest/Vitest harness). We match the pattern:

1. **`scripts/test-account-lookup.mjs`** — exercises `lookupAccount()` directly against real Tayo:
   - `CBE` + `1000188695168` → asserts `status: 'success'`.
   - `CBE` + the documented invalid number → asserts `status: 'failed'`.
   - Junk method code → asserts validation error before any network call.
2. **`scripts/test-account-lookup-api.mjs`** — end-to-end against local API: login → POST lookup → POST attach → GET verifications.
3. **Manual UI verification** — `npm run dev`, exercise the standalone page and one embedded location (transfer detail) in the browser. Verify success, failed, and error rendering.

Introducing a real test framework is out of scope; if desired, scope it as separate work.

## Configuration

Reuses existing env vars:
- `TAYO_BASIC_AUTH` — Base64 `username:password` for Basic Auth (already set for the sync worker).
- `TAYO_PROXY_HOST` / `TAYO_PROXY_PORT` — optional, already supported by the sync service.

No new env vars required.

## Migration & rollout

1. Run `scripts/migrate-account-lookup.mjs` to create the two tables.
2. Deploy the new code.
3. Verify with `scripts/test-account-lookup.mjs` against staging Tayo.
4. Announce the new "Account Lookup" tool to agents.

No feature flag — the feature is purely additive; failure modes are isolated to the new tool.
