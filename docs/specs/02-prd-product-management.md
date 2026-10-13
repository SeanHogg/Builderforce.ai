# 02 — PRD: Product Management Pillar

**Persona:** CPO / founder-as-product-owner. **Pillar goal:** take a raw idea to a validated,
prioritized, ROI-tracked roadmap — then hand it to the Agile pillar and the agentic dev layer to
build. **Scope:** seven features, all owned by BuilderForce, all Segment-scoped, all AI-assisted
through the gateway.

> Conventions for every feature below: all endpoints are under `/v1` on the BuilderForce API,
> require a valid Segment-scoped JWT, and are rate-limited per Segment. "Acceptance" = the
> conditions the agentic builder must satisfy. AI calls name their `AI_USE_CASES` key.

---

## PM-1 — Product Discovery

**What it is.** AI-powered ideation: turn a problem statement into a structured, scored idea with
market analysis, competitive landscape, and customer insights — before any code.

**Entities:** `ProductIdea`, `MarketAnalysis`, `CompetitiveAnalysis`, `CustomerInsight`.

**User stories**
- As a founder, I create an idea (name, description, problem statement, target market) and the
  system scaffolds a discovery workspace.
- As a founder, I run an AI discovery wizard that produces market sizing (TAM/SAM/SOM), trends,
  threats, a competitor table, and synthesized customer insights.
- As a founder, I upload supporting docs (decks, transcripts, notes) and the system summarizes
  them into the idea's `documentSources` and `aiInsights`.
- As a founder, I view a gap analysis and value hierarchy and a status pipeline
  (DISCOVERY→VALIDATION→BUILDING→LAUNCHED).

**Flow**
1. Create `ProductIdea` (status `DISCOVERY`).
2. Discovery wizard step calls `pm.discovery.research` → writes `MarketAnalysis`,
   `CompetitiveAnalysis[]`, `CustomerInsight[]`, and the `gapAnalysis`/`valueHierarchy`/
   `aiInsights` JSON on the idea.
3. Optional doc upload → summarized into `documentSources`.
4. "Send to backlog" creates `WorkItem`(s) with `origin = PRODUCT_DISCOVERY`,
   `stage = STRATEGIC_BACKLOG`, tagged with the idea id.

**API**
```
GET    /v1/ideas                          list (filter by status)
POST   /v1/ideas                          create
GET    /v1/ideas/:id                       detail (+ nested analyses)
PUT    /v1/ideas/:id
DELETE /v1/ideas/:id
POST   /v1/ideas/:id/discovery/run         run AI discovery wizard  → pm.discovery.research
GET/POST /v1/ideas/:id/market-analysis
GET/POST /v1/ideas/:id/competitive-analysis
GET/POST /v1/ideas/:id/customer-insights
POST   /v1/ideas/:id/documents             upload + summarize
POST   /v1/ideas/:id/send-to-backlog       → WorkItem(s)
```

**Acceptance**
- Idea CRUD scoped to Segment; cannot read another Segment's ideas.
- Discovery run is idempotent per idea-version and credit-metered; partial failures don't corrupt
  existing analyses.
- `send-to-backlog` creates traceable WorkItems (tag + `origin`) and is reversible (delete the
  WorkItems without deleting the idea).
- **[NEW seam]** Customer insights may be created from BurnRateOS CRM feedback via
  `externalRef` (doc 05 §4.2) — a feedback item becomes a `CustomerInsight(insightType=FEEDBACK)`
  candidate that the founder can attach to an idea.

---

## PM-2 — MVP Scaffolding Engine

**What it is.** AI MVP planning: scenario generation, break-even analysis, timeline
optimization, and automated backlog creation.

**Entities:** `MVPScenario` (+ link to `ProductIdea`, `KanbanBoard.mvpScenarioId`).

**User stories**
- As a founder, I create an MVP scenario from an idea with business inputs (pricing model, target
  revenue, timeline weeks, budget, team size).
- As a founder, I generate AI recommendations: which features make the MVP cut, phased
  (MVP_1/MVP_2/POST_MVP), with break-even and timeline.
- As a founder, I approve a scenario and auto-generate a backlog from it.
- As a founder, I track budget-to-actuals once a board is linked to the scenario.

**Flow**
1. Create `MVPScenario` (status `DRAFT`).
2. `pm.mvp.generate` → `aiInsights` (feature cut, phases, break-even, timeline); status `READY`.
3. Approve (`APPROVED`) → generate `WorkItem`s with `origin = MVP_SCAFFOLDING`, `mvpPhase`,
   `complexity`, `revenueImpact`, user-story fields (`userType`/`want`/`so`).
4. Link a `KanbanBoard` (`mvpScenarioId`) → budget variance available.

**API**
```
GET/POST   /v1/mvp/scenarios
GET/PUT/DELETE /v1/mvp/scenarios/:id
POST       /v1/mvp/scenarios/generate-recommendations   → pm.mvp.generate
POST       /v1/mvp/scenarios/:id/generate-backlog        → WorkItem[]
GET        /v1/mvp/scenarios/:id/budget-comparison       (reads linked board actuals)
```

**Acceptance**
- Break-even math is deterministic given inputs; AI only proposes the feature cut & narrative.
- Generated backlog items carry full provenance and the user-story fields.
- Budget comparison reflects `kanban_boards.estimatedBudget/actualCost` + WorkItem
  `estimatedCost/actualCost` for linked boards.

---

## PM-3 — AI Roadmap Generation

**What it is.** Build a runway-aware, ROI-ordered roadmap from the backlog, runway, and
business-value config. Investor-ready export.

**Entities:** `ProductIdea.roadmap` (JSON), `WorkItem` release fields (`targetReleaseId`,
`releaseVersion`, `releaseDate`), `BusinessValueConfig`.

**User stories**
- As a founder, I generate a roadmap that sequences backlog items for maximum ROI per runway
  dollar.
- As a founder, I see scenarios (aggressive/balanced/conservative) and pick one.
- As a founder, I export an investor-ready roadmap (PDF/JSON).
- As a founder, roadmap items map to release versions on the WorkItems.

**Flow**
1. Gather inputs: backlog WorkItems (with `businessValue`, `effort`, `priorityScore`),
   active `BusinessValueConfig`, and **runway from BurnRateOS BI** (doc 05 §4.1 — the
   cross-domain seam; falls back to manual runway input if unavailable).
2. `pm.roadmap.generate` → sequenced plan with release buckets + rationale.
3. Persist to `ProductIdea.roadmap` and stamp `targetReleaseId`/`releaseVersion`/`releaseDate`
   on the chosen WorkItems.

**API**
```
POST /v1/roadmap/generate            { ideaId?, scenario, runwayMonths?, valueConfigId } → pm.roadmap.generate
GET  /v1/roadmap                      current roadmap (+ release buckets)
POST /v1/roadmap/apply                stamp release fields onto WorkItems
GET  /v1/roadmap/export?format=pdf|json
```

**Acceptance**
- Sequencing respects dependencies (`WorkItem.dependencies`) — no item before its blockers.
- Runway-aware: if runway is known, the roadmap shows cumulative burn vs. runway and flags items
  that push past zero cash.
- Export is deterministic from persisted state (no re-run of the model on export).

---

## PM-4 — Validation Lab

**What it is.** Structured experiments to validate assumptions before committing engineering;
confidence scoring; AI analysis of results and evidence.

**Entities:** `ValidationResult` (+ `ValidationDataImport`, `ValidationAIInsight`,
`ValidationDashboard`, `ValidationScenario`).

**User stories**
- As a founder, I create a validation experiment (type PROBLEM/SOLUTION/MARKET/PRICING/CHANNEL)
  with a hypothesis, method, and hypothesis variables.
- As a founder, I import data (text/CSV/PDF) or link a BurnRateOS feedback widget / cohort as
  evidence (`engagementId`/`engagementType`).
- As a founder, I run AI analysis that produces insights, a verdict
  (VALIDATED/INVALIDATED/INCONCLUSIVE), confidence, and a dashboard.
- As a founder, I track confidence per idea across the five validation dimensions.

**Flow**
1. Create `ValidationResult` (result `IN_PROGRESS`).
2. Attach data imports / engagement link.
3. `pm.validation.analyze` reads hypothesis + method + imports + linked evidence → writes
   `ValidationAIInsight` + `ValidationDashboard`, sets `result`/confidence.
4. Confidence rolls up per `productIdeaId` across the five `ValidationType`s.

**API**
```
GET/POST   /v1/validation/results
GET/PUT/DELETE /v1/validation/results/:id
POST       /v1/validation/results/:id/imports
PUT/DELETE /v1/validation/results/:id/engagement      link/unlink feedback widget/cohort
POST       /v1/validation/results/:id/analyze          → pm.validation.analyze
GET        /v1/validation/results/:id/dashboard
GET        /v1/validation/confidence/:productIdeaId
GET        /v1/validation/engagements                   (proxies BurnRateOS feedback widgets — doc 05)
```

**Acceptance**
- Engagement linking calls the BurnRateOS CRM API for the Segment's widgets/cohorts; never reads
  a BurnRateOS DB directly.
- Analysis is credit-metered and stores structured (not free-text-only) verdicts.
- Confidence rollup is computed, not stored stale.

---

## PM-5 — Strategic Backlog Management

**What it is.** Prioritize features by business value, revenue impact, and survival metrics. The
PM-side view of `WorkItem` (`stage = STRATEGIC_BACKLOG`).

**Entities:** `WorkItem` (backlog stage), `BusinessValueConfig`.

**User stories**
- As a founder, I CRUD backlog items with type, priority, business value, effort, risk,
  acceptance criteria, dependencies.
- As a founder, I see prioritization scores and an auto-optimize action that re-ranks by
  value/cost.
- As a founder, I filter by priority/type and see backlog statistics.
- As a founder, I promote a backlog item to the kanban board (hands off to Agile pillar).

**API**
```
GET/POST   /v1/backlog/items                  (stage=STRATEGIC_BACKLOG)
GET/PUT/DELETE /v1/backlog/items/:id
GET        /v1/backlog/items/priority/:priority
GET        /v1/backlog/items/type/:type
GET        /v1/backlog/statistics
GET        /v1/backlog/prioritization-scores
POST       /v1/backlog/auto-optimize
POST       /v1/backlog/items/:id/move-to-board { boardId, columnId }   → sets stage=KANBAN_BOARD, movedToKanbanAt
GET        /v1/backlog/holistic-view
```

**Acceptance**
- `move-to-board` is the canonical backlog→kanban handoff: flips `stage`, sets `movedToKanbanAt`,
  assigns `columnId`/`boardId`/`position`, writes an `ItemActivity`.
- Prioritization score = function of `businessValue`, `effort`, `risk`, and the active
  `BusinessValueConfig` (revenue vs. customer-KPI weighting).
- Auto-optimize is explainable (returns the ranking rationale).

---

## PM-6 — Custom Business-Value Models

**What it is.** Let each team define how feature value is scored — revenue, customer KPI, or both
— so prioritization aligns to that team's strategy.

**Entities:** `BusinessValueConfig`.

**User stories**
- As a founder, I configure value type (REVENUE/CUSTOMER_KPI/BOTH), display mode, revenue
  settings, customer-KPI settings, and a reward multiplier.
- As a founder, the active config drives prioritization scores in the backlog and value display
  on kanban cards.

**API**
```
GET/POST   /v1/business-value-config
PUT        /v1/business-value-config/:id
POST       /v1/business-value-config/:id/activate     (one active per team)
```

**Acceptance**
- Exactly one active config per `(segmentId, teamId)`.
- Changing the config recomputes backlog prioritization scores on next read (no stale scores).
- Both PM (backlog) and Agile (kanban card value badges) read the same config — single source.

---

## PM-7 — Feature ROI Portfolio

**What it is.** Portfolio-level ROI: development + maintenance cost vs. revenue + cost savings +
usage + customer metrics, with calculated ROI, risk, and recommendations, tracked over time.

**Entities:** `FeatureROI`, `ROITimelineEntry`. Also reads WorkItem actuals
(`actualRevenueImpact`, `featureAdoptionRate`, `actualCost`).

**User stories**
- As a founder, I track ROI per feature (development, maintenance, revenue, cost savings, usage,
  customer JSON blocks) with a status (TRACKING/COMPLETED/ARCHIVED).
- As a founder, I see a portfolio view: investment vs. return, risk assessment, strategic
  recommendations.
- As a founder, ROI snapshots are recorded over time (`ROITimelineEntry`).

**API**
```
GET/POST   /v1/feature-roi
GET/PUT/DELETE /v1/feature-roi/:id
POST       /v1/feature-roi/:id/snapshot           append ROITimelineEntry
GET        /v1/feature-roi/portfolio              → pm.feature_roi.analyze (risk + recommendations)
```

**Acceptance**
- `calculated` ROI is derived from the cost/revenue blocks, not hand-entered.
- Portfolio analysis is credit-metered and returns ranked recommendations with risk flags.
- Where a `FeatureROI.featureId` maps to a `WorkItem`, the portfolio view shows actuals from that
  item (adoption, actual revenue/cost) so ROI reflects shipped reality.

---

## A/B Testing & Feature Flags (cross-cutting under PM)

These live on `WorkItem` (flag/experiment columns) plus dedicated `ABTest`/`ABTestVariant`/
`ABTestSegment`. They serve both PM (validate features) and the agentic layer (agents can ship
behind a flag).

**API**
```
GET/POST   /v1/ab-tests
GET/PATCH  /v1/ab-tests/:id
POST       /v1/ab-tests/:id/results
POST       /v1/ab-tests/:id/conclude            { winner }
GET/PATCH  /v1/work-items/:id/feature-flag       toggle/rollout %
```

**Acceptance**
- Feature-flag state on a WorkItem is readable by the embed-back surface so BurnRateOS (or the
  customer's own app) can gate UI on it — reuses the existing `embed_feature_management` pattern.
- Concluding an A/B test stamps `winner` and writes `experimentResults` back onto the WorkItem.

---

## Pillar-level acceptance

- Every PM page that exists in BurnRateOS today has a parity surface in BuilderForce: Ideas
  dashboard + detail, MVP, Backlog, Validation Lab, Roadmap, Holistic dashboard, Changelog,
  Feature-flag manager, Release-planning builder.
- The PM→Agile handoff (`move-to-board`) and PM→Agent handoff (doc 04) are both live.
- All AI runs are Segment-credit-metered and vendor-hidden.
