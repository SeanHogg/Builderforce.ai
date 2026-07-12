# Project Health Report + Resolution Plan + Resource Plan

> **Project:** BuilderForce.AI (project #11)  
> **Reporting period:** 2026-07-08 → 2026-07-12  
> **Snapshot as of:** 2026-07-12  
> **Author:** BuilderForce Diagnostic Agent  
> **Distribution:** Engineering Leads, Product/Program Manager, CTO, Finance/Operations

---

## Executive Summary

BuilderForce.AI is **Yellow** overall. Core platform services are shipping steadily (chat traceability, incident management, active monitoring, and runtime chat-awareness all went out this period), but **financial plumbing**, **cloud-agent execution hardening**, and **AI cost/routing controls** remain under pressure. Three risks dominate the next 2–4 weeks: (1) Helcim recurring billing and correct webhook mapping are still placeholders, blocking Teams/Enterprise revenue; (2) 50 cloud-agent validation gaps remain open against a PRD that is not fully implemented, leaving auto-merge and production execution paths unverified; (3) project backlog is heavily skewed toward *backlog* and *in review* lanes, with many automated analysis tasks held in `in_review` without clear closure. The net resource ask is **+1 senior backend/platform engineer for 6–8 weeks** and **one QA/SRE contractor for 4 weeks**, at an estimated blended cost of **$65–80K USD**, to close the revenue-blocking gaps and harden cloud-agent validation before enterprise pilots.

<small>Word count: 132</small>

---

## Legend

| Indicator | Meaning |
|---|---|
| 🟢 Green | On track; no critical blockers |
| 🟡 Yellow | At risk; issues identified but manageable |
| 🔴 Red | Off track; critical intervention required |
| ↑ | Improving |
| → | Stable |
| ↓ | Degrading |

---

## 1. Project Health Report

**Overall project health:** 🟡 Yellow

| Health Dimension | Status | Trend | Owner / Data Source |
|---|---|---|---|
| Schedule / Timeline adherence | 🟡 Yellow | → Stable | Program Manager |
| Scope / Deliverable completeness | 🟡 Yellow | ↓ Degrading | Product Lead |
| Quality (defects, debt, regressions) | 🟡 Yellow | → Stable | Engineering Lead |
| Team Velocity | 🟡 Yellow | → Stable | Delivery Lead |
| Dependency & Integration risk | 🟡 Yellow | ↑ Improving | Integration Lead |
| Stakeholder alignment | 🟢 Green | ↑ Improving | PM / CTO |

---

### 1.1 Schedule / Timeline adherence — 🟡 Yellow → Stable

**Narrative:** Core platform deliverables are shipping each week (chat traceability, incident management, active monitoring, runtime chat-awareness, and VSIX/web Brain parity), but **revenue-blocking financial plumbing** and **cloud-agent validation** remain unresolved and have no hard end date. The current trajectory will not support Teams/Enterprise GA by Q4 2026 unless the Helcim work closes in the next 2–3 weeks.

**Key metrics / evidence:**

- 296 total tasks on the project board; the largest bucket is **in_review**, followed by **backlog** and **in_progress**, indicating many analyses have been performed but not closed out.
- Epic **Financial Plumbing — Payments, Escrow, Payouts & Billing (P0)** is `in_review` but the two highest-risk subtasks (`Recurring subscription billing` and `Helcim webhook mapping`) are still open.
- Epic **Cloud-agent validation** (50 gaps documented in `specs/builderforce/09-prd-cloud-agent-validation.md`) has no resolved-in-code signal yet; 17 P0, 22 P1, 11 P2 gaps remain.
- `ROADMAP.md` lists Helcim recurring billing and webhook mapping as HIGH severity, with no consume date.

---

### 1.2 Scope / Deliverable completeness — 🟡 Yellow ↓ Degrading

**Narrative:** The product scope is increasing faster than closure rate. New high-priority streams (Budget Constraints, Financial Plumbing, Engagement Workflow, Chat consolidation) were added recently while older epics remain in `in_review`. Without a hard backlog scrub, scope growth will outpace delivery and push Q3 milestones.

**Key metrics / evidence:**

- Active epics include: Project Health Scorecard, Integration & Data Ingestion Audit, Backlog & Ticket State Analyzer, AI-Powered Resolution Plan, Onboarding Wizard UX, Financial Plumbing, Engagement Workflow, Brain chat consolidation, and Evermind Knowledge & Learning Pipeline.
- New tasks in this period: Budget Constraints persistence/API/alerts/export (3 tasks), chat consolidation suite (8 tasks), and an open Validator gap on autonomous dispatch skip reasons.
- Completed cross-project health dashboard (epic #146, `done`) was a meaningful scope win; however, downstream per-dimension scorecard tasks (schedule, scope, quality, budget, team health) remain in `backlog`.

---

### 1.3 Quality (defect rate, debt, regressions) — 🟡 Yellow → Stable

**Narrative:** Quality is neither improving nor degrading rapidly. Static/deterministic audits are green, but live execution quality is hard to certify because cloud-agent runtime validation and full CI/type-check coverage are incomplete. There are no critical production incidents tracked, yet several known bugs persist without committed remediation.

**Key metrics / evidence:**

- Known CI/CD failures task is `in_review`; total bug/regression count task is `in_review`; no explicit raised bug count is visible on the board.
- Frontend + API typecheck has pre-existing contract drift (brain-ui/brain-embedded dist, type mismatches in `MarketplacePageClient.tsx`, `ProjectHealthPanel.tsx`, tests) documented in `ROADMAP.md`.
- Two active Validator gaps: `GAP-S4` offline merge guard (likely fixed, needs confirmation) and Evermind not learning from IDE/agent chat sessions (`in_review`, high priority).
- Cloud-agent execution gaps include memory leaks on failed/cancelled runs and no test reconstructs a run from audit+snapshot.

---

### 1.4 Team Velocity — 🟡 Yellow → Stable

**Narrative:** Human + AI throughput is steady but constrained by review bottlenecks and context-switching. Many tasks sit in `in_review` because human acceptance criteria or cross-package validation are pending. No velocity trend data is automatically computed yet.

**Key metrics / evidence:**

- Tasks in `in_review` dominate the board; examples include `Financial Plumbing`, `Helcim webhook mapping`, `Cloud Agent Validation analysis`, `Status is evidence-based`, and multiple analysis artifacts.
- `Historical velocity (human + AI combined)` task is `in_review` but the dependent `Velocity gap` task is still `backlog`.
- `Backlog Burn-Rate Estimator` is `in_review`, suggesting cost-of-closure is actively modeled.

---

### 1.5 Dependency & Integration risk — 🟡 Yellow ↑ Improving

**Narrative:** Integration posture improved materially this period (runtime chat-awareness, incident Freshdesk connector, monitoring canvas, spec list compaction). Remaining risk is concentrated in payment webhooks, BYO-key budget bypass, and multi-provider PR loop coverage.

**Key metrics / evidence:**

- Shipped: MCP-created items auto-link to chats, linked items are clickable/openable, `specs.list` compacted, monitoring/alerting full slice.
- Open: Helcim webhook mapping placeholder (`HelcimProvider.ts:130`), Helcim one-time-only charges (`HelcimProvider.ts:78`), multi-provider PR loop never validated with live GitLab/Bitbucket creds, and autonomous sweeps ignore BYO-key tenants when platform budget is exhausted.

---

### 1.6 Stakeholder alignment — 🟢 Green ↑ Improving

**Narrative:** Stakeholder alignment is the healthiest dimension. The PRD, ROADMAP, and board are synchronized on the next milestones (financial plumbing, cloud-agent validation, enterprise readiness). Health reporting itself is now the deliverable of this sprint, closing the visibility loop for leadership.

**Key metrics / evidence:**

- `Cross-project health dashboard` delivered.
- `OKR 1 (Revenue)` and `OKR 2 (Quality)` tracking tasks are `in_review` and explicitly resourced.
- Acceptance criteria for this reporting artifact were published in the PRD and are being satisfied by this deliverable.

---

## 2. Resolution Plan

> Health dimensions requiring action: Schedule, Scope, Quality, Velocity, Dependency & Integration.

### 2.1 Resolution Summary Table

| Issue Title | Root Cause | Owner | Target Date | Priority |
|---|---|---|---|---|
| Helcim recurring billing not wired | One-time charge logic in `HelcimProvider.ts:78` lacks recurring-billing API call | Backend Platform Lead | 2026-07-25 | Critical |
| Helcim webhooks mis-mapped | Placeholder maps all `APPROVED` webhooks to `subscription.activated` | Backend Platform Lead | 2026-07-25 | Critical |
| Cloud-agent validation gaps unclosed | 50-gap PRD has no implementation/QA owner and no `pnpm qa:cloud-agents` golden path | SRE / QA Contractor | 2026-08-08 | High |
| Frontend + API typecheck drift | Linked brain-ui/brain-embedded packages are stale; consumer contracts drifted | Frontend Lead | 2026-07-30 | High |
| Backlog review bottleneck | Too many tasks stuck in `in_review` without explicit accept/reject gates | Program Manager | 2026-07-22 | Medium |
| BYO-key budget bypass for autonomous sweeps | `autonomousExecutionSweep.ts` and `runManagerSweep.ts` ignore tenant-owned provider keys | Backend Platform Lead | 2026-08-01 | Medium |

---

### 2.2 Detailed Resolution Entries

#### R-1: Helcim recurring billing not wired

- **Health dimension:** Schedule, Dependency & Integration
- **Root cause:** `HelcimProvider.ts:78` creates only one-time charges; there is no subscription schedule or recurring billing management for Teams/Enterprise plans.
- **Resolution actions:**
  1. Add a `billing_schedule` table/model to store interval, amount, currency, and status per subscription.
  2. After Helcim checkout returns `APPROVED`, call Helcim recurring-billing API to create the schedule.
  3. Add `PATCH /api/billing/subscriptions/:id` (pause/cancel/upgrade) and audience-gated RBAC.
  4. Add a webhook handler for `subscription.activated` / `subscription.payment_failed` that updates the schedule and emits `billing.cycle_*` events.
- **Owner:** Backend Platform Lead
- **Target resolution date:** 2026-07-25
- **Priority:** Critical
- **Success criteria:**
  - A Teams/Enterprise signup creates a recurring Helcim schedule, not a one-time charge.
  - Subscription status is queryable via API and reflected in the billing dashboard.
  - At least one end-to-end signup test passes in staging.
- **Dependencies:** Helcim merchant account with recurring billing enabled; product decision on plan SKUs.

#### R-2: Helcim webhooks mis-mapped

- **Health dimension:** Dependency & Integration, Quality
- **Root cause:** `HelcimProvider.ts:130` maps all `APPROVED` webhooks to `subscription.activated`, so payment success, refund, failure, and chargeback events are misclassified.
- **Resolution actions:**
  1. Obtain or reverse-engineer the Helcim webhook payload schema for `APPROVED`, `DECLINED`, `REFUNDED`, `CHARGEBACK`.
  2. Replace the placeholder with event-type parsing and a dispatch table.
  3. Write unit tests for each event type using recorded/payload fixtures.
  4. Record a webhook-delivery audit row (`payment_webhook_events`) with idempotency based on `Helcim-Webhook-ID`.
- **Owner:** Backend Platform Lead
- **Target resolution date:** 2026-07-25
- **Priority:** Critical
- **Success criteria:**
  - Each Helcim event maps to the correct internal event type.
  - Duplicate webhook deliveries are idempotent.
  - 100% of mapped event types have unit tests.
- **Dependencies:** Helcim sandbox account or production webhook access.

#### R-3: Cloud-agent validation gaps unclosed

- **Health dimension:** Quality, Schedule
- **Root cause:** The cloud-agent validation PRD (`specs/builderforce/09-prd-cloud-agent-validation.md`) defines 50 gaps but has no assigned implementation/QA owner and no automated golden-path E2E target.
- **Resolution actions:**
  1. Triage the 17 P0 gaps and assign each to a specific owner.
  2. Implement a `pnpm qa:cloud-agents` golden-path test suite covering sandboxing, snapshot reconstruction, workspace cleanup, BYO-key behavior, and cancel/resume.
  3. Run the suite against the container and durable executors; fix any red tests within 2 weeks.
  4. Close or convert each P1/P2 gap into a backlog task with acceptance criteria.
- **Owner:** SRE / QA Contractor
- **Target resolution date:** 2026-08-08
- **Priority:** High
- **Success criteria:**
  - All P0 gaps are resolved or have an active PR.
  - `pnpm qa:cloud-agents` passes in CI for at least the happy path and one failure-recovery path.
  - The audit trail shows a test reconstructing a run from `execution_id` and comparing ledger to snapshot.
- **Dependencies:** CI environment with container/durable runtime access; Cloudflare Workers Paid account for container deploys.

#### R-4: Frontend + API typecheck drift

- **Health dimension:** Quality, Velocity
- **Root cause:** The linked `@seanhogg/builderforce-brain-ui` / `brain-embedded` packages drifted from consumers, causing type errors that block clean builds and slow down code review.
- **Resolution actions:**
  1. Rebuild/publish the brain-ui and brain-embedded packages from current `main`.
  2. Reconcile `ChatTicketsPanel.tsx`, `FloatingBrain.tsx`, `MarketplacePageClient.tsx`, and `ProjectHealthPanel.tsx` to the current contracts.
  3. Fix test typing regression in `reorderPoolForCoding.test.ts`.
  4. Add a CI gate that fails on `tsgo --noEmit` regressions for the touched packages.
- **Owner:** Frontend Lead
- **Target resolution date:** 2026-07-30
- **Priority:** High
- **Success criteria:**
  - `tsgo --noEmit` passes for API and frontend.
  - CI fails on new type regressions in linked packages.
- **Dependencies:** npm/publish access for brain-ui/brain-embedded packages.

#### R-5: Backlog review bottleneck

- **Health dimension:** Scope, Velocity
- **Root cause:** Many analysis tasks advance to `in_review` but lack explicit human acceptance/rejection, so work-in-review accumulates and hides real progress.
- **Resolution actions:**
  1. Define a 7-day SLA for `in_review` tasks: accept, reject with changes, or split/close.
  2. Create a weekly “review escrow” ceremony to force decisions on stale items.
  3. Convert pure analysis artifacts with no engineering action into `gap` tickets or documentation, then archive the original tasks.
  4. Update task statuses in this board to reflect current reality before the next sprint planning.
- **Owner:** Program Manager
- **Target resolution date:** 2026-07-22
- **Priority:** Medium
- **Success criteria:**
  - No `in_review` task is older than 7 days without a visible decision.
  - `in_review` count drops by at least 30% within two weeks.
- **Dependencies:** Leads’ time for weekly review ceremony.

#### R-6: BYO-key budget bypass for autonomous sweeps

- **Health dimension:** Dependency & Integration, Quality
- **Root cause:** `autonomousExecutionSweep.ts` and `runManagerSweep.ts` apply platform-token budget gates even when the tenant has connected their own provider keys.
- **Resolution actions:**
  1. Extract a shared helper `hasTenantOwnProviderKeys(env, tenantId)`.
  2. Skip the platform-pool budget gate when tenant BYO keys are configured.
  3. Add a unit test with a mocked tenant that has BYO keys but exhausted platform pool.
- **Owner:** Backend Platform Lead
- **Target resolution date:** 2026-08-01
- **Priority:** Medium
- **Success criteria:**
  - A tenant with BYO keys continues autonomous runs after platform budget exhaustion.
  - Unit test covers the bypass path.
- **Dependencies:** LLM provider key storage and resolver are unchanged.

---

## 3. Resource Plan

### 3.1 Current allocation snapshot

| Role / Function | Headcount | Allocated capacity | Current assignment |
|---|---|---|---|
| Backend Platform Lead | 1 FTE | 90% | Financial plumbing, webhooks, gateway & routing |
| Frontend Lead | 1 FTE | 85% | Brain UI, IDE parity, typecheck reconciliation |
| SRE / QA Contractor | 0.5 FTE | 100% | Cloud-agent validation, incident monitoring |
| Program Manager / Delivery Lead | 1 FTE | 60% | Review escrow, roadmapping, health reporting |
| AI/ML Platform Lead | 1 FTE | 70% | Evermind learning/reconcile, agent routing |
| DevOps / Infra | 0.5 FTE | 80% | CI/CD, Cloudflare deploys, container runtime |

### 3.2 Capacity heatmap — next 8 weeks

| Role | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 |
|---|---|---|---|---|---|---|---|---|
| Backend Platform Lead | 90% | 95% | 95% | 90% | 85% | 80% | 75% | 70% |
| Frontend Lead | 85% | 90% | 90% | 85% | 80% | 75% | 70% | 65% |
| SRE / QA Contractor | 100% ⚠️ | 100% ⚠️ | 100% ⚠️ | 100% ⚠️ | 50% | 50% | 25% | 25% |
| Program Manager | 60% | 60% | 50% | 50% | 50% | 50% | 50% | 50% |
| AI/ML Platform Lead | 70% | 75% | 80% | 75% | 70% | 70% | 65% | 60% |
| DevOps / Infra | 80% | 85% | 80% | 75% | 70% | 65% | 60% | 50% |

> ⚠️ = Over-allocated (>90% capacity). The current SRE/QA contractor is already fully booked on cloud-agent validation plus incident/monitoring follow-through.

### 3.3 Resource gaps linked to resolution actions

| Gap ID | Gap Description | Linked Resolution Action(s) | Recommended Action | Timeline | Est. Cost Impact | Decision Owner |
|---|---|---|---|---|---|---|
| GAP-R-1 | Shortage of senior backend capacity to close Helcim payments & gateway gaps simultaneously | R-1, R-2, R-6 | Contract / Hire | 2–4 weeks | $30–40K contractor or new-hire ramp | CTO |
| GAP-R-2 | Insufficient QA/SRE bandwidth to execute 50-gap cloud-agent validation PRD | R-3 | Extend contract | 4 weeks | $20–25K contractor extension | Engineering Manager |
| GAP-R-3 | Frontend lead split across new features and type-debt reconciliation | R-4 | Reallocate + upskill | 2–3 weeks | Internal cost only (defer one backlog feature) | Product Lead |
| GAP-R-4 | Program manager attention fragmented across roadmap, review escrow, and stakeholder comms | R-5 | Defer non-review work | 2 weeks | Risk: slower roadmap updates | Program Manager |

### 3.4 Over-allocation risk items

| Individual / Role | Load | Risk | Mitigation |
|---|---|---|---|
| SRE / QA Contractor | 100% over 4 weeks | Burnout; validation depth compromised | Extend contract or add second QA contractor for peak weeks |
| Backend Platform Lead | 95% in weeks 2–3 | Gateway + payments context switching | Temporarily reassign non-urgent gateway polish to AI/ML lead |

### 3.5 Net resource ask summary

To close the revenue-blocking financial gaps and the cloud-agent validation runway in the next **8 weeks**, the project requests:

- **+1 senior backend/platform engineer** (contractor or staff start) for **6–8 weeks**, focused on Helcim payments, webhook reliability, gateway BYO-bypass, and billing API surface.  
- **+1 QA/SRE contractor** for **4 weeks** (extension of current 0.5 FTE or net-new), focused on the 50-gap cloud-agent validation PRD and CI gates.  
- **Deferred:** one planned backlog UI feature (job category taxonomy / advanced filters) to free 10–15% frontend capacity for typecheck reconciliation.

**Estimated cost:** **$65,000 – $80,000 USD** over 8 weeks ( blended senior backend contractor + QA/SRE contractor, North American/Eastern European rates).  
**Decision needed by:** 2026-07-18 to onboard resources and hit the 2026-07-25 Helcim milestone.  
**Decision owner:** CTO, with Finance/Operations approval.

---

## 4. Appendix

### A.1 Raw data sources

- BuilderForce project board, project #11 — 296 active tasks as of 2026-07-12.
- `ROADMAP.md` — consolidated feature register, gap register, risk register.
- `DONE.md` — shipped features as of 2026-07-11 (_RUNTIME_, _LLM gateway_, _Evermind/SSM_, _Brain chat_ sections).
- `specs/builderforce/09-prd-cloud-agent-validation.md` — 50 cloud-agent validation gaps (17 P0, 22 P1, 11 P2).
- `specs/builderforce/15-resource-estimation.md` — resource estimation methodology and limitations.

### A.2 Metrics definitions

- **Velocity:** tasks closed per week (human + AI combined). Currently observed by board state; formal historical velocity tracking is in `in_review`.
- **Scope creep:** ratio of new tasks created vs. tasks closed in the reporting period.
- **Over-allocation:** assigned capacity > 90% sustained for two or more consecutive weeks.
- **Critical dependency risk:** open item blocks a P0 revenue or enterprise-readiness milestone.

### A.3 Document Changelog

| Version | Date | Author | Summary of changes |
|---|---|---|---|
| 1.0.0 | 2026-07-12 | BuilderForce Diagnostic Agent | Initial project health report + resolution plan + resource plan for BuilderForce.AI. |
