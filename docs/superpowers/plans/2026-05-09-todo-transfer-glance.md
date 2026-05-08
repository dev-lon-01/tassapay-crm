# To-Do Transfer At-A-Glance Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task in the to-do list is expanded (desktop) or tapped (mobile) and is linked to a transfer, render a small "glance" card showing status, send→receive amounts, beneficiary, and Tayo ref.

**Architecture:** New `<TransferGlance>` leaf component fetches `GET /api/transfers/details/[id]` on mount and renders a two-line card. Desktop auto-loads on row expand; mobile is gated behind a "Show transfer info" toggle to avoid N requests on page load. Status badge logic is lifted from `app/transfers/page.tsx` into a shared `<TransferStatusBadge>` so both pages share styling.

**Tech Stack:** Next.js 13 App Router (client components), React, TypeScript, Tailwind, lucide-react icons, existing `apiFetch` helper.

**Spec:** [docs/superpowers/specs/2026-05-09-todo-transfer-glance-design.md](../specs/2026-05-09-todo-transfer-glance-design.md)

**Branch:** `feat/todo-transfer-glance` (already created and pushed; spec lives on the branch).

**Verification model:** This codebase does not use a unit test framework (per the spec's "Testing" section — script-based verification + manual smoke). Each task verifies via `npx tsc --noEmit` (type-check) and a final task does the full manual smoke matrix. No Jest/Vitest is added.

---

## File map

**New files:**

- `src/components/TransferStatusBadge.tsx` — shared status badge (lifted from `app/transfers/page.tsx:121-145`).
- `src/components/TransferGlance.tsx` — the at-a-glance card.

**Modified files:**

- `app/transfers/page.tsx` — replace inline `StatusBadge` with imported `TransferStatusBadge`.
- `app/to-do/page.tsx` — render `<TransferGlance>` in `TaskRow` expansion; add toggle + render in `MobileTaskCard`.

No API or DB changes.

---

## Task 1: Lift `StatusBadge` into a shared component

**Why first:** `TransferGlance` (Task 2) needs the same status badge. Lifting first means Task 2 can import it cleanly. It also keeps the visual style identical between the to-do page and the transfers list.

**Files:**
- Create: `src/components/TransferStatusBadge.tsx`
- Modify: `app/transfers/page.tsx` (delete inline badge at lines 119-145; import the shared one; existing usages at lines 317 and 379 keep using `<StatusBadge ... />` after a rename or can switch to `<TransferStatusBadge ... />`)

- [ ] **Step 1: Create the shared component**

Create `src/components/TransferStatusBadge.tsx`:

```tsx
"use client";

const PROCESSED = new Set(["Completed", "Deposited", "Paid"]);
const CANCELLED = new Set(["Cancelled", "Cancel", "Rejected"]);

export interface TransferStatusBadgeProps {
  status: string | null;
  /** Rendered when status is null. Defaults to em-dash. */
  emptyValue?: string;
}

export function TransferStatusBadge({
  status,
  emptyValue = "—",
}: TransferStatusBadgeProps) {
  if (!status) {
    return <span className="text-xs text-slate-400">{emptyValue}</span>;
  }
  if (PROCESSED.has(status)) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        {status}
      </span>
    );
  }
  if (CANCELLED.has(status)) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Replace the inline badge in `app/transfers/page.tsx`**

Open `app/transfers/page.tsx`. At the top of the file, add the import next to the other `@/src/...` imports:

```ts
import { TransferStatusBadge } from "@/src/components/TransferStatusBadge";
```

Delete lines 119-145 (the `// ─── status badge ───` block defining `PROCESSED`, `CANCELLED`, and the local `StatusBadge` function). The `EMPTY_VALUE` constant referenced inside the original function lives elsewhere in the file — check whether removing the block leaves it unused. If `EMPTY_VALUE` was only used in the inline badge, remove its definition too (search the file for `EMPTY_VALUE` to confirm); if it's used elsewhere, leave it alone.

Replace the two existing usages:
- Line 317: `<StatusBadge status={transfer.status} />` → `<TransferStatusBadge status={transfer.status} />`
- Line 379: `<StatusBadge status={transfer.status} />` → `<TransferStatusBadge status={transfer.status} />`

(Line numbers are approximate after edits — search for `<StatusBadge` to find them.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. (If pre-existing errors are present, they should be unchanged.)

- [ ] **Step 4: Visual smoke on transfers page**

Run: `npm run dev`
Open `http://localhost:3000/transfers`. Confirm status pills render exactly as before (emerald for Deposited/Completed/Paid, slate for Cancelled/Rejected, amber for everything else).

- [ ] **Step 5: Commit**

```bash
git add src/components/TransferStatusBadge.tsx app/transfers/page.tsx
git commit -m "refactor(transfers): lift StatusBadge into shared TransferStatusBadge component"
```

---

## Task 2: Create `TransferGlance` component

**Files:**
- Create: `src/components/TransferGlance.tsx`

**Pattern reference:** Mirrors the loading/cancel/silent-on-error pattern from `src/components/AccountVerificationsList.tsx` (existing component fetching transfer-scoped data and rendering inline).

- [ ] **Step 1: Create the component file**

Create `src/components/TransferGlance.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/src/lib/apiFetch";
import { TransferStatusBadge } from "@/src/components/TransferStatusBadge";

interface TransferDetailResponse {
  status: string | null;
  send_amount: number | string | null;
  send_currency: string | null;
  receive_amount: number | string | null;
  receive_currency: string | null;
  beneficiary_name: string | null;
  data_field_id: string | null;
}

interface TransferGlanceData {
  status: string | null;
  sendAmount: string | null;
  sendCurrency: string | null;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  beneficiaryName: string | null;
  tayoRef: string | null;
}

export interface TransferGlanceProps {
  transferId: number;
}

function formatAmount(value: number | string | null): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TransferGlance({ transferId }: TransferGlanceProps) {
  const [data, setData] = useState<TransferGlanceData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setData(null);

    apiFetch(`/api/transfers/details/${transferId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { transfer?: TransferDetailResponse };
        if (!body.transfer) throw new Error("missing transfer");
        return body.transfer;
      })
      .then((t) => {
        if (cancelled) return;
        setData({
          status: t.status,
          sendAmount: formatAmount(t.send_amount),
          sendCurrency: t.send_currency,
          receiveAmount: formatAmount(t.receive_amount),
          receiveCurrency: t.receive_currency,
          beneficiaryName: t.beneficiary_name,
          tayoRef: t.data_field_id,
        });
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [transferId]);

  if (phase === "loading") {
    return (
      <div
        aria-hidden
        className="mt-2 h-12 animate-pulse rounded-lg border border-slate-200 bg-slate-100"
      />
    );
  }

  if (phase === "error" || !data) return null;

  const beneficiary = data.beneficiaryName ?? "Unknown";
  const amounts =
    data.sendAmount && data.sendCurrency && data.receiveAmount && data.receiveCurrency
      ? `${data.sendAmount} ${data.sendCurrency} → ${data.receiveAmount} ${data.receiveCurrency}`
      : null;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TransferStatusBadge status={data.status} />
        {amounts && (
          <span className="text-xs font-medium text-slate-700">{amounts}</span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        <span>Beneficiary: {beneficiary}</span>
        {data.tayoRef && (
          <>
            <span className="mx-2 text-slate-300">•</span>
            <span>
              Tayo: <span className="font-mono text-slate-600">{data.tayoRef}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
```

**Note on the API response shape:** The endpoint at `app/api/transfers/details/[id]/route.ts` returns a JSON object — verify the exact wrapper key by reading the route's success path. The component above assumes `{ transfer: {...} }` based on similar endpoints in this codebase. If the actual shape is different (e.g. the row is returned at the top level, or under a different key), adjust the destructuring in the `.then` handler. This is the only point in the file that depends on the API contract.

- [ ] **Step 2: Verify the API response shape matches**

Read `app/api/transfers/details/[id]/route.ts` end-to-end and confirm what JSON shape the success path returns. If it returns the row directly (not wrapped), change:

```ts
const body = (await r.json()) as { transfer?: TransferDetailResponse };
if (!body.transfer) throw new Error("missing transfer");
return body.transfer;
```

to whatever shape the endpoint actually uses (e.g. `const body = (await r.json()) as TransferDetailResponse; return body;`).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/TransferGlance.tsx
git commit -m "feat(to-do): add TransferGlance component for at-a-glance transfer info"
```

---

## Task 3: Wire `TransferGlance` into desktop `TaskRow`

**Files:**
- Modify: `app/to-do/page.tsx` (the `TaskRow` expanded `<tr>` body around lines 1473-1492)

- [ ] **Step 1: Add the import**

In `app/to-do/page.tsx`, near the other `@/src/...` imports (around line 22), add:

```ts
import { TransferGlance } from "@/src/components/TransferGlance";
```

- [ ] **Step 2: Render `TransferGlance` in the expanded row**

Find the existing expansion block in `TaskRow` (currently around lines 1473-1492). It looks like:

```tsx
{expanded && (
  <tr className="border-t border-slate-100 bg-slate-50/40">
    <td colSpan={8} className="px-5 py-3">
      {task.description && (
        <p className="mb-2 text-sm text-slate-600">{task.description}</p>
      )}
      {task.transfer_reference && (
        <a
          href={task.transfer_id ? `/transfers/${task.transfer_id}` : `/transfers?search=${encodeURIComponent(task.transfer_reference ?? "")}`}
          className="mb-2 inline-flex items-center rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
        >
          Transfer: {task.transfer_reference}
          <ExternalLink size={10} className="ml-1" />
        </a>
      )}
      <CommentsList taskId={task.id} commentKey={commentKey} />
      <AddCommentInline taskId={task.id} onAdded={handleCommentAdded} />
    </td>
  </tr>
)}
```

After the existing transfer pill (and before `<CommentsList />`), insert:

```tsx
{task.transfer_id != null && <TransferGlance transferId={task.transfer_id} />}
```

The full block becomes:

```tsx
{expanded && (
  <tr className="border-t border-slate-100 bg-slate-50/40">
    <td colSpan={8} className="px-5 py-3">
      {task.description && (
        <p className="mb-2 text-sm text-slate-600">{task.description}</p>
      )}
      {task.transfer_reference && (
        <a
          href={task.transfer_id ? `/transfers/${task.transfer_id}` : `/transfers?search=${encodeURIComponent(task.transfer_reference ?? "")}`}
          className="mb-2 inline-flex items-center rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
        >
          Transfer: {task.transfer_reference}
          <ExternalLink size={10} className="ml-1" />
        </a>
      )}
      {task.transfer_id != null && <TransferGlance transferId={task.transfer_id} />}
      <CommentsList taskId={task.id} commentKey={commentKey} />
      <AddCommentInline taskId={task.id} onAdded={handleCommentAdded} />
    </td>
  </tr>
)}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4: Visual smoke (desktop)**

Run: `npm run dev`. Open `http://localhost:3000/to-do`. Find a task that has a `transfer_reference` and a `transfer_id`. Click to expand the row. Confirm the glance card appears below the existing `Transfer:` pill, showing status badge, amounts, beneficiary, and Tayo ref. Confirm a task without a transfer renders nothing extra. Confirm a task with `transfer_reference` but no `transfer_id` (orphan) shows the existing pill but no glance card.

- [ ] **Step 5: Commit**

```bash
git add app/to-do/page.tsx
git commit -m "feat(to-do): show TransferGlance in expanded TaskRow on desktop"
```

---

## Task 4: Wire `TransferGlance` into `MobileTaskCard` with toggle

**Files:**
- Modify: `app/to-do/page.tsx` (the `MobileTaskCard` body around lines 1497-1561)

**Why a toggle here:** Mobile cards have no collapsed state and a list can have many transfer-linked cards. Auto-fetching on every card mount fires N parallel requests on page load. A tap-to-load toggle is the cheap mitigation.

- [ ] **Step 1: Add `ChevronDown` and `ChevronUp` to the lucide-react imports**

The existing import block in `app/to-do/page.tsx` (lines 5-21) imports several icons. Add `ChevronDown` and `ChevronUp` to that list (alphabetically, near the existing `ChevronLeft`/`ChevronRight`).

After the change, the relevant import lines look like:

```ts
import {
  ClipboardList,
  Plus,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Circle,
  Minus,
  ExternalLink,
  MessageSquare,
  Pencil,
} from "lucide-react";
```

- [ ] **Step 2: Add `showGlance` state and toggle to `MobileTaskCard`**

Find the `MobileTaskCard` function (currently around line 1499). At the top of the function body, alongside the existing `commentKey` state, add:

```ts
const [showGlance, setShowGlance] = useState(false);
```

Find the existing transfer pill in `MobileTaskCard` (currently around lines 1531-1539):

```tsx
{task.transfer_reference && (
  <a
    href={task.transfer_id ? `/transfers/${task.transfer_id}` : `/transfers?search=${encodeURIComponent(task.transfer_reference ?? "")}`}
    className="mb-2 inline-flex items-center rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
  >
    Transfer: {task.transfer_reference}
    <ExternalLink size={10} className="ml-1" />
  </a>
)}
```

Immediately after this block, add the toggle button + the conditional `<TransferGlance />`:

```tsx
{task.transfer_id != null && (
  <div className="mb-2">
    <button
      type="button"
      onClick={() => setShowGlance((v) => !v)}
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
    >
      {showGlance ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      {showGlance ? "Hide transfer info" : "Show transfer info"}
    </button>
    {showGlance && <TransferGlance transferId={task.transfer_id} />}
  </div>
)}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4: Visual smoke (mobile viewport)**

Run: `npm run dev`. Open `http://localhost:3000/to-do` and resize the browser narrow enough to trigger the mobile card layout (or use devtools device toolbar). Confirm:
- Cards with a transfer show a `▾ Show transfer info` button below the existing pill.
- Tapping it loads the glance card (loading skeleton briefly, then populated card).
- The label flips to `▴ Hide transfer info` and tapping again hides the card.
- Cards without a transfer (or with `transfer_reference` only and no `transfer_id`) show no toggle and no card.

- [ ] **Step 5: Commit**

```bash
git add app/to-do/page.tsx
git commit -m "feat(to-do): show TransferGlance behind toggle on MobileTaskCard"
```

---

## Task 5: Full smoke matrix + build

**Files:** none (verification only).

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: build succeeds with no new errors. Pre-existing warnings can be left alone.

- [ ] **Step 2: Run the smoke matrix in `npm run dev`**

Open `http://localhost:3000/to-do` and verify each case:

| Case | Expected |
|---|---|
| Desktop: task with `transfer_id` set | Expanding the row auto-loads the glance card with status, amounts, beneficiary, Tayo ref. |
| Desktop: task with `transfer_reference` but no `transfer_id` (orphan) | Existing pill renders; no glance card; no toggle. |
| Desktop: task with no transfer at all | Nothing new renders; comments + description unchanged. |
| Desktop: re-expand same row | Glance re-fetches and re-renders (acceptable per spec). |
| Mobile: task with `transfer_id` set | "Show transfer info" toggle visible; tapping loads card; tapping again hides. |
| Mobile: orphan task | Pill renders; no toggle; no card. |
| Region fence: log in as agent whose `allowed_regions` excludes the transfer's destination country | API returns 404; component renders nothing; existing pill still links out. |
| Status badge consistency | Glance card status pill uses identical styling to the transfers list page (emerald / slate / amber by status group). |
| Amount formatting | Numeric amounts render with thousands separators and 2 decimal places (e.g. `200.00 GBP → 14,500.00 ETB`). |

- [ ] **Step 3: Open the existing PR for review**

The PR (`feat/todo-transfer-glance` → `main`) was opened during brainstorming with only the spec. After all task commits land on the branch and are pushed, the implementation appears in the same PR. Update the PR description if needed to reflect that the implementation is now included alongside the spec.

```bash
git push
```

- [ ] **Step 4: No commit needed for this task**

This task is verification only. If any smoke case fails, fix it in a follow-up commit referencing the failing case.

---

## Self-review notes

- **Spec coverage:**
  - Status / amounts / beneficiary / Tayo ref → all rendered in Task 2 component code.
  - Desktop auto-load on expand → Task 3.
  - Mobile gated behind toggle → Task 4.
  - Orphan-task case (`transfer_id` null) → guarded with `task.transfer_id != null` in both Task 3 and Task 4.
  - Region fence → endpoint returns 404; Task 2 component goes to `phase = "error"` and renders null. Smoke matrix in Task 5 covers it.
  - Silent on error → Task 2 component returns null in error state.
  - Loading skeleton → Task 2 returns muted pulse div.
  - Status badge consistency with transfers page → addressed by lifting in Task 1 and reusing in Task 2.
  - No API or DB changes → confirmed; only `app/transfers/page.tsx`, `app/to-do/page.tsx`, and two new files in `src/components/` are touched.

- **Placeholder scan:** No TBDs. The one open question — exact JSON wrapper shape from `/api/transfers/details/[id]` — is called out explicitly in Task 2 Step 2 with concrete instructions on how to verify and what to change.

- **Type / name consistency:** `TransferGlance` and `TransferGlanceProps` used consistently. `TransferStatusBadge` used consistently. `transferId` (camelCase) is the prop name throughout; `transfer_id` (snake_case) is the field name from the task row data — distinction preserved.
