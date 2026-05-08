# To-Do: Transfer "At-A-Glance" Card — Design Spec

**Date:** 2026-05-09
**Status:** Approved (design phase)
**Type:** Small feature (UI-only; no API or DB changes)

## Summary

When a task in the to-do list is expanded (desktop) or tapped (mobile), and the task is linked to a transfer (`transfer_id` is set), show a small "glance" card next to the existing `Transfer: <ref>` pill with the four fields agents almost always need: **status, send→receive amounts, beneficiary, Tayo ref**. The existing pill (which links out to the transfer detail page) is unchanged — the glance card sits below it.

## Goals

- Agents reviewing a task can see the most important transfer details without leaving the to-do page.
- Zero impact on tasks that have no linked transfer.
- No bloat on the task list payload — info is fetched only when the agent actually opens a task.
- Reuses existing endpoints; no backend changes.

## Non-goals

- Caching transfer info across rows or sessions.
- Editing the transfer from inside the glance card (the existing pill still navigates to the full transfer page).
- Surfacing additional fields beyond the four agreed-on fields (status, amounts, beneficiary, Tayo ref).
- Modifying the `/api/tasks` listing payload or any backend endpoint.
- Showing glance info in modals (Create Task / Edit Task) — this design is for the listing page only.

## Architecture

```
┌─ UI ─────────────────────────────────────────────────────────────┐
│  app/to-do/page.tsx                                              │
│    TaskRow         (desktop)  → renders <TransferGlance> on      │
│                                  expand, when task.transfer_id   │
│                                  is set                          │
│    MobileTaskCard  (mobile)   → renders <TransferGlance> when    │
│                                  user taps "Show transfer info"  │
│                                                                  │
│  src/components/TransferGlance.tsx        (new)                  │
│    props: { transferId: number }                                 │
│    self-managed loading + data state via useEffect               │
└─────────────────────────────────────────────────────────────────┘
                          │ GET /api/transfers/details/{transferId}
                          ▼
┌─ API (unchanged) ───────────────────────────────────────────────┐
│  GET /api/transfers/details/[id]                                │
│    already returns: status, send_amount, send_currency,         │
│                      receive_amount, receive_currency,          │
│                      beneficiary_name, data_field_id (Tayo ref) │
│    already enforces region fence via requireAuth                │
└─────────────────────────────────────────────────────────────────┘
```

**Boundaries**

- `TransferGlance` is a leaf component. It does its own fetch, owns its own loading/error state, and renders only when given a numeric `transferId`. It does not know anything about tasks.
- `TaskRow` and `MobileTaskCard` decide *whether* and *when* to mount the component. The component itself is dumb beyond that.

## Behavior

### Desktop (`TaskRow`)

The expanded row currently renders ([app/to-do/page.tsx:1473-1492](app/to-do/page.tsx#L1473-L1492)):

1. Description (if present)
2. The `Transfer: <ref> ↗` pill (if `transfer_reference` is set)
3. Comments list + add comment input

After this change, when `task.transfer_id` is a non-null integer, render `<TransferGlance transferId={task.transfer_id} />` immediately below the pill (and above the comments list). The component auto-fetches on mount.

When the row is collapsed, the expansion `<tr>` is unmounted (existing behavior). Re-expanding will re-mount `TransferGlance` and re-fetch. This is acceptable: the detail endpoint is cheap and behind the region fence; YAGNI on a cache.

### Mobile (`MobileTaskCard`)

Mobile cards have no collapsed state — they always render fully. To avoid firing one request per transfer-linked card on page load (which can be many), gate the fetch behind a local toggle:

1. The existing `Transfer: <ref> ↗` pill is unchanged.
2. Below it, when `task.transfer_id` is set, render a small button: `▾ Show transfer info`.
3. Local `showGlance` state in `MobileTaskCard` flips on tap.
4. When `showGlance` is true, render `<TransferGlance transferId={task.transfer_id} />` and change the button label to `▴ Hide transfer info`.
5. Hiding unmounts the component; showing again re-fetches. Same trade-off as desktop.

### Orphan tasks (`transfer_reference` set, `transfer_id` null)

Some tasks have a `transfer_reference` string but no resolved `transfer_id` (the existing pill falls back to `/transfers?search=...` for these). For these tasks, do **not** render `TransferGlance` — there is no id to fetch. The existing pill is unchanged. This case stays exactly as today.

## The `TransferGlance` component

**Location:** `src/components/TransferGlance.tsx`

**Props:**

```ts
type Props = { transferId: number };
```

**State:**

```ts
const [data, setData] = useState<TransferGlanceData | null>(null);
const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
```

**Fetch:**

`useEffect(() => { ... }, [transferId])` — calls `apiFetch(\`/api/transfers/details/${transferId}\`)`. On success, narrows the response to the four fields we render. On 404 or any error, set status `"error"`.

**Rendering:**

- `loading` → a single muted skeleton line (`bg-slate-100 animate-pulse`, ~one line tall) so the row doesn't visibly jump.
- `error` → render nothing. The existing pill remains as the agent's affordance.
- `ready` → render the card (see Visual below).

**Why silent on error:** the only realistic failures here are (a) region fence (transfer outside the agent's allowed regions), (b) stale id, (c) network. In none of these is a red error banner more useful than the existing link-out pill. Silent failure is the right default.

## Visual

Single rounded card, two lines, in the same slate/indigo palette as the rest of the to-do page. Status reuses the same badge component used on `app/transfers/page.tsx`.

```
[ Transfer: TX-92831 ↗ ]
┌──────────────────────────────────────────────┐
│ ● Deposited   200 GBP → 14,500 ETB           │
│ Beneficiary: Almaz Tesfaye   Tayo: ETH-7842  │
└──────────────────────────────────────────────┘
```

- Card: `rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2`.
- Line 1: status badge + amounts. Amounts in `text-slate-700 font-medium`, arrow in `text-slate-400`.
- Line 2: `Beneficiary: <name>` + `Tayo: <data_field_id>` separated by a small dot. Both in `text-xs text-slate-500`.
- If `data_field_id` is null, omit the `Tayo: …` segment (don't render `Tayo: —`).
- If `beneficiary_name` is null, render `Beneficiary: Unknown` (matches existing usage in the autocomplete dropdown at [app/to-do/page.tsx:435](app/to-do/page.tsx#L435)).

## Status badge

Reuse whatever component already renders transfer status on the transfers list page. If no shared component exists today, the implementation plan can either lift it into a small shared component or inline a minimal badge with the same color scheme. Either is acceptable; this is the implementation plan's call. The visual goal is consistency with the transfers page.

## Files touched

1. **`src/components/TransferGlance.tsx`** — new file. The component described above.
2. **`app/to-do/page.tsx`** — two edits:
   - In `TaskRow`'s expanded `<tr>` body, after the existing `transfer_reference` pill, add `{task.transfer_id && <TransferGlance transferId={task.transfer_id} />}`.
   - In `MobileTaskCard`, after the existing pill, add the `showGlance` toggle and conditionally render `<TransferGlance>`.

No other files change. No API changes. No DB changes.

## Edge cases

| Case | Behavior |
|---|---|
| `task.transfer_id` is null (`transfer_reference` may or may not be set) | `TransferGlance` is not rendered. Existing pill behavior preserved. |
| `task.transfer_id` is set but the transfer is outside the agent's allowed regions | API returns 404. Component renders nothing. Existing pill still links out (which will also 404, same as today). |
| Network error or 5xx | Component renders nothing. Existing pill unaffected. |
| Component is mounted then unmounted before fetch resolves | `useEffect` cleanup must guard against `setState` on unmounted component (standard pattern: an `ignore` flag in the effect closure). |
| `data_field_id` (Tayo ref) is null | Tayo segment omitted; line 2 is just `Beneficiary: <name>`. |
| `beneficiary_name` is null | Render `Beneficiary: Unknown`. |

## Testing

Per project convention (script-based verification, no test framework rollout):

- Manual desktop smoke: open `/to-do`, expand a task with a transfer, confirm card renders with correct fields.
- Manual mobile smoke: in a narrow viewport, tap "Show transfer info" on a card and confirm the card appears.
- Region fence: log in as an agent whose region does not include the transfer's destination; confirm the card silently does not render and the pill still works.
- Orphan task (`transfer_id` null): confirm no toggle / no card; existing pill behavior intact.
- Task with no transfer at all: confirm nothing new renders.

## Risks & mitigations

- **Risk:** Re-expanding a row re-fetches the same transfer. **Mitigation:** acceptable — endpoint is cheap; can add caching later if it becomes a problem. YAGNI now.
- **Risk:** Mobile fetch firing on every "Show" tap. **Mitigation:** same as above; gated behind explicit user intent, so this is fine.
- **Risk:** Visual style drifts from transfers page. **Mitigation:** reuse the status badge from the transfers page; match its palette.
