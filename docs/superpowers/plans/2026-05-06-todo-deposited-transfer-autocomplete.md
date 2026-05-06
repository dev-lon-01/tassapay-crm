# To-Do Transfer Autocomplete — Deposited Status Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Deposited (and all other) transfers appear in the to-do
section's "associate transfer" autocomplete by adding an explicit
`status=all` value to `/api/transfers` and passing it from both
to-do autocomplete call sites.

**Architecture:** Two-line server change (recognize `status=all` and
skip status filtering when present) plus a one-token append to the
two client URLs in `app/to-do/page.tsx`. The endpoint's default
behavior when `status` is omitted is intentionally unchanged.

**Tech Stack:** Next.js 13 (App Router), TypeScript, MySQL2, React 18.
No test framework configured in the project — verification is manual
via `curl` against `npm run dev` and a browser session.

**Spec:** [docs/superpowers/specs/2026-05-06-todo-deposited-transfer-autocomplete-design.md](../specs/2026-05-06-todo-deposited-transfer-autocomplete-design.md)

---

## Pre-flight: confirm working state

- [ ] **Step 1: Confirm working tree is clean and on the right branch**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: branch is `codex/resilience-fix` and the only untracked file
is `scripts/2026-05-task-activity-attribution.mjs` (already noted in
the project state — not part of this work). No staged changes.

If the branch differs, stop and confirm with the user before proceeding.

- [ ] **Step 2: Identify a Deposited transfer for verification**

You need one known Deposited `transaction_ref` (call it `$REF`) and
one known non-Deposited `transaction_ref` (call it `$REF_OTHER`,
e.g. status `Processed` or `Pending`). Both are used in manual
verification later.

The simplest source is the running app itself, which we will start
in Task 1. For now, leave `$REF` and `$REF_OTHER` as placeholders
and capture the values in Task 1 Step 3 once the dev server is up:

1. Open `http://localhost:3000/transfers` in a browser.
2. Click the **Paid** tab → copy the `transaction_ref` of the top row → that is `$REF`.
3. Click the **Not Paid** tab → copy the `transaction_ref` of the top row → that is `$REF_OTHER`.

If the **Paid** tab is empty (no Deposited transfers exist in the
target environment), stop and tell the user — without a Deposited
record we cannot reproduce the original bug or verify the fix.

---

## Task 1: Recognize `status=all` in the transfers API

**Files:**
- Modify: `app/api/transfers/route.ts:58-67`

The existing `if/else if` chain currently maps four `status` values to
SQL conditions. We add a single comment documenting that `status=all`
deliberately falls through with no condition added, AND make the
chain explicit by adding an `else if (status === "all")` branch with
no body so the intent is visible at the call site.

Why an explicit branch instead of just relying on the fall-through?
Today, an unrecognized `status` value silently produces no filter.
That is fragile — a typo like `status=al` or `status=All` would
silently bypass filtering. We make `"all"` the *only* documented
no-op value so future callers fail loudly if they typo it (they get
the default `"not-paid"` behavior because they would also have to
omit `status` entirely to typo it — see Step 1 below for the exact
edit).

- [ ] **Step 1: Edit the status switch in `app/api/transfers/route.ts`**

Open `app/api/transfers/route.ts`. Locate lines 58-67 (the `else`
branch that handles `status` values). Replace this block:

```ts
    } else {
      if (status === "not-paid") {
        conditions.push("t.status != 'Deposited'");
      } else if (status === "in-progress") {
        conditions.push("t.status = 'Processed'");
      } else if (status === "paid") {
        conditions.push("t.status = 'Deposited'");
      } else if (status === "action-required") {
        conditions.push("t.status = 'Pending'");
      }
```

with:

```ts
    } else {
      if (status === "not-paid") {
        conditions.push("t.status != 'Deposited'");
      } else if (status === "in-progress") {
        conditions.push("t.status = 'Processed'");
      } else if (status === "paid") {
        conditions.push("t.status = 'Deposited'");
      } else if (status === "action-required") {
        conditions.push("t.status = 'Pending'");
      } else if (status === "all") {
        // intentional no-op: caller wants every status (used by to-do autocomplete)
      }
```

The lines above (`if (slaFilter === ...)`) and below (`if (country)`)
are unchanged. Do not touch the closing brace of the outer `else`.

- [ ] **Step 2: Verify the file still typechecks via lint**

Run:

```bash
npm run lint
```

Expected: zero errors related to `app/api/transfers/route.ts`. Pre-existing
warnings elsewhere in the codebase are acceptable (do not "fix" unrelated
files). If the only issue is something like `no-unused-vars` or `prefer-const`
on the new lines, fix it before continuing.

- [ ] **Step 3: Start the dev server and capture `$REF` / `$REF_OTHER`**

In a separate terminal (or as a background process):

```bash
npm run dev
```

Wait for the line `ready - started server on 0.0.0.0:3000` (or whichever
port). Keep the server running for the rest of this task and the next.

Now follow pre-flight Step 2 in a browser: visit `/transfers`, click
the **Paid** tab to capture `$REF` (a Deposited `transaction_ref`),
then click the **Not Paid** tab to capture `$REF_OTHER`. Note both
values somewhere — they are used in the verification steps below
and in Task 2.

- [ ] **Step 4: Manual API smoke test — `status=all` returns Deposited**

You need an authenticated session cookie because `/api/transfers`
calls `requireAuth(req)` (see line 10 of route.ts). Two ways to get
one:

(a) **Browser cookie** (easier): log in to the running dev server in
a browser, open DevTools → Application → Cookies, copy the auth
cookie value. Then:

```bash
curl -s -H "Cookie: <cookie-name>=<cookie-value>" \
  "http://localhost:3000/api/transfers?search=$REF&page=1&limit=8&status=all" \
  | jq '.data[] | {transaction_ref, status}'
```

(b) **Existing helper**: if there is a session-getter script in
`scripts/`, use it. Otherwise stick with (a).

Expected: at least one row returned, including the Deposited
transfer with `transaction_ref: $REF` and `status: "Deposited"`.

Then run the same query *without* `&status=all`:

```bash
curl -s -H "Cookie: <cookie>=<value>" \
  "http://localhost:3000/api/transfers?search=$REF&page=1&limit=8" \
  | jq '.data[] | {transaction_ref, status}'
```

Expected: `data` is empty (or the row is absent). This confirms the
default is still `"not-paid"` and the new `"all"` value is the thing
that re-includes the Deposited row.

If either result is wrong, do NOT proceed. Re-read the edit and
compare against route.ts:58-69.

- [ ] **Step 5: Commit Task 1**

```bash
git add app/api/transfers/route.ts
git commit -m "feat(api/transfers): accept status=all to skip status filter

Adds an explicit \"all\" value to the /api/transfers status switch
that produces no SQL condition. Used by the to-do section's transfer
autocomplete, which needs to see every status (including Deposited)
when looking up a transfer by reference. The default behaviour when
status is omitted is unchanged (still \"not-paid\")."
```

Expected: `1 file changed, 2 insertions(+)`.

---

## Task 2: Pass `status=all` from both to-do autocomplete call sites

**Files:**
- Modify: `app/to-do/page.tsx:219` (Create-Task modal autocomplete)
- Modify: `app/to-do/page.tsx:758` (Edit-Task modal autocomplete)

Two near-identical edits. Both currently call `/api/transfers?search=...`
with no `status` param — they inherit the listing-page default of
`"not-paid"`, which silently hides Deposited transfers.

- [ ] **Step 1: Edit the Create-Task autocomplete URL (line 219)**

Open `app/to-do/page.tsx`. Locate line 219:

```ts
        const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8`);
```

Replace with:

```ts
        const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8&status=all`);
```

The surrounding `useEffect` block (lines 212-226) is unchanged.

- [ ] **Step 2: Edit the Edit-Task autocomplete URL (line 758)**

Still in `app/to-do/page.tsx`. Locate line 758 — it is identical
to the line we just edited but lives inside the Edit-Task modal
component (around line 670-790). Replace:

```ts
        const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8`);
```

with:

```ts
        const r = await apiFetch(`/api/transfers?search=${encodeURIComponent(q)}&page=1&limit=8&status=all`);
```

Sanity check: after the two edits, `grep -n "/api/transfers?search=" app/to-do/page.tsx`
should show **two** lines, **both** ending in `&status=all`.

- [ ] **Step 3: Verify lint and that the dev server hot-reloads cleanly**

Run:

```bash
npm run lint
```

Expected: no errors in `app/to-do/page.tsx`. Then check the dev
server console (still running from Task 1 Step 3): there should be
no compile errors after the file save.

- [ ] **Step 4: Manual UI verification — Create-Task modal**

In a browser at `http://localhost:3000`:

1. Navigate to the **To-Do** page.
2. Click the button to create a new task ("New Task" / "Create Task").
3. In the "Transfer reference" field, type the first 4-5 chars of `$REF`
   (the Deposited transaction_ref from pre-flight Step 2).
4. **Expected:** the autocomplete dropdown shows the Deposited transfer
   with status badge "Deposited", sender → beneficiary, and amount.
5. Click the row. **Expected:** the field locks in the reference, the
   summary card appears below, and the Customer field auto-fills.

If the Deposited transfer does NOT appear: open DevTools → Network,
inspect the `/api/transfers?search=...` request, confirm the URL
includes `&status=all`. If it does and the row is still missing,
re-run the curl from Task 1 Step 4 to isolate whether it is a
server- or client-side issue.

- [ ] **Step 5: Manual UI verification — non-Deposited transfer also visible**

Cancel out of any open modal and click "Create Task" again. In the
"Transfer reference" field, type the first 4-5 chars of `$REF_OTHER`
(the non-Deposited reference from pre-flight Step 2).

**Expected:** the autocomplete shows the non-Deposited transfer with
its actual status badge (e.g. "Processed" or "Pending"). This
confirms the fix is general — it is not Deposited-only.

- [ ] **Step 6: Manual UI verification — Edit-Task modal**

In the same browser session:

1. On the To-Do page, find any existing task and open its edit modal.
2. In the "Transfer reference" field, clear the current value and
   type the first 4-5 chars of `$REF`.
3. **Expected:** the autocomplete dropdown shows the Deposited
   transfer (same as Create-Task).
4. Select it and save the task. **Expected:** the saved task shows the
   Deposited transfer's reference as a badge linking to its detail page.

- [ ] **Step 7: Regression check — `/transfers` listing page is unchanged**

Navigate to `/transfers`. Click through the status tabs:

- "Not Paid" tab → no Deposited rows visible.
- "Paid" tab → only Deposited rows visible.
- Search for `$REF` while on "Not Paid" → no results.
- Search for `$REF` while on "Paid" → the Deposited row appears.

This confirms that the `/transfers` listing page (which always sends
an explicit `status` from its filter UI) is not affected by the API
change.

- [ ] **Step 8: Stop the dev server**

In the terminal running `npm run dev`, press `Ctrl+C`.

- [ ] **Step 9: Commit Task 2**

```bash
git add app/to-do/page.tsx
git commit -m "fix(to-do): show Deposited transfers in autocomplete

Both autocomplete call sites in the To-Do section (Create-Task and
Edit-Task modals) now pass status=all to /api/transfers, so the
endpoint does not apply its default \"not-paid\" filter. Previously,
typing the transaction_ref or data_field_id of a Deposited transfer
returned no rows, making it impossible to associate a settled
transfer with a task."
```

Expected: `1 file changed, 2 insertions(+), 2 deletions(-)`.

---

## Done

Two commits on the current branch:

1. `feat(api/transfers): accept status=all to skip status filter`
2. `fix(to-do): show Deposited transfers in autocomplete`

The fix is testable end-to-end in a browser. No schema changes, no
new endpoints, no new dependencies.
