# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TassaPay CRM — a Next.js 13 (App Router) + MySQL CRM that wraps the TassaPay backoffice and TayoTransfer APIs, integrates Twilio Voice/SMS and Resend email, and adds lead pipeline, commission, reconciliation, SLA-alerting, and tasks layers on top.

## Commands

```bash
npm run dev                       # Next.js dev server on :3000
npm run build                     # Production build (also type-checks)
npm run start                     # Run the production build
npm run lint                      # ESLint (next/core-web-vitals)

# Background workers (run alongside Next.js, e.g. via PM2 — see scripts/sync-worker.mjs header)
npm run sync:worker               # Unified 5-min cron: customers + transfers + Tayo + SLA alerts
npm run sla:worker                # SLA-alert worker only
npm run payments:worker           # Payment CSV imports from data/payments/<provider>/

# Database
npm run db:setup                  # Apply src/db/schema.sql (idempotent)
npm run db:migrate:payments       # Migrate payments / reconciliation columns
npm run db:migrate:reconciliation
npm run db:sync                   # One-shot sync from TassaPay backoffice → customers
npm run api:test                  # Smoke-test the TassaPay backoffice API client
```

ESLint is `ignoreDuringBuilds: true` in `next.config.mjs` (the `import` plugin has a tsconfig-paths bug on Node 16); type-checking still runs as part of `next build`. Two narrow tsconfigs (`tsconfig.dashboard-check*.json`) exist to type-check just the dashboard route in isolation when iterating on it.

There is no test runner configured in this repo. The `scripts/smoke-test-*.mjs`, `scripts/test-*.mjs`, and `scripts/test-api.mjs` files are standalone Node scripts run directly with `node scripts/<file>.mjs` against a real MySQL + populated `.env.local`.

## Environment

Workers and scripts read `.env.local` directly (manual parse — see top of `scripts/sync-worker.mjs`). API routes use the standard Next runtime env.

Required:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET` — used to sign/verify the CRM session token
- `TASSAPAY_USERNAME`, `TASSAPAY_PASSWORD`, `TASSAPAY_BRANCH_KEY` — backoffice API
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_FROM_NUMBER`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY` — SLA alert push
- `APP_BASE_URL` — public URL used to construct Twilio webhook URLs
- `BACKOFFICE_WEBHOOK_SECRET`, `ENFORCE_BACKOFFICE_WEBHOOK_AUTH` — HMAC for `/api/webhooks/backoffice/*`

Optional tunables:
- `MIN_COMMISSIONABLE_AMOUNT` (default 50)
- `VOICE_TOKEN_TTL_SECONDS` (8h), `VOICE_AGENT_TTL_SECONDS` (45s), `VOICE_HEARTBEAT_INTERVAL_SECONDS` (20s)

## Architecture

**Stack.** Next.js 13.5 App Router, React 18, TypeScript strict, Tailwind, MySQL via `mysql2/promise`. No ORM — raw parameterised SQL. The `@/*` path alias maps to the repo root, so imports look like `@/src/lib/db` and `@/src/components/AppShell`.

**Two source roots, by convention.**
- `app/` — Next.js routes only. Pages and API routes (`app/api/**/route.ts`, ~57 endpoints).
- `src/` — everything else: `lib/` (server-side helpers used by routes and scripts), `components/`, `context/` (client React contexts), `services/`, `db/schema.sql`, `hooks/`, `utils/`.

When adding a server-side helper that's reused by both API routes and `scripts/`, put it in `src/lib`. Twilio, bcryptjs, and jsonwebtoken are listed in `serverComponentsExternalPackages` and must stay server-only.

**MySQL pool.** `src/lib/db.ts` exports a single shared `pool` cached on `globalThis._mysqlPool` so Next dev hot-reload doesn't leak connections. Always import this — never construct your own pool inside an API route.

**Auth.** JWT bearer tokens issued by `POST /api/auth/login`, verified by `requireAuth(req)` in `src/lib/auth.ts`. Standard pattern at the top of every protected route:

```ts
const auth = requireAuth(req);
if (auth instanceof NextResponse) return auth;   // 401
// auth: AuthPayload — use auth.id, auth.role, auth.allowed_regions, auth.can_view_dashboard
```

The browser stores the token in `localStorage` under `tp_crm_token` and `tp_crm_user`. Client code calls APIs via `apiFetch` (`src/lib/apiFetch.ts`), which auto-attaches the bearer header and redirects to `/login` on any 401.

**Region-based row-level security.** This is the most important cross-cutting concern. `users.allowed_regions` is a JSON array (`["UK", "EU"]`); `src/lib/regionFence.ts` expands those codes into country names via `REGION_MAP` and produces SQL fragments:

- `buildCountryFence(regions, isAdmin)` → fragment for `customers` queries (`country IN (?, ?, …)`)
- `buildTransferFence(regions, isAdmin)` → fragment for `transfers` queries (subquery against `customers`)
- Returns `null` for Admin (no fence), `{ sql: "1=0", params: [] }` for misconfigured agents (deny-all).

For per-row writes/reads on a single customer, use `authorizeCustomerWriteAccess` / `authorizeLeadWriteAccess` in `src/lib/authorization.ts` instead — they fetch the row and 404/403 in one call. **Any new `customers`/`transfers` query must apply the appropriate fence**, otherwise agents will see data outside their region.

**TassaPay backoffice integration.** `src/lib/tassapayApi.ts` is the only client. The flow is two-step: `LoginHandler.ashx` returns session cookies + encrypted credentials, then `CustomerHandler.ashx`/transfer endpoints are called with that cookie header. Date format from the backoffice is `DD/MM/YYYY HH:mm:ss` — use `parseDateDDMMYYYY` from `src/lib/customerSync.ts` when persisting. `transferSync.ts` documents the field mapping (raw API → `transfers` columns).

**Sync model.** Customers and transfers live in MySQL and are kept in sync with the backoffice by `scripts/sync-worker.mjs` (5-minute cron). Upserts use `INSERT … ON DUPLICATE KEY UPDATE` keyed on `customer_id` / `transaction_ref` (see `src/lib/customerSync.ts` for the canonical pattern). Each run is recorded in `sync_log`. Webhook routes under `app/api/webhooks/backoffice/*` accept push updates from the backoffice and validate an HMAC-SHA256 signature via `src/lib/backofficeWebhook.ts` (enforcement is gated by `ENFORCE_BACKOFFICE_WEBHOOK_AUTH`).

**Voice (Twilio).** Browser SDK in `src/context/TwilioVoiceContext.tsx` holds the active `Device`/`Call`. Server-side voice flow:
- `POST /api/voice/token` — short-lived JWT for the SDK
- `POST /api/voice/twiml` — TwiML for outbound dials; validates the Twilio signature and maps SIP/E.164 numbers to customers
- `POST /api/voice/status-callback`, `/api/voice/call-completed` — webhook updates
- `POST /api/voice/available` — agent heartbeat (writes `users.voice_available` + `voice_last_seen_at`)

All call interactions are upserted into `interactions` keyed on `twilio_call_sid` (UNIQUE). `src/lib/voiceCallState.ts` is the single owner of that upsert and of the multi-SID lookup that handles parent/dial/recording SID variants — never write to `interactions` for a call from elsewhere.

**Commission engine.** `src/lib/commissionEngine.ts` — five gates in fixed order: status (`Completed`/`Deposited`), attribution (`transfers.attributed_agent_id`), min amount (`MIN_COMMISSIONABLE_AMOUNT`), first-transfer (no earlier non-Failed qualifying transfer for that customer), and idempotency (UNIQUE `commissions.transfer_id`). Commissions follow a maker-checker workflow: `pending_approval → approved → paid` (or `rejected`/`cancelled`). Call `calculateCommission(transferId)` from any place that flips a transfer's status.

**Payment reconciliation.** `data/payments/{volume,emerchantpay,paycross}/*.csv` are imported by `scripts/payment-worker.js` into the `payments` table; `src/lib/paymentReconciliation.ts` matches them to `transfers` and updates `transfers.primary_payment_id` / `reconciliation_status` (`pending|matched|mismatch|manual_adjustment`).

**SLA alerts.** `scripts/sla-alert-worker.mjs` (or the unified `sync-worker.mjs`) scans Somalia transfers in `Ready` status grouped by source currency, fires SMS (Twilio) + email (Resend) + Pushover via `alert_routings`, and stamps `transfers.sla_alert_sent_at` to prevent re-firing.

**Phone matching.** Customer lookup by phone uses three columns kept in sync on insert: `phone_number` (raw), `phone_normalized` (digits only), `phone_last9` (for fuzzy international match). Always use `normalizePhoneValue` + `getPhoneLast9` from `src/lib/phoneUtils.ts` when writing customers, and match against both columns when reading (see `app/api/customers/route.ts` for the canonical query).

**Validation & responses.** Use the helpers in `src/lib/requestValidation.ts` (`requireString`, `optionalInteger`, `RequestValidationError`, etc.) and `src/lib/httpResponses.ts` (`jsonError`, `xmlResponse`) instead of hand-rolling JSON shapes — error responses are `{ error, details? }`.

**Client tree.** `app/layout.tsx` wraps everything in `AuthProvider → SessionProviders → AppShell`. `SessionProviders` is keyed on `user.id` so all session-scoped contexts (`QueueProvider`, `TwilioVoiceProvider`, `DropdownsProvider`, `LeadsQueueProvider`) hard-reset on login/logout. `AppShell` short-circuits on `/login` and otherwise mounts `ProtectedRoute` + the global `CallWidget` and `PostCallModal`.

## Schema notes

`src/db/schema.sql` is the source of truth and is `IF NOT EXISTS` everywhere — safe to rerun. A few quirks worth knowing:

- The file declares **two `customers` tables**. The first (line ~31) is the lean CRM table actually used by the app (`customer_id` VARCHAR, FKs to `users`, `is_lead`/`lead_stage` for the lead pipeline). The second (line ~177) is a wider raw mirror of the backoffice payload — present for reference/imports but the live app reads/writes the first one. Keep this in mind when reading the schema.
- Migration ALTERs that have already shipped are kept as commented-out blocks at the bottom; new installs get them via the `CREATE TABLE`s. New schema changes belong in a new `scripts/migrate-*.mjs` file plus the matching `CREATE TABLE` update.
- `interactions` is the unified activity log (call/email/note/system). `twilio_call_sid` and `request_id` are both UNIQUE — rely on those for idempotency rather than de-duping in app code.
