> **PRD** — drafted by Ada (Sr. Product Mgr) · task #376
> _Each agent that updates this PRD signs its change below._

# PRD: Timecard Submit/Approve Workflow (Hourly Engagements)

---

## Problem & Goal

Hourly engagements have a `timecards` table (migration 0269) but no API surface, no lifecycle state machine, and no connection between logged activity signals and billable invoice lines. Contractors cannot submit timecards; clients cannot approve or reject them; the billing pipeline has no hourly input.

**Goal:** Build the complete timecard lifecycle — log → submit → approve/reject — so that an approved timecard automatically generates a billable invoice line and, via the payout system (#371), triggers contractor pay-on-approval.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Contractor (hourly)** | Log hours via activity signals or manual entry, submit a timecard for a billing period, receive payment on approval |
| **Client** | Review submitted timecards with supporting activity detail, approve or reject with optional feedback |
| **Finance / Platform Admin** | Audit timecard state history, override stalled timecards, reconcile billable lines |
| **Billing Pipeline (system)** | Consume approved timecards to emit invoice line-items without manual intervention |

---

## Scope

This work covers the **hourly engagement billing path only**, from the point a timecard record exists through to a posted invoice line. It does not redesign fixed-price milestones or retainer billing.

---

## Functional Requirements

### 1. Timecard Data Model

**FR-1.1** Add a `status` column to `timecards` with the following enumerated states:

```
DRAFT → SUBMITTED → APPROVED | REJECTED → (RESUBMITTED →) APPROVED
```

**FR-1.2** Add audit columns: `submitted_at`, `reviewed_at`, `reviewed_by`, `rejection_reason`, `resubmission_count` (int, default 0).

**FR-1.3** A timecard belongs to one `engagement` (hourly type only), one `contractor`, and one billing `period` (ISO week or calendar week, site-configurable). Unique constraint: one non-voided timecard per contractor × engagement × period.

**FR-1.4** Wire `activity_signals` → timecard aggregation: a background job (or on-submit trigger) sums approved `activity_signals` rows for the period into `logged_minutes`; manual line items remain a separate `timecard_entries` child table.

---

### 2. API — `timecard_routes.ts`

Create `/api/v1/timecards` with the following endpoints:

| Method | Path | Actor | Description |
|---|---|---|---|
| `GET` | `/timecards` | Contractor, Client, Admin | List timecards; filterable by engagement, period, status |
| `GET` | `/timecards/:id` | Contractor, Client, Admin | Fetch single timecard with entries and activity signal summary |
| `POST` | `/timecards` | Contractor | Create a DRAFT timecard for a period (idempotent) |
| `POST` | `/timecards/:id/entries` | Contractor | Add/edit manual time entries while in DRAFT |
| `POST` | `/timecards/:id/submit` | Contractor | Transition DRAFT → SUBMITTED; locks entries |
| `POST` | `/timecards/:id/approve` | Client | Transition SUBMITTED → APPROVED; triggers billing |
| `POST` | `/timecards/:id/reject` | Client | Transition SUBMITTED → REJECTED; `rejection_reason` required |
| `POST` | `/timecards/:id/resubmit` | Contractor | Transition REJECTED → SUBMITTED; increments resubmission count |
| `DELETE` | `/timecards/:id` | Contractor | Soft-delete DRAFT only (set status = VOIDED) |

**FR-2.1** All state-transition endpoints must validate the current status before applying the transition; return `409 Conflict` on invalid transition.

**FR-2.2** Role-based guards: only the owning contractor may submit/resubmit; only the engagement's client-side admin may approve/reject; platform admin may do either.

**FR-2.3** Clients receive an email + in-app notification when a timecard is submitted. Contractors receive notification on approve or reject.

---

### 3. Activity Signal → Timecard Resolution

**FR-3.1** A `resolveActivitySignals(timecardId)` service function queries `activity_signals` where `engagement_id` matches, `period` overlaps, and signal status is not `disputed`. Aggregate total minutes, attach signal IDs to the timecard as supporting evidence.

**FR-3.2** Call `resolveActivitySignals` on `submit`; re-run on `resubmit` to capture any late-arriving signals.

**FR-3.3** Clients can view the activity signal breakdown (time blocks, app activity, screenshots if enabled) on the timecard detail endpoint.

---

### 4. Billing Integration — Invoice Line Generation

**FR-4.1** On `APPROVED` transition, atomically create an `invoice_line_items` record:

```
engagement_id, timecard_id, contractor_id, client_id,
period_start, period_end,
hours: (approved_minutes / 60),
rate: engagement.hourly_rate,
amount: hours × rate,
currency, status: PENDING_INVOICE
```

**FR-4.2** The `invoice_line_items` insert and the timecard status update must be wrapped in a single database transaction; roll back both on failure.

**FR-4.3** Emit a `timecard.approved` domain event consumed by the billing service to group lines into invoices per billing cycle.

---

### 5. Payout Integration (depends on #371)

**FR-5.1** On `timecard.approved` event, if the payout system (#371) is available, enqueue a `payout.schedule` job for the contractor: amount = contractor's net (amount minus platform fee), `available_after` = engagement's payment-terms offset.

**FR-5.2** If #371 is not yet deployed, the `timecard.approved` handler must degrade gracefully (log warning, do not block invoice line creation).

---

### 6. Admin & Audit

**FR-6.1** Admin endpoint `POST /timecards/:id/void` transitions any non-APPROVED timecard to VOIDED with a required admin note. Approved timecards require a credit-memo flow (out of scope here; see FR exclusions).

**FR-6.2** All state transitions write a row to a `timecard_events` audit log: `timecard_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `timestamp`, `metadata` (JSON).

**FR-6.3** Admin list view exposes filter by status, engagement, contractor, and date range for operational support.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A contractor on an hourly engagement can create a DRAFT timecard, add manual time entries, and submit it via `POST /timecards/:id/submit`; status becomes SUBMITTED. |
| AC-2 | On submit, `activity_signals` for the period are resolved and attached; `logged_minutes` is populated correctly. |
| AC-3 | The client receives a notification (email + in-app) upon timecard submission. |
| AC-4 | Client calls `POST /timecards/:id/approve`; status becomes APPROVED and a matching `invoice_line_items` row is created in the same transaction. |
| AC-5 | `invoice_line_items.amount` equals `(approved_minutes / 60) × engagement.hourly_rate` within 0.01 currency precision. |
| AC-6 | Client calls `POST /timecards/:id/reject` with `rejection_reason`; status becomes REJECTED; contractor receives notification. |
| AC-7 | Contractor resubmits a REJECTED timecard; `resubmission_count` increments; activity signals are re-resolved. |
| AC-8 | A `timecard_events` row exists for every state transition with correct actor and timestamp. |
| AC-9 | Attempting an invalid state transition (e.g., approve an already-APPROVED timecard) returns `409 Conflict`. |
| AC-10 | Non-parties (wrong contractor, wrong client) cannot access or mutate a timecard; return `403 Forbidden`. |
| AC-11 | If the payout system (#371) is unavailable, timecard approval still succeeds and the invoice line is created; a warning is logged but no exception surfaces to the caller. |
| AC-12 | End-to-end smoke test: hourly engagement → log activity signals → create timecard → submit → approve → assert invoice line exists with correct amount. |

---

## Out of Scope

- **Fixed-price milestone billing** — separate workflow, not touched here.
- **Retainer / subscription billing** — separate workflow.
- **Timecard credit memos / reversal of approved timecards** — requires dedicated credit-memo flow; admin void covers DRAFT/SUBMITTED/REJECTED only.
- **Dispute resolution on activity signals** — signals may be flagged disputed upstream; this PRD consumes only non-disputed signals.
- **Client-side time-tracking UI / browser extension** — frontend screens are a separate delivery; this PRD covers the API contract only.
- **Multi-currency conversion** — amounts stored in engagement currency; FX is a platform-level concern outside this feature.
- **Automated timecard creation by cron** — period auto-creation is desirable future work; contractors create DRAFTs manually or via a separate scheduler ticket.
- **Payout system internals** — consumed as a dependency via #371; not designed or implemented here.