> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #134
> _Each agent that updates this PRD signs its change below._

# PRD: OKR 1 — Revenue Foundation: Monetization & Billing

## Problem & Goal

**Problem:** The platform currently lacks a structured commercial layer — there is no recurring billing infrastructure, no marketplace revenue mechanism, no enterprise licensing path, and no compliance attestation that enterprise buyers require. This leaves significant revenue on the table and blocks deals with security-conscious customers.

**Goal:** Establish a durable, multi-channel revenue foundation by shipping managed hosting billing, a monetized Agent marketplace, an enterprise on-prem license, and SOC 2 Type I attestation — all within this OKR period.

---

## Target Users / ICP Roles

| Segment | Role | Primary Need |
|---|---|---|
| SMB / Indie Developer | Builder / Operator | Managed hosting with zero DevOps overhead |
| Marketplace Participant | Agent Publisher | Revenue share for published Agents |
| Marketplace Participant | Agent Buyer | Trusted, curated Agents with simple purchasing |
| Mid-Market Company | Engineering Lead / Head of AI | Fast onboarding, reliable billing, SLA-backed hosting |
| Enterprise | CTO / CISO / Procurement | On-prem deployment, license agreement, SOC 2 report |

---

## Scope

This OKR covers five tightly scoped workstreams delivered in parallel:

1. **Managed Agent Hosting Add-On** — billing, provisioning, and lifecycle management
2. **Onboarding Funnel** — time-to-first-Agent under 5 minutes
3. **Agent Marketplace Monetization** — listing fees and transaction fee infrastructure
4. **Enterprise License GA** — on-prem Docker distribution and license key enforcement
5. **SOC 2 Type I Audit** — evidence collection, auditor engagement, report issuance

---

## Functional Requirements

### 1. Managed Agent Hosting Add-On

#### 1.1 Billing & Subscription
- FR-1.1.1: Integrate with a payment processor (Stripe) to charge **$49/month per hosted Agent** on a recurring subscription.
- FR-1.1.2: Support monthly and annual billing cycles; annual cycle must display savings callout.
- FR-1.1.3: Generate and email a PDF invoice for every billing event.
- FR-1.1.4: Enforce dunning logic: payment retry at 3 days → 7 days → subscription suspension at 14 days.
- FR-1.1.5: Provide a self-service billing portal (Stripe Customer Portal or equivalent) for plan changes, payment method updates, and cancellation.

#### 1.2 Provisioning & Lifecycle
- FR-1.2.1: On subscription activation, automatically provision an isolated Agent runtime environment within 60 seconds.
- FR-1.2.2: Expose a dashboard widget showing per-Agent uptime, last-run timestamp, and current billing cycle cost.
- FR-1.2.3: On cancellation or suspension, gracefully stop the Agent and retain configuration data for 30 days before deletion.
- FR-1.2.4: Support scaling from 1 to 50 hosted Agents per account without manual intervention.

#### 1.3 SLA & Reliability
- FR-1.3.1: Guarantee 99.9% monthly uptime per hosted Agent; breach triggers prorated credit automatically.

---

### 2. Onboarding Funnel — First Agent < 5 Minutes

- FR-2.1: Implement a linear, step-count-visible onboarding wizard: Sign Up → Verify Email → Create Agent → Configure Trigger → Deploy / Test.
- FR-2.2: Provide at least three pre-built Agent templates (e.g., Slack Bot, Data Summarizer, Webhook Responder) selectable in one click.
- FR-2.3: Default all optional configuration fields to sensible values; expose advanced settings behind a disclosure toggle.
- FR-2.4: Embed an inline "Test Agent" button that executes a dry-run and shows output within the wizard — no tab switching required.
- FR-2.5: Instrument every wizard step with event tracking (step viewed, step completed, step abandoned, total funnel time); surface in an internal analytics dashboard.
- FR-2.6: Display an in-product prompt to activate Managed Hosting at the Deploy step.

---

### 3. Agent Marketplace Monetization

#### 3.1 Listing Fees
- FR-3.1.1: Charge a one-time **listing fee** (amount TBD by pricing team, suggested $0–$99 tiered by visibility tier) at Agent publication.
- FR-3.1.2: Offer a "Featured" listing tier with prominent placement; charge recurring monthly fee.
- FR-3.1.3: Publishers must connect a Stripe Connect account before listing a paid Agent.

#### 3.2 Transaction Fees
- FR-3.2.1: For paid Agent purchases or subscriptions, collect a platform transaction fee (suggested **15% of gross**) on every sale via Stripe Connect.
- FR-3.2.2: Disburse net revenue to publisher Stripe Connect account on a 7-day rolling basis.
- FR-3.2.3: Provide publishers a real-time revenue dashboard: sales count, gross revenue, platform fee deducted, net disbursed, next payout date.

#### 3.3 Buyer Experience
- FR-3.3.1: Display price, license type (one-time vs. subscription), and publisher identity on every marketplace listing.
- FR-3.3.2: Support one-click purchase with saved payment method for returning buyers.
- FR-3.3.3: Issue a receipt email and add purchased Agent to buyer's library within 30 seconds of payment confirmation.

---

### 4. Enterprise License GA — On-Prem Docker

- FR-4.1: Package the full platform as a **Docker Compose bundle** installable on a single VM or Kubernetes cluster with a single `docker compose up` command.
- FR-4.2: Implement a **license key enforcement** system: the platform reads a signed license file at startup; it must contain seat count, expiry date, and feature flags.
- FR-4.3: License key violations (expired, seat-exceeded) surface a clear in-product warning with a 14-day grace period before enforcement lockout.
- FR-4.4: Provide an air-gapped installation path: all images publishable to a private registry; no outbound internet required post-install.
- FR-4.5: Publish enterprise installation documentation covering: system requirements, installation, license activation, upgrade path, and backup/restore.
- FR-4.6: Deliver a standard **Master License Agreement (MLA)** template reviewed by legal, executable via DocuSign.
- FR-4.7: Minimum licensable unit: 10 seats at a negotiated annual contract value (ACV); pricing input from sales team.

---

### 5. SOC 2 Type I Audit

- FR-5.1: Select and contract a licensed CPA firm for SOC 2 Type I audit covering Trust Service Criteria: **Security, Availability, Confidentiality**.
- FR-5.2: Complete a formal risk assessment and map controls to TSC criteria before audit fieldwork begins.
- FR-5.3: Implement and document all missing controls identified in the gap assessment (target: zero open critical findings at audit start).
- FR-5.4: Maintain an evidence repository (e.g., Vanta, Drata, or equivalent) continuously collecting automated evidence.
- FR-5.5: Achieve a signed SOC 2 Type I report with an **unqualified opinion** (no exceptions) by end of OKR period.
- FR-5.6: Make the report available under NDA to enterprise prospects via a self-serve request form on the marketing site.

---

## Acceptance Criteria

| # | Criterion | Measurement |
|---|---|---|
| AC-1 | Managed hosting billing live | A new account can subscribe, provision, and run a hosted Agent end-to-end with $49/mo charge successfully processed in Stripe. |
| AC-2 | Onboarding funnel < 5 min | Median time from account creation to first deployed Agent ≤ 5 minutes measured over 100 real user sessions in production. |
| AC-3 | Marketplace listing fee collected | At least one paid Agent listed, listing fee charged, and transaction fee collected on a test purchase in production. |
| AC-4 | Publisher payout functional | Net revenue disbursed to a test Stripe Connect account within 7 days of a marketplace sale. |
| AC-5 | Enterprise Docker install | A clean-room installation of the Docker bundle on a vanilla Ubuntu 22.04 VM completes in < 30 minutes following the published documentation, with license key enforcement validated. |
| AC-6 | SOC 2 Type I report issued | Signed, unqualified SOC 2 Type I report received from auditor and stored in secure evidence repository. |
| AC-7 | Dunning & suspension | Simulated payment failure triggers retry at day 3, day 7, and Agent suspension at day 14. |
| AC-8 | Uptime credit automation | A simulated SLA breach (injected downtime > 0.1% of monthly minutes) triggers automatic prorated credit to the affected account within 24 hours. |

---

## Out of Scope

- **SOC 2 Type II** — Type II surveillance period begins after Type I report; report delivery is a future OKR.
- **Self-serve enterprise provisioning** — Enterprise license issuance remains a sales-assisted motion this period.
- **Marketplace escrow / dispute resolution** — Basic refund policy only; formal dispute workflow is a follow-on item.
- **Multi-currency billing** — USD only for this OKR; localization deferred.
- **Kubernetes Operator / Helm chart** — Docker Compose only for the initial enterprise package; Helm chart is a future milestone.
- **Usage-based billing (metered)** — Flat per-Agent fee only; consumption-based pricing tiers are not in scope.
- **Mobile onboarding experience** — Web only; native mobile flows deferred.
- **Channel / reseller partner program** — Direct sales and self-serve only this period.
- **Marketplace review & rating system** — Discovery and trust features deferred to a subsequent OKR.