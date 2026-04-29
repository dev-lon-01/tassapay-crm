# Team Operational Plan: Tiered Support via Tasks Page

## Context

Tassapay is a 1–3 person team handling customer requests primarily over **WhatsApp** and **phone**. We want a lightweight 1st/2nd/3rd-level support flow tracked in the existing `/to-do` page, with **no new code in Phase 1** — relying entirely on the fields already in `tasks` (category, priority, status, assigned_agent_id, comments). WhatsApp intake stays manual (tag in task) until volume justifies a Twilio webhook.

Because the team is small, **tiering is a workflow discipline, not an org structure** — the same person may wear L1/L2/L3 hats on different tasks. The tier label tells you *what kind of work* this is, not *who* must do it.

**L1 is a dual-mode role.** When inbound contacts arrive, L1 is reactive — answer, triage, resolve or escalate. When the inbound queue is quiet, L1 switches to **proactive outbound**: sales follow-ups, re-engagement of dormant customers, KYC chase-ups, hot-lead conversion. Both modes use the same tasks page; the difference is *what the task represents* and *which queue drove it*.

---

## 1. Tier definitions (work types, not job titles)

| Tier | Work type | Examples | Existing field that signals this |
|------|-----------|----------|----------------------------------|
| **L1 — Frontline (reactive + outbound)** | Inbound triage, simple resolutions, **plus** outbound sales/re-engagement | Inbound: status of transfer, "where's my money", password reset, sending KYC link, beneficiary address change. Outbound: dormant-customer call-backs, KYC chase, hot-lead conversion, post-first-transfer welcome. | `category: Query` (inbound) or `Action` with `[Type: Sales]` / `[Type: Re-engagement]` tag (outbound) |
| **L2 — Specialist** | Investigation needed, requires CRM/payment data | Stuck transfer, payment-not-received, KYC document review, refund decision, beneficiary issues. **Specifically:** Belmoney AML query responses (flag reviews, EDD requests), Sumsub KYC failure reviews (rejected docs, identity mismatch, watchlist hits), transfer SLA breaches (delayed payments, wrong beneficiary details, pending-action transfers needing correction or customer re-contact) | `category: KYC` or `Payment_Issue` |
| **L3 — Senior / engineering** | Provider/system issue, regulatory, fraud | Backoffice sync failures, fraud holds, compliance escalation, anything needing dev input | `category: Action` + `priority: Urgent` |

**Rule of thumb:** if you can resolve it in <5 min from CRM data alone → L1. If it needs Tayo/Volume/Belmoney lookup or judgement → L2. If it needs code, vendor support, or compliance sign-off → L3.

**L1 priority order when picking next work** (top wins):
1. Live inbound call/WhatsApp (drop everything)
2. Tasks assigned to me with `priority: Urgent` or `High`
3. Tasks assigned to me with status `In_Progress` (don't leave half-done work)
4. Tasks waiting on customer reply older than SLA (chase)
5. **Outbound queues** (the proactive mode — see §5b)

---

## 2. Intake flow (every channel, same shape)

```
[ WhatsApp / Phone / Email ]
            │
            ▼
   1. Capture in CRM
            │
            ▼
   2. Triage to a tier
            │
            ▼
   3. Resolve OR escalate
            │
            ▼
   4. Close with resolution comment
```

### Step 1 — Capture (always within 2 minutes of first contact)

Open `/to-do → New Task`. Fill the modal:

| Field | What to put | Why |
|-------|-------------|-----|
| **Customer** | Search by name/ID/phone, or paste TXN ref | Auto-fills sender from transfer |
| **Transfer Reference** | If they cite a TXN/EFU number | Links task → transfer detail page |
| **Title** | One sentence problem statement | Shows in queue; keep scannable |
| **Description** | Start with `[Channel: WhatsApp]` or `[Channel: Phone]` + verbatim summary of customer's words | Channel tag is the WhatsApp workaround until webhook ships |
| **Category** | See tier table above — drives the L1/L2/L3 label | This is your tier signal |
| **Priority** | See SLA table below | Drives urgency + queue ordering |
| **Assigned to** | Yourself for L1; for L2/L3 either yourself if you can do it now, or whoever owns that area | Keeps queue accountable |

**Phone calls:** the Twilio integration auto-logs the call in `interactions`. Still create a task if any follow-up is needed — the call log alone is not a tracked work item.

### Step 2 — Triage

Read the description, decide tier (L1/L2/L3), set `category` accordingly. If unsure, default to L1 and re-categorize after first investigation.

### Step 3 — Resolve or escalate

- **Resolve immediately** → set status `Closed` with a resolution comment. Done.
- **Working on it, takes >15 min** → set status `In_Progress` so the customer-side view doesn't see it as ignored.
- **Waiting on customer** (more info, document) → status `Pending` + comment "Waiting on: <what>".
- **Need to escalate to a higher tier** → use the escalation template below.

### Step 4 — Close

Closing requires a `resolution_comment` (already enforced by the API). Write it for the *next agent* who reads this customer's history, not for the manager. Three lines max:
1. What the customer asked
2. What we did
3. Outcome (e.g. "Transfer released by Tayo at 14:02. Confirmed receipt by customer on WhatsApp.")

---

## 2b. L2 work-type guide — how to log each case

| Work type | Category | Priority | Title convention | Description must include |
|-----------|----------|----------|-----------------|--------------------------|
| **Belmoney AML query** | `KYC` | `High` (response deadline) | `AML Query – [customer name] – [Belmoney ref]` | Belmoney query ref, what they asked for, deadline date, docs already held |
| **Sumsub KYC fail** | `KYC` | `Medium` (or `High` if transfer on hold) | `KYC Fail – [customer name] – [reason code]` | Sumsub applicant ID, rejection reason (expired doc / mismatch / watchlist), what customer needs to resubmit |
| **Delayed payment / SLA breach** | `Payment_Issue` | `High` (>24h) or `Urgent` (>48h or customer chasing) | `Delayed – [TXN ref] – [day count]d` | Transfer ref linked via Transfer Reference field, expected vs actual SLA, last status in Tayo/Belmoney/Volume, what action is pending |
| **Wrong beneficiary details / pending action** | `Payment_Issue` | `High` | `Pending Action – [TXN ref] – [issue]` | What detail is wrong, whether payment is held or still routing, what customer confirmation is needed before correction |

**For AML and KYC fails, the Sumsub/Belmoney reference must go in the task description** — these are compliance records and need to be traceable. Link the Transfer Reference field when the case is tied to a specific TXN.

---

## 3. Escalation protocol (L1 → L2 → L3)

When a task needs to move tiers, **add a comment** before reassigning. Use this template:

```
ESCALATING L1 → L2
Reason: <why I can't resolve at this tier>
Done so far: <bullet list>
What I need: <specific ask>
Customer expectation set: <what I told them, e.g. "we'll come back within 4 hours">
```

Then change `category` (Query → KYC/Payment_Issue/Action) and reassign `assigned_agent_id`. Status stays `In_Progress`. The comment becomes the audit trail — visible in the expanded task row.

**Never silently reassign.** A reassigned task without an escalation comment is a process violation.

---

## 4. SLA targets (priority-driven)

| Priority | First response | Resolution target | When to use |
|----------|---------------|-------------------|-------------|
| **Urgent** | 15 min | 2 hours | Money missing, suspected fraud, KYC blocking active transfer |
| **High** | 1 hour | Same business day | Transfer stuck >24h, payment dispute, regulator-facing |
| **Medium** | 4 hours | 2 business days | Standard query, KYC re-submission, beneficiary edit |
| **Low** | 1 business day | 5 business days | Feature requests, FYI notes, non-urgent admin |

The `/to-do` queue already sorts by priority then `updated_at`, so urgent work surfaces automatically.

---

## 5a. Daily / weekly rituals (reactive support)

| Cadence | Action | Where |
|---------|--------|-------|
| **Start of day** | Check `My Tasks` view + `Open` view filtered by Urgent/High | `/to-do?view=mine` |
| **Every 2 hours** | Re-check queue; promote/demote priorities if customer chases or context changes | `/to-do?view=open` |
| **End of day** | Anything still `Open` and unassigned → assign or set `Pending` with reason | `/to-do?view=open` (sort by priority) |
| **Weekly review (15 min)** | `/activity` + `/to-do?view=closed`: count by category, look for repeat issues | Activity Report tab |

---

## 5b. L1 outbound mode — sales & re-engagement queues

When the reactive queue is quiet (no live inbound, no Urgent/High open tasks assigned to you), shift into outbound. The CRM already exposes purpose-built customer queues at `/tasks` — each one is a list of *customers* (not tasks) you should call/message proactively.

| Queue | Who's in it | Why call them | Goal of the call |
|-------|-------------|---------------|------------------|
| **Hot leads** | KYC done, 0 transfers | High intent, never converted | Get them to make their first transfer |
| **New customers** | Created <7 days ago | Fresh; warm to onboarding | Welcome call, walk through first send |
| **Incomplete KYC** | Signed up but KYC not finished | Conversion blocker | Help them finish KYC over the call |
| **Dormant** | No interaction >40 days | At-risk customers | Re-engage; ask if anything's blocking them |
| **Portfolio** | Assigned to me | My existing book | Routine check-in, upsell, referral ask |

**Outbound call flow:**

1. Open `/tasks?queue=<hot-leads|new|incomplete|dormant|portfolio>`.
2. Pick the top customer. The phone integration auto-logs the call to `interactions` once you dial.
3. **If the call leads to action** (they want to send money, need follow-up, requested a doc), create a task in `/to-do` tagged with the channel and outbound type:
   ```
   [Channel: Phone] [Type: Sales]      ← for first-transfer / upsell pushes
   [Channel: Phone] [Type: Re-engagement]   ← for dormant winback
   [Channel: Phone] [Type: KYC-chase]   ← for incomplete-KYC follow-ups
   ```
   Assign to yourself, `category: Action`, `priority: Medium` by default. Use `High` only if customer asks for a same-day callback.
4. **If the call is a no-op** (no answer, voicemail, customer says "not interested"), **don't** create a task — the call log in `interactions` is enough. Move to next customer.
5. **If a no-answer hits 3 attempts across 2 weeks**, create a task `[Type: Re-engagement] – give up after 3 attempts` and close with resolution `No-contact, archived`. This caps wasted effort.

**Daily outbound target (suggested baseline):** when in outbound mode, aim for ~10 dials/hour. A reasonable mix per quiet half-day:
- 60% hot leads + new customers (highest ROI)
- 30% dormant
- 10% incomplete KYC

**Why the `[Type: …]` tag matters:** until we add a `task_type` enum (Phase 2), the description tag is the only way to separate sales tasks from support tasks in the closed-task report. Discipline on the tag = trustworthy weekly numbers.

---

## 6. WhatsApp manual-intake convention

Until the inbound webhook is built, every WhatsApp-originated task **must** start with `[Channel: WhatsApp]` on its first description line. This lets us:

- Search the closed queue for `WhatsApp` to estimate channel volume (justifies Phase 2 webhook).
- Spot tasks where a phone follow-up is missing.
- Eventually backfill these into the WhatsApp thread when the webhook ships.

Same for `[Channel: Phone]` (already auto-logs to `interactions` but tag it on the task too for consistency).

---

## 7. Phase 2 — small code helpers (only when team grows past ~3 people)

Defer until the manual workflow shows real friction. Listed here so future-you knows what's possible:

| Enhancement | File | Effort |
|-------------|------|--------|
| Add `tier` enum (`L1`,`L2`,`L3`) to `tasks` table; show as badge | `scripts/migrate-tasks.mjs`, `app/to-do/page.tsx` | ~half day |
| Add a `Channel` dropdown to Create Task modal (replaces `[Channel: …]` convention) | `app/to-do/page.tsx`, schema add | ~1 hour |
| Add a `task_type` enum (`Support`, `Sales`, `Re-engagement`, `KYC-chase`) — replaces `[Type: …]` tag and unlocks reliable weekly reporting | `scripts/migrate-tasks.mjs`, `app/to-do/page.tsx`, todos APIs | ~half day |
| WhatsApp inbound via Twilio webhook → auto-create task | new `app/api/webhooks/whatsapp/route.ts` + Twilio config | ~2 days |
| SLA breach alert (Pushover) when priority+age exceeds target | extend `scripts/sla-alert-worker.mjs` (already exists for transfers) | ~half day |
| Outbound dialer pacing: a "Next customer" button on `/tasks?queue=…` that auto-advances after each call ends | `app/tasks/page.tsx` + `interactions` listener | ~1 day |

---

## Files to change in Phase 1

**None.** This is a process rollout using existing tooling.

The plan deliverable is this document — share it with the team, pin it in your team channel, revisit in 4 weeks to see what broke down.

## Verification

**Reactive flow:**
1. Open `/to-do → New Task`. Walk through the modal once with a fake task using the description template (`[Channel: WhatsApp] …`). Confirm the channel tag is searchable from the search bar after creation.
2. Create a task as L1 (`category: Query, priority: Medium`). Add an escalation comment using the template, change category to `Payment_Issue`, reassign. Confirm the comment is visible in the expanded row and the audit trail reads cleanly.
3. Close the task with a 3-line resolution. Reopen the customer detail page → confirm the task and comments appear in customer history.

**Outbound flow:**
4. Open `/tasks?queue=hot-leads`. Click the top customer, place a test call. Confirm the call is auto-logged in `/customer/[id]` interactions tab.
5. After the call, create a follow-up task tagged `[Channel: Phone] [Type: Sales]`. Confirm searching `Type: Sales` in `/to-do` returns it.
6. After 1 week of running this flow: pull `/to-do?view=closed`, search `[Type: Sales]` and `[Type: Re-engagement]`. Counts should be non-trivial — if zero, the outbound rhythm isn't sticking and §5b needs reinforcement.

**Baseline metric:** at the end of week 1, capture (a) tasks closed by category, (b) outbound tasks created by `[Type: …]` tag, (c) average resolution time per priority. This becomes the data that drives whether Phase 2 helpers are warranted.
