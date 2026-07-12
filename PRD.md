> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #354
> _Each agent that updates this PRD signs its change below._

# PRD: Helcim Checkout — Recurring Billing Schedule Creation

## Problem & Goal

The Helcim checkout integration processes payments successfully for one-time charges but **never creates a recurring billing schedule**. After a payment is approved, the system must call the Helcim recurring-billing API to enroll the customer in the appropriate billing cycle. Without this, subscription-based customers are charged once and then silently lapse, resulting in lost revenue and manual intervention.

**Goal:** After a Helcim `APPROVED` webhook event is received, automatically create a recurring billing schedule via the Helcim recurring-billing API so that customers are billed on the correct cadence without manual steps.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **End customer** | Expects to be enrolled in a subscription and billed automatically on the agreed schedule |
| **Finance / Billing admin** | Needs recurring revenue to be captured reliably without manual reconciliation |
| **Engineering** | Implements and maintains the webhook handler and API integration |
| **QA / Release** | Validates correct schedule creation across all billing cadences |

---

## Scope

This work covers the server-side logic that runs **after** a Helcim `APPROVED` webhook is received. It does not cover the checkout UI, payment capture flow, or any other payment gateway.

---

## Functional Requirements

### FR-1 — Webhook Handler Extension
- The existing `APPROVED` webhook handler **must** be extended to trigger recurring-billing schedule creation immediately after a successful payment confirmation.
- If the product/plan associated with the transaction is one-time only, the recurring-billing step **must** be skipped gracefully.

### FR-2 — Recurring-Billing API Call
- The system **must** call the Helcim recurring-billing API endpoint (`POST /recurring-billing`) with the following required fields derived from the approved transaction:
  - `customerCode` — from the Helcim customer record created/matched during checkout
  - `cardToken` — tokenised card returned in the approved transaction payload
  - `planCode` (or equivalent) — mapped from the internal product/plan metadata
  - `startDate` — set to the next billing date based on the plan cadence
  - `frequency` — e.g., `monthly`, `weekly`, `yearly`, as defined by the plan
  - `amount` — recurring charge amount (must match plan pricing)
  - Any additional fields required by the Helcim API specification

### FR-3 — Idempotency
- The handler **must** check whether a recurring schedule already exists for the given `customerCode` + `planCode` combination before creating a new one, to prevent duplicate schedules on webhook retries.

### FR-4 — Error Handling & Retries
- If the Helcim recurring-billing API returns a non-success response (4xx or 5xx), the system **must** log the full error (status code, response body, transaction ID) and **must not** silently swallow the failure.
- The system **must** implement an exponential-backoff retry mechanism (minimum 3 attempts) before marking the schedule creation as permanently failed.
- On permanent failure, an alert **must** be raised to the operations/engineering team (e.g., via the existing alerting channel).

### FR-5 — Persistence
- A `recurring_billing_schedules` record (or equivalent) **must** be written to the database upon successful API response, storing:
  - `helcim_schedule_id` (returned by the API)
  - `customer_id` (internal)
  - `plan_id` (internal)
  - `status` (`active`)
  - `created_at`, `next_billing_date`

### FR-6 — Observability
- Structured log entries **must** be emitted at the start and end of each recurring-billing API call, including `transaction_id`, `customer_id`, `plan_id`, and outcome.
- A metric/counter **must** be incremented for both successful and failed schedule creation attempts.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a Helcim `APPROVED` webhook for a subscription plan, when the handler processes the event, then a recurring billing schedule is created in Helcim and a corresponding record exists in the database within 5 seconds of webhook receipt. |
| AC-2 | Given a Helcim `APPROVED` webhook for a one-time-charge product, when the handler processes the event, then no recurring billing schedule is created and no error is raised. |
| AC-3 | Given a duplicate `APPROVED` webhook (retry), when the handler processes the event, then only one recurring billing schedule exists for the customer+plan — no duplicates. |
| AC-4 | Given the Helcim recurring-billing API returns a 5xx error, when the handler processes the event, then the system retries at least 3 times with exponential backoff before marking the job as failed and firing an alert. |
| AC-5 | Given a permanent API failure after retries, when the failure is recorded, then an alert is visible in the operations/engineering channel and the database record reflects `status = failed`. |
| AC-6 | Given any outcome (success or failure), when the handler completes, then structured logs exist containing `transaction_id`, `customer_id`, `plan_id`, and the outcome. |
| AC-7 | Given a successful schedule creation, when QA inspects the Helcim merchant portal, then the recurring billing schedule appears with the correct amount, frequency, and start date matching the plan definition. |

---

## Out of Scope

- Changes to the Helcim checkout UI or payment capture flow
- Support for any payment gateway other than Helcim
- Customer-facing subscription management (pause, cancel, modify) — handled in a separate workstream
- Prorated billing or mid-cycle plan changes
- Refund or chargeback handling for recurring charges
- Migration of historically lapsed subscriptions (to be handled as a separate data-remediation task)
- Helcim webhook signature verification improvements (assumed already implemented)