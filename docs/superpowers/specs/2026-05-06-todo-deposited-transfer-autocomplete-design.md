# To-Do Transfer Autocomplete: Include Deposited (and All) Statuses

**Date:** 2026-05-06
**Type:** Bug fix
**Branch:** codex/resilience-fix

## Problem

In the To-Do section, when a user creates or edits a task and tries to
associate a transfer record by typing its `transaction_ref` or
`data_field_id`, transfers with status `Deposited` do not appear in the
autocomplete dropdown. (The same hidden filter also excludes other
terminal statuses such as Cancelled, Rejected, Pending, etc., but
`Deposited` is the most visible because it is the most common terminal
state.)

## Root cause

The autocomplete in `app/to-do/page.tsx` calls

```
GET /api/transfers?search=<query>&page=1&limit=8
```

with no `status` query parameter.

In `app/api/transfers/route.ts` (lines 35–36 and 59–67), `status`
defaults to `"not-paid"` when omitted, and `"not-paid"` is translated to
the SQL condition:

```sql
t.status != 'Deposited'
```

That default exists for the `/transfers` listing page (the kanban-style
tabs), which always passes an explicit `status`. The to-do autocomplete
inherits this default unintentionally.

## Decision

Add an explicit `status=all` value to the API that skips status
filtering entirely, and pass `status=all` from both to-do autocomplete
call sites. We do **not** change the API's default behavior when
`status` is omitted — it remains `"not-paid"` for backward compatibility
with any future caller that relies on the listing-page default.

Approaches that were considered and rejected:

- **Skip the status filter on the server when `search` is present.**
  Two lines saved, but couples two unrelated query params with hidden
  semantics (a future caller passing both `search` and `status=paid`
  would silently lose its status filter).
- **Add a dedicated `/api/transfers/lookup` endpoint.** Overkill for a
  one-line bug; duplicates query logic.

## Change list

### 1. `app/api/transfers/route.ts`

Extend the existing `status` switch (around lines 59–67) to recognize
`"all"`:

- `"not-paid"` → `t.status != 'Deposited'` (unchanged, default)
- `"in-progress"` → `t.status = 'Processed'` (unchanged)
- `"paid"` → `t.status = 'Deposited'` (unchanged)
- `"action-required"` → `t.status = 'Pending'` (unchanged)
- `"all"` → no status condition added (new)

The unrelated `slaFilter` branch (lines 51–57) already adds its own
status condition and is independent. The `country`, `search`,
`distinct_countries`, paging, and country-fence logic are all unchanged.

### 2. `app/to-do/page.tsx`

Append `&status=all` to the two autocomplete URLs:

- Line 219 — Create-Task modal autocomplete
- Line 758 — Edit-Task modal autocomplete

Both currently read:

```ts
const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8`);
```

After the change:

```ts
const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8&status=all`);
```

No other client code needs to change. The `/transfers` listing page
always passes an explicit `status` from its filter UI, and the
`distinct_countries=1` callers are unaffected.

## Out of scope

- No change to the `/transfers` listing page UI or its filter tabs.
- No change to the API's default `status` value when omitted.
- No new endpoint.
- No change to the response shape of `/api/transfers`.
- No backfill or data migration.

## Testing (manual)

Run the app and verify in a browser:

1. **Create-Task modal:** type a `transaction_ref` or `data_field_id` of
   a known `Deposited` transfer (≥ 3 chars). It appears in the
   dropdown, can be selected, and auto-fills the customer field.
2. **Edit-Task modal:** open an existing task, change its associated
   transfer to a known `Deposited` transfer the same way.
3. **Negative check:** transfers with statuses other than `Deposited`
   (Pending, Processed, Cancelled, Rejected) also appear in the
   dropdown when their reference is searched.
4. **Regression check:** the `/transfers` listing page still filters
   correctly across its status tabs (Not Paid, In Progress, Paid,
   Action Required) — no Deposited transfers leaking into "Not Paid".

## Risk

Very low. The change is additive on the server (new accepted value
only) and a two-line edit on the client. No schema or data changes.
The only callers of `/api/transfers?search=` are the to-do autocompletes
and the transfers listing page; the listing page always passes an
explicit `status` and is unaffected.
