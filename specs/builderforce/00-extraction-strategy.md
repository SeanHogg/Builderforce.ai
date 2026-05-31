# 00 — Extraction Strategy & Two-App Architecture

## 1. Vision

**BuilderForce.ai** is an agentic AI platform that does two things that today live as separate
domains inside BurnRateOS:

- **Product Management** — discovery → MVP → roadmap → validation → backlog → ROI.
- **Agile Survival** — planning poker, retros, kanban, sprints, velocity, capacity, cost.

…and adds a third thing BurnRateOS never had:

- **Autonomous software development** — AI agents that turn the product/agile graph into real
  code: branches, PRs, refactors, test runs, and reviews.

The strategic logic: BurnRateOS is a **founder operating system** spanning nine CxO domains.
"How we build the product" (CPO + CTO work) is a *deep* vertical that deserves its own agentic
product. BurnRateOS already calls `api.builderforce.ai` for all LLM dispatch
(the AI facade). Extracting PM + Agile into BuilderForce turns that gateway relationship into a
full product relationship: **BurnRateOS becomes BuilderForce's first tenant and embeds it back.**

```
            BEFORE                                   AFTER
  ┌─────────────────────────┐         ┌──────────────────────┐   SSO + embed   ┌────────────────────────┐
  │      BurnRateOS          │         │     BurnRateOS        │ ───────────────►│     BuilderForce.ai     │
  │  9 domains incl.         │         │  7 domains +          │                 │  • Product Management   │
  │   • Product Management   │  ──────►│  thin embed shells:   │◄─────────────── │  • Agile Survival       │
  │   • Agile Survival       │         │   /product/* /agile/* │   work-item /    │  • Agentic Dev Layer    │
  │  AI → api.builderforce   │         │  AI → api.builderforce│   roadmap API    │  (system of record)     │
  └─────────────────────────┘         └──────────────────────┘                 └────────────────────────┘
```

## 2. Scope of the extraction

### 2.1 Moves to BuilderForce (becomes BuilderForce's system of record)

**Product Management** (frontend `domains/productManagement/`, backend
`routes/productManagement.ts`, `routes/featureScoring.ts`):

- Product Discovery (`product_ideas`, `market_analyses`, `competitive_analyses`,
  `customer_insights`)
- MVP Scaffolding (`mvp_scenarios`)
- AI Roadmap (the `roadmap` JSON on `product_ideas` + release planning on `work_items`)
- Validation Lab (`validation_results`, `validation_data_imports`, `validation_ai_insights`,
  `validation_dashboards`, `validation_scenarios`)
- Strategic Backlog (`work_items` where `stage = STRATEGIC_BACKLOG`)
- Custom Business-Value Models (`business_value_configs`)
- Feature ROI Portfolio (`feature_roi`, `roi_timeline_entries`)
- A/B Testing (`ab_tests`, `ab_test_variants`, `ab_test_segments`)
- Feature flags & experiments (the flag/experiment columns on `work_items`)
- Changelog / release planning / feature-flag manager pages

**Agile Survival** (frontend `domains/agileSurvival/`, backend `routes/kanban.ts`,
`routes/planningPoker.ts`, `routes/retrospectives.ts`, `routes/agileSurvival.ts`,
`routes/agileCost.ts`, `routes/featureScoring.ts`):

- Planning Poker (`planning_poker_sessions`, `planning_poker_session_participants`, `stories`,
  `votes`, `session_discussions`, `card_decks`) — incl. the realtime `SessionRoom` durable object
- Retrospectives (`retrospectives`, `retrospective_participants`, `retrospective_items`,
  `action_items`)
- Kanban (`kanban_boards`, `kanban_columns`, `work_items` where `stage = KANBAN_BOARD`,
  `deliveries`, `item_activities`)
- Sprints & forecasting (`sprints`, `team_velocity`, `sprint_forecasts`, `velocity_history`)
- Capacity & risk (`capacity_planning`, `team_capacity`, `risk_assessments`,
  `bottleneck_analysis`, `capacity_heatmaps`)
- Cost / runway integration (`task_effort_estimates`, `cost_calculations`,
  `sprint_financial_impact`, `runway_forecast_links`)
- Feature Scoring (RICE) and Action Items

> **`work_items` is the spine.** It is the single most important model: the *same* row is a
> strategic-backlog item (PM) and a kanban card (Agile), distinguished by `stage`. Both pillars
> share it. It **must move as one table** — splitting it would break the backlog→kanban flow
> that is the core PM↔Agile handoff.

### 2.2 Stays in BurnRateOS (BuilderForce federates these, never owns them)

- **Identity & tenancy core:** `Account`, `Company`, `Team`, `User`, `AuthUser`, RBAC/persona,
  subscription/billing, plan registry. BurnRateOS is the IdP.
- **The other seven domains:** Business Intelligence (CFO), Sales & Revenue + Customer
  Engagement (CRO), Investor Intelligence (CEO), Operational Cadence (CHRO), Governance &
  Compliance (CISO), Marketing & Growth (CMO).
- **The embed rail itself** (`routes/embed.ts`, `SystemFeature`, `AccountFeature`,
  `EmbedConsentLog`, `EmbedKey`) — BuilderForce re-embeds *through* this rail.
- **The AI gateway** (`api.builderforce.ai` + `@seanhogg/builderforce-sdk`) — unchanged;
  BuilderForce-the-product is a *different thing* from BuilderForce-the-gateway, but the gateway
  stays the LLM dispatch layer for both apps.

### 2.3 Cross-domain seams that must survive the cut

These are integrations the catalog promises. Today some are wired and some are aspirational.
After extraction they become **API calls across the app boundary** (see doc 05 for the contract).

| Seam | Direction | Today | After extraction |
|------|-----------|-------|------------------|
| Backlog → Kanban | within PM/Agile | `work_items.stage` transition (`movedToKanbanAt`) | Internal to BuilderForce — unchanged |
| Retro action item → Kanban | within Agile | `action_items.linkedEntityType/Id` (manual) | Internal to BuilderForce; **auto-convert now built** (see 03) |
| Customer feedback → Backlog | CRM → PM | `validation_results.engagementId` link only (manual) | **BurnRateOS → BuilderForce API**: CE posts feedback to `/v1/ingest/feedback` → backlog candidate |
| CFO runway/burn → cost-aware planning | BI → Agile | manual fields; `runway_forecast_links` exists but cost calc does **not** read `burn_rate_metrics` | **BuilderForce → BurnRateOS API**: pull burn rate to compute real cost-per-point (closes the marketing gap) |
| Story points / velocity / roadmap → board deck & health score | Agile → Investor/BI | no coupling found | **BurnRateOS → BuilderForce API**: read velocity/roadmap for decks |
| MVP scenario ↔ kanban budget | PM ↔ Agile | `kanban_boards.mvpScenarioId` + MVP variance | Internal to BuilderForce — unchanged |

## 3. Tenancy model (the isolation contract)

BuilderForce is multi-tenant. The hierarchy is **three levels**:

```
Tenant            e.g. "burnrateos"  — one integrating platform / direct customer
  └─ Segment      one per BurnRateOS (accountId, companyId) pair — the end-customer workspace
       └─ Entity  work_items, sprints, ideas… every row carries (tenantId, segmentId)
```

- **Tenant** = a consumer of BuilderForce. BurnRateOS is the first. (A future direct-sale
  customer would be its own tenant.)
- **Segment** = the unit of customer isolation *inside* a tenant. Because BurnRateOS is itself
  multi-tenant, every BurnRateOS `(accountId, companyId)` maps to exactly one Segment. **No query
  in BuilderForce ever runs without a `(tenantId, segmentId)` filter.** This is what guarantees
  "no customer's data bleeds."
- Every ported table that today has `companyId` (and sometimes `accountId`) gets **`tenantId` +
  `segmentId`** instead, with a composite index leading on both. See doc 01 §3.

This is the single most important invariant for the agentic builder: **Segment is the new
company-scope.** Every repository function, every API handler, every agent action resolves and
enforces `(tenantId, segmentId)` first.

## 4. Migration plan (data)

Pre-launch posture applies: per BurnRateOS convention there are **no production users yet**, so
migrations may **drop-and-recreate** rather than backfill (no `*_v2`/`*_legacy`). But because the
field-union rule still holds, the BuilderForce schema must preserve **every field** of every
moved model.

**Phase A — Stand up BuilderForce schema.** Create the full domain model (doc 01) in BuilderForce
with Tenant/Segment scoping. Seed the `burnrateos` tenant.

**Phase B — One-shot export/import (optional).** If any BurnRateOS rows are worth keeping, run a
one-time ETL: for each moved table, read by `companyId`, resolve/create the Segment from
`(accountId, companyId)`, write into BuilderForce with `(tenantId=burnrateos, segmentId)`.
Preserve UUIDs so cross-references (`work_items.parentId`, `validation_results.productIdeaId`,
etc.) survive. If there's nothing worth keeping, skip — greenfield the tenant.

**Phase C — Drop moved tables from BurnRateOS.** Remove the ~30 moved models and their routes
from BurnRateOS. Replace pages with embed shells (doc 05 §5). Keep `Company/Team/User/Account`.

**Phase D — Wire the cross-domain API seams** (§2.3) as live calls.

## 5. Rollout & cutover

1. Ship BuilderForce standalone (its own UI works end-to-end for the `burnrateos` tenant).
2. Add the embed-back surface + SSO handshake (doc 05). Validate one Segment end-to-end.
3. Flip BurnRateOS `/product/*` and `/agile/*` pages to embed shells behind a feature flag
   (`embed_builderforce`), defaulting OFF, ramping per the embed rail's consent model.
4. Once embedded surfaces match parity, remove the legacy BurnRateOS PM/Agile code.
5. Wire the cross-domain seams; remove the temporary manual-link fallbacks.

## 6. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `work_items` is shared by both pillars — easy to fracture | Move as one table; keep `stage` enum as the only PM/Agile discriminator (doc 01 §4.1). |
| Cross-app latency on the backlog→deck/feedback seams | Seams are async/eventual (webhooks + polling), never in a synchronous render path. |
| Segment mis-resolution → data bleed | Single `resolveSegment(jwt)` chokepoint; every repo asserts `(tenantId, segmentId)`; integration test that a Segment cannot read another Segment's rows. |
| Realtime poker durable object (`SessionRoom`) must move | Re-implement in BuilderForce's realtime layer; sessions are ephemeral so no migration needed. |
| Marketing claims that were never coded (feedback→backlog auto, runway→cost auto) | Treated as **build requirements** in the PRDs, not regressions; called out explicitly. |
| Identity drift if BuilderForce caches user/company copies | BuilderForce stores only IDs + a denormalized display cache refreshed from SSO claims; BurnRateOS remains source of truth for identity. |

## 7. Out of scope for v1

- Direct (non-BurnRateOS) BuilderForce customers — the tenant model supports it, but no
  self-serve signup/billing in v1. (Decision 4 was "BurnRateOS is IdP"; standalone auth is a
  later tenant type.)
- Migrating the other seven BurnRateOS domains.
- Replacing the `api.builderforce.ai` LLM gateway — it stays as-is.
