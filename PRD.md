> **PRD** — drafted by Ada (Sr. Product Mgr) · task #371
> _Each agent that updates this PRD signs its change below._

# PRD: Freelancer Payout System (GAP P0-2)

## Problem & Goal

The current platform has no automated payout path for freelancers. The `payout` query returns zero results, `freelancer_invoices` has no payout-provider integration, and the sole mechanism for marking a freelancer paid is a manual database operation introduced in migration 0273. Escrowed funds are never automatically released, creating financial and trust risk for all parties.

**Goal:** Wire an environment-gated Stripe Connect payout integration so that escrowed funds are automatically released to freelancers when a deliverable is accepted or a timecard is approved, moving the invoice from `pending` → `paid` and storing an external reference for reconciliation.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **Freelancer** | Receives timely, automated payment without manual intervention from staff |
| **Client** | Funds leave escrow only on confirmed acceptance; no double-charge risk |
| **Platform Ops / Finance** | Full audit trail; ability to reconcile payouts against Stripe Dashboard |
| **Engineering / DevOps** | Feature is env-gated and safe to deploy to staging without moving real money |

---

## Scope

This document covers the end-to-end flow from deliverable/timecard acceptance through Stripe Connect transfer to the freelancer's connected account, and the resulting invoice state change. It does not cover onboarding freelancers onto Stripe Connect (assumed pre-existing or handled by a separate workstream).

---

## Functional Requirements

### FR-1 — Environment Gate
- The payout integration **must** be controlled by a single environment variable (e.g., `PAYOUT_PROVIDER=stripe`).
- When the variable is absent or set to `none`, the system falls back to the existing manual `mark_paid` path with no side-effects.
- Staging environments **must** use Stripe test-mode keys; production uses live keys. Both are injected via secrets manager, never hard-coded.

### FR-2 — Trigger Events
The payout pipeline **must** activate on two distinct trigger events:
1. **Deliverable acceptance** — when a deliverable record transitions to `accepted` status.
2. **Timecard approval** — when a timecard record transitions to `approved` status.

Each trigger must be idempotent: re-firing the same event for an already-paid invoice must not initiate a duplicate transfer.

### FR-3 — Escrow Release & Stripe Transfer
- On trigger, the system resolves the associated `freelancer_invoice` record (by `deliverable_id` or `timecard_id`).
- The invoice amount (in the invoice's native currency) is transferred from the platform's Stripe account to the freelancer's Stripe Connect `account_id` using `stripe.transfers.create` (or `stripe.payouts.create` for Express/Custom accounts as appropriate).
- The transfer description must include the platform invoice ID for traceability.
- The system must handle Stripe API errors (rate limits, insufficient platform balance, invalid account) by catching exceptions, logging structured errors, and leaving the invoice in `pending` with a `payout_error` field populated — never silently swallowing failures.

### FR-4 — Invoice State Machine
```
pending ──(trigger event)──► processing ──(Stripe success)──► paid
                                         └─(Stripe failure)──► pending  [payout_error set]
```
- `freelancer_invoices` table requires three new columns (delivered via a single additive migration):
  - `status` — enum: `pending | processing | paid | failed` (default `pending`).
  - `external_ref` — `varchar(255)` nullable — stores the Stripe Transfer or Payout ID (e.g., `tr_xxxxxxxx`).
  - `payout_error` — `text` nullable — stores the last error message if Stripe returns a failure.
- The migration number must follow the existing sequence (next after 0273).
- No existing rows may be deleted or have non-nullable columns added without a default.

### FR-5 — Webhook Reconciliation (Stripe → Platform)
- Register a Stripe webhook endpoint (e.g., `POST /webhooks/stripe/payout`) to receive `transfer.paid`, `transfer.failed`, and `payout.failed` events.
- On `transfer.paid`: confirm the invoice is marked `paid` (idempotent no-op if already set).
- On `transfer.failed` / `payout.failed`: set invoice status back to `pending`, populate `payout_error`, and emit an internal alert/notification for Ops.
- The endpoint must validate the `Stripe-Signature` header using the webhook signing secret before processing any payload.

### FR-6 — `payout` Query / API Endpoint
- The `payout` resolver / REST endpoint must return all invoices where `status IN ('processing', 'paid')` with fields: `invoice_id`, `freelancer_id`, `amount`, `currency`, `status`, `external_ref`, `paid_at`.
- Query must return non-zero results once at least one payout has been processed (acceptance test gate).

### FR-7 — Logging & Audit Trail
- Every state transition must emit a structured log entry containing: `invoice_id`, `freelancer_id`, `trigger_event`, `stripe_transfer_id` (if available), `old_status`, `new_status`, `timestamp`.
- Logs must be queryable by `invoice_id` and `freelancer_id`.

### FR-8 — Permissions & Security
- Stripe secret keys must never appear in application logs or API responses.
- Only internal service roles (not freelancer-facing API tokens) may directly call the payout initiation service.
- Platform Stripe account credentials are stored in the secrets manager and rotated without code deployment.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | With `PAYOUT_PROVIDER=stripe` (test mode), accepting a deliverable triggers a Stripe test-mode transfer and the invoice moves to `paid`. | Integration test against Stripe test API |
| AC-2 | The paid invoice record contains a non-null `external_ref` matching the Stripe Transfer ID format (`tr_...`). | DB assertion in integration test |
| AC-3 | Approving a timecard triggers the same pipeline and satisfies AC-1 and AC-2. | Integration test (timecard path) |
| AC-4 | The `payout` query returns at least one result after AC-1 is satisfied. | API response assertion |
| AC-5 | Re-triggering the acceptance event on an already-`paid` invoice produces no duplicate Stripe transfer. | Idempotency test; Stripe Dashboard event count = 1 |
| AC-6 | With `PAYOUT_PROVIDER` unset, deliverable acceptance invokes the legacy `mark_paid` path only; no Stripe API call is made. | Unit test with Stripe SDK mocked; assert zero calls |
| AC-7 | A simulated Stripe transfer failure leaves the invoice in `pending`, populates `payout_error`, and does not throw an unhandled exception. | Unit test with Stripe error stub |
| AC-8 | The webhook endpoint rejects payloads with an invalid or missing `Stripe-Signature` with HTTP 400. | Security test |
| AC-9 | Migration runs cleanly on a copy of production schema; all existing `freelancer_invoices` rows default to `status = 'pending'` and `external_ref = NULL`. | Migration smoke test on production schema snapshot |
| AC-10 | No Stripe secret key appears in application logs under any code path. | Log scrape assertion in CI |

---

## Out of Scope

- **Freelancer Stripe Connect onboarding** — account creation, KYC, and OAuth linking are handled by a separate workstream; this PRD assumes `stripe_account_id` is already present on the freelancer record.
- **Client-side escrow funding** — how funds arrive in the platform Stripe account is out of scope; this system consumes an already-funded balance.
- **Multi-currency FX conversion** — payouts are issued in the invoice's recorded currency; cross-currency conversion is a future enhancement.
- **Partial payouts / milestone splits** — each invoice maps to exactly one payout event; partial release is out of scope.
- **Tax form generation (1099/W-8)** — compliance document generation is a separate compliance workstream.
- **Freelancer-initiated payout requests** — this system is event-driven from acceptance/approval only; on-demand withdrawal requests are out of scope.
- **Chargeback / dispute handling** — Stripe dispute webhooks and refund flows are handled by the billing team, not this workstream.
- **UI / dashboard changes** — no front-end work is in scope; state is observable via existing admin queries and Stripe Dashboard.