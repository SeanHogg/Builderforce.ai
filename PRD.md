> **PRD** — drafted by Ada (Sr. Product Mgr) · task #367
> _Each agent that updates this PRD signs its change below._

# PRD: Financial Plumbing — Payments, Escrow, Payouts & Billing (P0)

---

## 1. Problem & Goal

### Problem
The platform currently has a non-functional Helcim one-time payment placeholder with no escrow logic, no freelancer payout mechanism, and no recurring subscription billing. Real money cannot move end-to-end, making the platform commercially inoperable. This is a P0 revenue blocker identified in the Upwork Capability Gap Analysis.

### Goal
Deliver a complete financial rails layer — Stripe-powered payment processing, escrow holding, automated freelancer payouts, and recurring subscription billing — so that the full charge → escrow → payout lifecycle works in production. This satisfies Initiative "Financial Plumbing" and the Key Result: **"Payments move end-to-end: charge → escrow → payout live in production."**

---

## 2. Target Users / ICP Roles

| Role | Stake in This Epic |
|---|---|
| **Client (Buyer)** | Pays for fixed-price contracts and hourly work; subscribes to platform plans |
| **Freelancer (Seller)** | Receives earnings held in escrow; withdraws via payout dashboard |
| **Platform Ops / Admin** | Monitors escrow balances, disputes, payout queues, fee collection |

---

## 3. Scope

This epic covers all money-movement infrastructure from the moment a client initiates a payment through to a freelancer receiving funds in their bank account or wallet, plus the subscription billing layer that gates platform feature access.

---

## 4. Functional Requirements

### 4.1 Stripe Integration (Replace Helcim)
- FR-01: Integrate Stripe as the sole payment processor; remove all Helcim code and configuration.
- FR-02: Support card payments (Visa, MC, Amex) and ACH/bank debit via Stripe Payment Intents.
- FR-03: Store Stripe Customer IDs against platform user accounts; support saved payment methods.
- FR-04: Handle Stripe webhook events for `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`, and `charge.refunded`.
- FR-05: All card data handled exclusively by Stripe (no PAN storage on platform); achieve PCI SAQ A compliance posture.

### 4.2 Escrow Engine
- FR-06: On contract activation, capture client funds and place them in a platform-managed escrow ledger record (Stripe funds held in platform Stripe account; not released to freelancer).
- FR-07: Escrow release triggers:
  - Fixed-price: client approves milestone delivery **or** auto-release after configurable review window (default 14 days, no dispute filed).
  - Hourly: weekly auto-release based on approved timesheet.
- FR-08: Escrow refund path: full or partial refund to client on dispute resolution or contract cancellation before release.
- FR-09: Platform service fee (configurable %) deducted at release before net amount transferred to freelancer ledger.
- FR-10: Escrow ledger entries are immutable append-only records with timestamps, actor IDs, and event types.

### 4.3 Freelancer Payouts
- FR-11: Integrate Stripe Connect (Express or Custom accounts) to onboard freelancers for payouts; collect required KYC via Stripe-hosted onboarding flow.
- FR-12: Freelancer selects payout destination: bank account (ACH/SEPA) or debit card (Instant Payout where eligible).
- FR-13: Payout schedule options: weekly automatic, bi-weekly automatic, or manual on-demand (subject to minimum balance threshold, default $20).
- FR-14: Platform initiates payouts via Stripe Connect transfers; track transfer IDs and statuses.
- FR-15: Freelancer notified (email + in-app) on: funds released to ledger, payout initiated, payout landed, payout failed.
- FR-16: Failed payouts retried automatically up to 3 times with exponential backoff; freelancer prompted to update bank details after final failure.

### 4.4 Recurring Subscription Billing
- FR-17: Replace one-time Helcim billing with Stripe Billing (Subscriptions + Products API).
- FR-18: Support at minimum three plan tiers for clients (e.g., Free, Pro, Business) with monthly and annual billing cycles.
- FR-19: Subscription lifecycle events handled via webhooks: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- FR-20: Failed subscription payment triggers dunning sequence: retry at days 3, 7, 14; access downgraded to Free tier on day 14 if unpaid; subscription cancelled at day 28.
- FR-21: Proration applied automatically when clients upgrade or downgrade mid-cycle via Stripe's default proration logic.
- FR-22: Client receives email receipt for every successful subscription charge.

### 4.5 Freelancer Earnings & Payout Dashboard
- FR-23: Freelancer dashboard displays:
  - Current escrow balance (funds not yet released)
  - Available balance (released, pending payout)
  - Lifetime earnings
  - Payout history with status, date, amount, and destination (masked)
  - Itemised transaction log (contract, milestone, fee deducted, net)
- FR-24: Freelancer can trigger manual payout from dashboard if on-demand schedule is selected and balance ≥ minimum threshold.
- FR-25: Freelancer can update payout method and schedule from dashboard; changes take effect on next payout cycle.
- FR-26: Dashboard exports transaction history as CSV (up to 24-month range).

### 4.6 Admin / Ops Controls
- FR-27: Internal admin view shows: all escrow balances by contract, pending payout queue, failed payouts, platform fee collected (daily/monthly).
- FR-28: Admin can manually trigger or block individual payouts with audit-logged reason.
- FR-29: Admin can adjust platform fee percentage via config (no code deploy required).

---

## 5. Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A client can pay for a contract using a saved or new card via Stripe; payment appears as "funds in escrow" in the ledger within 60 seconds of `payment_intent.succeeded` webhook. |
| AC-02 | Helcim is fully removed from codebase and configuration; no Helcim API calls exist at any point in a payment flow. |
| AC-03 | Escrow auto-releases to freelancer ledger 14 days after milestone delivery if no dispute is filed; release does not occur before the window closes. |
| AC-04 | Freelancer completes Stripe Connect KYC onboarding and receives a test payout of $0.01 to a verified bank account in a staging environment. |
| AC-05 | Weekly automatic payout runs at scheduled time (±15 min); Stripe transfer IDs are persisted to the database and payout status reflects terminal state (`paid` or `failed`) within 2 business days. |
| AC-06 | A new client subscription is created via Stripe Billing; `invoice.paid` webhook correctly provisions the paid tier; `invoice.payment_failed` after exhausted retries downgrades the account to Free tier. |
| AC-07 | Freelancer dashboard accurately reflects escrow balance, available balance, and payout history, reconciled against Stripe ledger with zero discrepancy in a 30-transaction QA test run. |
| AC-08 | Platform service fee is correctly deducted from gross escrow release; fee amount is recorded in the transaction log and visible in the admin fee report. |
| AC-09 | All Stripe webhook endpoints validate `Stripe-Signature` header; unauthenticated webhook calls return HTTP 400 and are logged. |
| AC-10 | End-to-end smoke test (charge → escrow hold → milestone approval → escrow release → payout initiated) completes successfully in the production environment with a real $1.00 transaction. |

---

## 6. Out of Scope

- **Crypto / stablecoin payments** — not supported in this epic.
- **International multi-currency FX conversion** — USD-only for initial release; multi-currency is a future epic.
- **Dispute resolution workflow UI** — dispute *detection* (webhook ingestion + escrow freeze) is in scope; the full mediation/arbitration product is a separate epic.
- **1099-K / tax document generation** — tax reporting feature is a separate compliance epic.
- **Invoicing tool for freelancers** — freelancers generating invoices to clients outside the platform.
- **Client billing portal / self-serve invoice history UI** — admin and basic email receipts are in scope; a full client billing portal is not.
- **Stripe Treasury / financial accounts** — platform wallet features beyond Connect payouts are future scope.
- **Non-Stripe payment processors** — no PayPal, Wise, or alternative processor integrations in this epic.
- **Hourly contract time-tracking UI** — timesheet approval logic is consumed here but the time-tracking product itself is owned by a separate epic.

---

*Document status: WIP — v0.1 | Owner: Platform Engineering Lead | Last updated: based on Upwork Gap Analysis inputs*
