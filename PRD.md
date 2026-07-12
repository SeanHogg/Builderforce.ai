> **PRD** — drafted by Ada (Sr. Product Mgr) · task #370
> _Each agent that updates this PRD signs its change below._

# PRD: Payment Processing & Escrow — Stripe Connect Integration

## Status: WIP / Draft v0.1

---

## 1. Problem & Goal

### Problem
The platform has zero functional payment processing. All existing references to `stripe` in the codebase are string literals used for text manipulation — no Stripe SDK calls, no charge flows, no webhook handling. As a direct consequence:

- `freelancer_invoices.status` is hard-stuck at `pending` with no code path that transitions it to `paid`, `held`, or any terminal state.
- No escrow mechanism exists, meaning funds cannot be held against a milestone or gig contract.
- Employers have no way to pay; freelancers have no way to receive funds.
- The platform cannot monetise or close the employer↔freelancer transaction loop.

### Goal
Build a first-class **Stripe Connect** integration that:
1. Charges employers when they hire a freelancer for a gig.
2. Holds the charged funds in **platform-controlled escrow** (Stripe Connect destination charges with delayed transfer).
3. Records every fund-state transition against `freelancer_invoices` with a full audit trail.
4. Allows authorised release of escrowed funds to the freelancer's connected Stripe account upon work acceptance.

This closes **GAP P0-1** and is the financial infrastructure foundation for all future billing, marketplace, and payout features.

---

## 2. Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Employer** | Pays for a hired gig; expects a secure, familiar checkout experience; wants money held safely until work is delivered |
| **Freelancer** | Receives payment after work acceptance; needs a connected Stripe account to receive payouts |
| **Platform Admin** | Needs full visibility of escrow state, dispute handling surface, and compliance audit log |
| **Finance / Ops** | Needs auditable ledger of charges, holds, releases, and refunds for reconciliation |

---

## 3. Scope

### In Scope (this PRD)
- Stripe Connect onboarding for freelancers (Express or Standard account creation)
- Employer payment intent creation and capture (Stripe PaymentIntent API)
- Escrow hold: funds captured to platform account, **not** immediately transferred to freelancer
- Escrow release: manual + programmatic transfer to freelancer connected account on work acceptance
- `freelancer_invoices` schema migration to support full status lifecycle
- Webhook ingestion and idempotent event processing (charge, capture, transfer, refund events)
- Auditable `invoice_events` ledger table recording every state transition with actor, timestamp, and Stripe event ID
- Basic refund / escrow-reversal path (employer cancels before release)
- Secure storage of Stripe customer IDs and connected account IDs (never raw card data)

### Phased Delivery
| Phase | Deliverable |
|---|---|
| **P1** | Schema migrations, Stripe SDK wiring, PaymentIntent create + confirm for employer charge |
| **P2** | Escrow hold on capture, freelancer Connect onboarding, `invoice_events` ledger |
| **P3** | Escrow release (transfer to freelancer), refund path, webhook hardening, admin visibility UI |

---

## 4. Functional Requirements

### 4.1 Employer Payment Flow

**FR-1** — When an employer confirms a hire on a gig, the system MUST create a Stripe `PaymentIntent` with `capture_method: manual` so funds are authorised but not yet captured.

**FR-2** — On successful authorisation, `freelancer_invoices.status` MUST transition from `pending` → `authorised` and the Stripe `PaymentIntent` ID MUST be stored on the invoice record.

**FR-3** — The system MUST capture the `PaymentIntent` (move funds to platform Stripe account) upon a defined trigger (e.g., work submission accepted by employer OR configurable auto-capture timeout). On capture, status MUST transition `authorised` → `held_in_escrow`.

**FR-4** — The employer checkout experience MUST use Stripe Elements or Stripe Checkout (no raw PAN handling on platform servers).

**FR-5** — A Stripe `Customer` object MUST be created for each employer and its ID stored; payment methods MAY be saved for repeat payments with explicit employer consent.

### 4.2 Freelancer Connect Onboarding

**FR-6** — Freelancers MUST complete Stripe Connect Express onboarding before any payout can be initiated. The system MUST store their `stripe_account_id` on the user/profile record.

**FR-7** — The platform MUST surface onboarding status (not started / pending verification / active) to the freelancer in their dashboard.

**FR-8** — Payouts to freelancers who have not completed Connect onboarding MUST be blocked with a clear error state on the invoice.

### 4.3 Escrow Hold & Release

**FR-9** — Captured funds MUST remain in the platform Stripe account (escrow state) until an explicit release event is triggered.

**FR-10** — Release MUST be triggered by one of: (a) employer clicks "Accept & Release Payment", (b) admin manually overrides via admin panel, (c) auto-release timer (configurable, default 14 days after delivery submission).

**FR-11** — On release, the system MUST create a Stripe `Transfer` to the freelancer's connected account for `invoice.amount - platform_fee`. Status MUST transition `held_in_escrow` → `released`.

**FR-12** — Platform fee percentage MUST be configurable via environment variable/admin setting (default: define in implementation), not hard-coded.

### 4.4 Refunds & Cancellations

**FR-13** — If the employer cancels a hire while status is `authorised` (not yet captured), the system MUST cancel the `PaymentIntent`. Status MUST transition `authorised` → `cancelled`.

**FR-14** — If the employer raises a dispute while status is `held_in_escrow`, the system MUST support issuing a full or partial Stripe `Refund` from the platform account. Status MUST transition `held_in_escrow` → `refunded`.

**FR-15** — Partial refunds MUST record the refunded amount and remaining balance on the invoice.

### 4.5 Webhook Handling

**FR-16** — The platform MUST expose a Stripe webhook endpoint that ingests and verifies (using `Stripe-Signature` header) the following events at minimum:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.amount_capturable_updated`
  - `charge.captured`
  - `transfer.created`
  - `account.updated` (for Connect onboarding status)
  - `charge.dispute.created`

**FR-17** — Webhook processing MUST be idempotent; duplicate Stripe event IDs MUST be detected and silently ignored.

**FR-18** — Webhook failures MUST not silently swallow errors; failed processing MUST be logged and retryable.

### 4.6 Audit Ledger

**FR-19** — A new `invoice_events` table MUST record every status transition with: `invoice_id`, `from_status`, `to_status`, `actor_type` (system/employer/admin), `actor_id`, `stripe_event_id`, `stripe_object_id`, `metadata` (JSONB), `created_at`.

**FR-20** — No `freelancer_invoices.status` update MAY occur without a corresponding `invoice_events` row in the same database transaction.

**FR-21** — `invoice_events` rows MUST be immutable after insert (no updates, no deletes; enforce via DB policy or application layer).

### 4.7 Invoice Status Lifecycle

```
pending → authorised → held_in_escrow → released
                ↓               ↓
           cancelled         refunded
```

The `freelancer_invoices` table MUST enforce this as the only valid set of transitions (check constraint or application-layer state machine with tests).

---

## 5. Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-1** | An employer can initiate a hire, be redirected to Stripe-hosted payment UI, and complete a card charge without raw card data ever touching platform servers. |
| **AC-2** | After successful charge, `freelancer_invoices.status` = `held_in_escrow` and the Stripe `PaymentIntent` ID and `charge` ID are stored on the record. |
| **AC-3** | Funds are visible in the platform Stripe dashboard as a balance — **not** transferred to the freelancer's account — confirming escrow hold. |
| **AC-4** | `invoice_events` contains a complete, ordered, immutable state-transition log for the invoice from `pending` through to `held_in_escrow`. |
| **AC-5** | Triggering "Accept & Release Payment" transitions status to `released` and creates a Stripe `Transfer` to the freelancer's connected account for the correct net amount (minus platform fee). |
| **AC-6** | A freelancer without a completed Stripe Connect onboarding cannot receive a payout; the invoice remains `held_in_escrow` with an explicit blocking reason recorded. |
| **AC-7** | Cancelling a hire before capture transitions status to `cancelled` and the employer's authorised hold is voided on Stripe. |
| **AC-8** | Replaying the same Stripe webhook event twice does not create duplicate `invoice_events` rows or double-charge / double-transfer. |
| **AC-9** | All status transitions that do not follow the defined lifecycle diagram are rejected with an explicit error (not silently ignored). |
| **AC-10** | Integration tests (using Stripe test mode + test clock) cover the full happy path and all explicit cancellation/refund paths. |

---

## 6. Out of Scope

- **Subscription billing / recurring payments** — future PRD
- **Crypto or alternative payment methods** — not planned
- **Multi-currency conversion** — v1 is single-currency (USD); FX support deferred
- **Tax calculation or 1099-K generation** — compliance tooling is a separate workstream
- **Dispute / chargeback resolution UI** — admin can manage via Stripe Dashboard directly in v1; in-app dispute flow is deferred
- **Milestone-based partial escrow releases** — v1 releases the full invoice amount; milestone splits are deferred
- **Buyer protection insurance / guarantees** — out of scope
- **Seller (freelancer) cash advances** — out of scope
- **Invoicing PDF generation** — separate feature
- **Existing invoice records remediation** — historical `pending` invoices with no Stripe context will not be retroactively migrated; they will remain in a legacy `pending` state and be excluded from the new state machine

---

*Owner: TBD | Engineers: TBD | Target: Q3 2026 | Last updated: see git blame*