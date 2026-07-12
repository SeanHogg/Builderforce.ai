> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #355
> _Each agent that updates this PRD signs its change below._

# PRD: Helcim Webhook Mapping — Proper Event Schema & Routing

## Problem & Goal

The current Helcim webhook integration maps **every** `APPROVED` webhook event to `subscription.activated`, regardless of the actual event type being reported by Helcim. This is a placeholder implementation that produces incorrect downstream behavior: renewals, cancellations, failures, and other lifecycle events are all misclassified, corrupting subscription state and triggering wrong business logic.

**Goal:** Replace the placeholder with a complete, accurate Helcim webhook payload schema and implement correct event-type routing so that each Helcim event maps to the appropriate internal event.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Backend / Integration Engineers** | Implementing and maintaining the webhook handler |
| **QA Engineers** | Validating correct event routing with real or simulated Helcim payloads |
| **Product & Revenue Ops** | Relying on accurate subscription lifecycle signals for reporting and automation |

---

## Scope

This work covers the Helcim webhook receiver: schema definition, payload parsing, event classification, and routing to internal handlers. It does not cover other payment providers or unrelated billing flows.

---

## Functional Requirements

### FR-1 — Helcim Webhook Payload Schema

Define a typed schema (interface / type / validation model) for the Helcim webhook payload that captures, at minimum:

- `transactionType` — e.g., `PURCHASE`, `PREAUTH`, `CAPTURE`, `REFUND`, `VOID`, `RECURRING`
- `status` — e.g., `APPROVED`, `DECLINED`, `ERROR`
- `recurringTransactionId` / `subscriptionId` — identifier linking the event to a recurring billing record
- `amount`, `currency`
- `dateTime` / `timestamp`
- `cardData` or tokenized card reference (partial PAN, expiry) where provided
- Any Helcim-specific metadata fields present in live payloads (e.g., `invoiceNumber`, `customerCode`)

Schema must be validated at ingress; malformed payloads must be rejected with HTTP `400`.

### FR-2 — Event Classification Logic

Implement a deterministic mapping function that converts `(transactionType, status)` pairs — and any other required payload fields — to internal event types:

| Helcim `transactionType` | Helcim `status` | Internal Event |
|---|---|---|
| `PURCHASE` / `RECURRING` (first charge) | `APPROVED` | `subscription.activated` |
| `RECURRING` (renewal charge) | `APPROVED` | `subscription.renewed` |
| `RECURRING` | `DECLINED` / `ERROR` | `subscription.payment_failed` |
| `REFUND` | `APPROVED` | `subscription.refunded` |
| `VOID` | `APPROVED` | `subscription.cancelled` |
| `PREAUTH` | `APPROVED` | `payment.authorized` |
| `CAPTURE` | `APPROVED` | `payment.captured` |
| Any | `DECLINED` / `ERROR` (non-recurring) | `payment.failed` |

> **Note:** The exact field that distinguishes a first-time `PURCHASE` from a recurring renewal must be confirmed against Helcim's live webhook documentation/sandbox and encoded explicitly in the classification logic, not inferred implicitly.

### FR-3 — Replace Placeholder Handler

Remove the hardcoded `subscription.activated` fallback. The handler must:

1. Parse and validate the incoming payload against the schema defined in FR-1.
2. Pass the validated payload through the classification function defined in FR-2.
3. Dispatch the resolved internal event to the appropriate internal handler/service.
4. Return HTTP `200` for all successfully processed events (including no-ops for unmapped/unknown event types that are explicitly acknowledged).
5. Return HTTP `400` for schema validation failures.
6. Return HTTP `422` for payloads that are structurally valid but cannot be classified due to unrecognised `transactionType`/`status` combinations, and emit a warning log.

### FR-4 — Signature Verification

Verify Helcim's webhook HMAC signature (or equivalent authentication header) **before** any payload processing. Reject unauthenticated requests with HTTP `401`.

### FR-5 — Logging & Observability

- Log the raw `transactionType`, `status`, resolved internal event, and relevant IDs at `INFO` level for every processed webhook.
- Log unclassified events at `WARN` level with the full payload (redacted of card data).
- Emit a structured error log for schema validation failures.

### FR-6 — Idempotency

Deduplicate webhook deliveries using Helcim's transaction ID or a provider-supplied idempotency key. Duplicate events must be acknowledged with HTTP `200` and must not re-trigger internal handlers.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | An `APPROVED` `RECURRING` renewal webhook no longer triggers `subscription.activated`; it triggers `subscription.renewed`. |
| AC-2 | An `APPROVED` first-time `PURCHASE` webhook correctly triggers `subscription.activated`. |
| AC-3 | A `DECLINED` `RECURRING` webhook triggers `subscription.payment_failed` and does not alter active subscription state. |
| AC-4 | A `VOID` `APPROVED` webhook triggers `subscription.cancelled`. |
| AC-5 | A `REFUND` `APPROVED` webhook triggers `subscription.refunded`. |
| AC-6 | A payload failing schema validation returns HTTP `400` and no internal event is dispatched. |
| AC-7 | A request with an invalid or missing HMAC signature returns HTTP `401`. |
| AC-8 | Sending the same Helcim transaction ID twice results in a single internal event dispatch; the second delivery returns HTTP `200` with no side effects. |
| AC-9 | All processed events produce a structured log entry containing `transactionType`, `status`, internal event name, and subscription/transaction ID. |
| AC-10 | An unrecognised `transactionType`/`status` combination returns HTTP `422` and emits a `WARN` log; no internal event is dispatched. |
| AC-11 | Unit tests cover every mapping row in FR-2 and both error paths (FR-3 steps 5 & 6). |
| AC-12 | Integration/contract tests run against Helcim sandbox payloads or recorded fixtures that reflect actual Helcim webhook structure. |

---

## Out of Scope

- Changes to webhook handling for any other payment provider (Stripe, Braintree, etc.).
- Helcim payment initiation, tokenisation, or checkout flows.
- Subscription business logic beyond receiving and routing the webhook event (e.g., dunning, grace periods, email notifications).
- Retroactive reprocessing of historical webhooks that were misclassified under the placeholder.
- Helcim API polling or reconciliation jobs.
- Front-end / dashboard changes.