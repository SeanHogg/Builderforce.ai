# 06 — Marketing-Parity Additions & Traceability

Source: every functionality claim on the BurnRateOS marketing surfaces for these two domains —
`ProductManagementMarketingPage.tsx`, `AgileSurvivalMarketingPage.tsx`,
`SurvivalFocusedAgileHero.tsx`, `AgileKanbanHero.tsx`, and the two competitor pages.

This document does two jobs:
1. **§A — New scope.** Capabilities the marketing promises that docs 02–05 did **not** yet cover.
   These are now in-scope for BuilderForce and specced below.
2. **§B — Traceability matrix.** Every marketing claim → where it's satisfied (doc/section), so
   nothing the marketing sells is left unbuilt.

> Principle applied: *add what's missing, never trim the offering.* Where marketing claims a
> capability with no spec, we added a spec — we did not downgrade the marketing.

---

## §A — New scope (build these in addition to docs 02–05)

### A1 — Migrations & Import (Jira / Linear / CSV) — **CPO+CTO, new**

Marketing: *"Jira: one-click importer — move off Jira into BurnRateOS"*, *"Linear: importer
planned — BurnRateOS replaces Linear for startups"*, *"Migration from Jira is a one-click
import."* The domain catalog explicitly positions BurnRateOS as **replacing** Jira/Linear, not
integrating with them. BuilderForce must own the importer.

- **Importers:** Jira (one-click, OAuth/API token), Linear (API key), generic CSV. Map external
  issues → `WorkItem` (preserve type/priority/status/assignee via `IdentityCache` resolution,
  parent/child, labels→`tags`, story points→`effort`), boards/projects → `KanbanBoard`/columns,
  sprints → `Sprint`, comments/history → `ItemActivity`.
- **Idempotent + resumable:** store an `ImportJob` per run (source, status, counts, dedupe key =
  external id) so re-running doesn't duplicate. External id kept on `WorkItem.externalRef`.
- **Dry-run preview:** show what will be created before committing.
- **Entities (new):** `ImportJob { id, tenantId, segmentId, source, status, mapping, counts, log,
  createdBy }`. Reuse `WorkItem.externalRef`/`Story.externalId`/`externalUrl` for back-links.
- **API:** `POST /v1/imports { source, credentials, mapping }` → job; `GET /v1/imports/:id`
  (progress); `POST /v1/imports/:id/commit`.

### A2 — Engineering Management (EMP): DORA & delivery metrics + PR analytics — **CTO, new**

Marketing: *"Engineering Management Platform: Native EMP features … cycle time, DORA metrics, PR
analytics."* This is a natural fit for BuilderForce because it already connects repos (doc 04 §3).

- **DORA four keys** per Segment/team/repo: deployment frequency, lead time for changes, change
  failure rate, MTTR. Derived from `Repo` activity (commits, PRs, deploys via provider/CI
  webhooks) + `WorkItem` lifecycle timestamps (`workStartedAt`/`workCompletedAt`/`releasedAt`).
- **Flow/cycle metrics:** cycle time, lead time, WIP, throughput (already partly in AS-3
  `metrics/flow`) — extend to a first-class **Engineering Insights** dashboard.
- **PR analytics:** PR size, review latency (open→first-review, open→merge), merge throughput,
  review coverage — per author and team. Agent-authored vs. human-authored PRs distinguished
  (an agent PR carries `AgentRun.id`).
- **"Performance Boost" recommendations:** an AI pass (`agile.eng.recommend`) reads the DORA/flow
  trend and proposes concrete improvements ("review latency is your bottleneck; cap WIP at 4").
  Satisfies the marketing *"AI-powered optimization recommendations for faster development
  cycles."*
- **Entities (new):** `EngMetricSnapshot { id, tenantId, segmentId, teamId?, repoId?, period,
  periodStart, periodEnd, deployFrequency, leadTimeHours, changeFailureRate, mttrHours,
  cycleTimeHours, throughput, prMetrics Json }`. Daily recompute + on-webhook.
- **API:** `GET /v1/eng/metrics?teamId|repoId&period=…`, `GET /v1/eng/pr-analytics`,
  `GET /v1/eng/recommendations`.

### A3 — Git activity sync (bidirectional, all repo activity — not just agent PRs) — **CTO, extend doc 04/05**

Marketing: *"GitHub: Link commits, PRs, and issues to backlog items."* Doc 04 covers agent-authored
PRs; this generalizes to **all** repo activity (human-authored too) and **inbound** issues.

- Link commits/PRs (by `#<workItemId>` or branch convention) to `WorkItem`; surface them on the
  card. PR-merged webhook transitions `WorkItem.status`/`stage` (extends doc 05 §4.3 to all PRs).
- Import existing GitHub/GitLab issues as `WorkItem`s (overlaps A1's generic importer).
- **API:** webhook receiver `/v1/webhooks/scm`; `GET /v1/work-items/:id/scm-activity`.

### A4 — Slack notifications & digests — **cross-cutting, new**

Marketing: *"Slack: Product team notifications and digests."*

- Per-Segment Slack connection; event subscriptions: sprint started/closed, PR opened/merged,
  agent run finished, backlog auto-optimized, retro action items created, DORA threshold
  breaches. Scheduled digests (daily/weekly product + eng summary).
- **Entities (new):** `NotificationChannel { id, tenantId, segmentId, kind:"SLACK", config,
  subscriptions Json }`. **API:** `POST /v1/notifications/channels`, `PUT …/subscriptions`.

### A5 — Kanban swim lanes + gamified budget economics — **CTO, extend AS-3**

Marketing (kanban): *"WIP limits, swim lanes, and custom columns."* Marketing (AgileKanbanHero):
*"Reward feature delivery with budget boosts,"* *"Align development with investor milestones,"*
*"Gamified economics,"* *"$15K earned,"* *"Feature Delivery: User Auth +$8K, Payment Flow +$12K."*

- **Swim lanes:** a board grouping axis (by assignee, epic, class-of-service, or custom). Add
  `KanbanBoard.swimlaneConfig Json` + `WorkItem.swimlaneKey String?`.
- **Budget economics (the "funding-aware agile" mechanic):** a board has an `earnedBudget` that
  increases by a configured reward when a high-value feature reaches DONE (the `revenueValue`/
  `businessValue` drives the boost), shown against burn and runway. This is the headline
  differentiator of the kanban hero and must be built, not just charted.
- **Investor-milestone alignment:** a board/sprint can be tagged to an investor milestone
  (e.g. "Series B readiness"); progress rolls up to the Investor seam (A8). Add
  `KanbanBoard.investorMilestoneRef Json?`.
- **Entities (new):** `BoardBudgetLedger { id, tenantId, segmentId, boardId, event, amount,
  workItemId?, balanceAfter, createdAt }` — append-only record of earned/spent budget events.
- **API:** `GET /v1/kanban/boards/:id/budget-ledger`, swimlane fields on existing board/item
  endpoints.

### A6 — Cross-sprint retro sentiment & recurring-theme analysis — **CTO, extend AS-2**

Marketing: *"Sentiment analysis highlights recurring themes across sprints,"* *"Team Insights:
Analytics on team sentiment and trends,"* *"Action items carry forward until completed."*

- Aggregate `RetrospectiveItem`s across a team's retro history → AI theme clustering + sentiment
  trend (`agile.retro.themes`). Surface "recurring themes" and a sentiment trend line.
- **Carry-forward:** incomplete `ActionItem`s auto-surface in the next retro until COMPLETED.
- **API:** `GET /v1/retros/insights?teamId&window=…` (extend existing insights endpoint with
  theme clusters + sentiment trend + open carry-forward items).

### A7 — Product Analytics, Release Planning, Changelog, Feature-Flag manager (explicit PM surfaces) — **CPO, formalize**

These BurnRateOS pages existed but docs 02 only referenced them in passing. Spec them explicitly:

- **Product Analytics** (*"Deep insights into feature performance, user engagement, and business
  impact"*): a dashboard over `WorkItem` adoption fields (`featureAdoptionRate`,
  `featureUsageCount`, `activeUsers`, `lastUsageTrackedAt`) + `FeatureROI`. Distinct from the ROI
  portfolio: this is usage/engagement-centric. `GET /v1/product-analytics`.
- **Release Planning** (*"timeline optimization and milestone tracking"*): a builder over the
  `WorkItem` release fields (`targetReleaseId`/`releaseVersion`/`releaseDate`) that groups items
  into releases with milestones; complements AI Roadmap (PM-3). `GET/POST /v1/releases`.
- **Changelog** (*"release notes and product change history"*): generated from
  `WorkItem.releaseNotes`/`releasedAt`; published changelog per Segment, optionally surfaced via
  the embed rail to a customer's site. `GET /v1/changelog`, `POST /v1/changelog/publish`.
- **Feature-Flag manager**: a management surface over the WorkItem flag fields
  (`isFeatureFlag`/`featureFlagKey`/`featureFlagStatus`/`rolloutPercentage`/`targetUserSegments`),
  readable by the host app through `embed_feature_management` (already in the embed rail).
  `GET/PATCH /v1/feature-flags`.

### A8 — Investor-milestone & CFO seams (extend doc 05 §4) — **cross-domain**

Marketing: *"Velocity trends feed the CFO's runway projections,"* *"When engineering output dips,
the forecast updates the same day,"* *"Align development with investor milestones,"* *"On track
for Series B."*

- **Velocity → CFO (push):** on sprint close, BuilderForce pushes velocity + financial impact to
  BurnRateOS BI via webhook (already in doc 05 §4.3 `sprint.completed`) so the CFO runway forecast
  updates same-day. Make this an explicit acceptance criterion.
- **Investor milestone (push):** `workitem.released`/board-milestone progress webhooks feed
  BurnRateOS Investor Intelligence so "Series B readiness" reflects real delivery.

### A9 — Validation experiment templates + decision rule — **CPO, extend PM-4**

Marketing: *"lightweight experiments (A/B tests, fake-door tests, concierge MVPs),"* *"Links
experiment to … decision rule,"* *"Recommends whether to pursue, pivot, or kill the idea."*

- Add named experiment **templates** to Validation Lab: A/B test, fake-door, concierge MVP,
  smoke test (each pre-fills method + metrics scaffolding). Map to `ValidationScenario`.
- Add an explicit **decision rule** field + a **pursue / pivot / kill** recommendation on the
  AI analysis output (`pm.validation.analyze` returns one of the three + rationale).

---

## §B — Traceability matrix (every marketing claim → where satisfied)

Legend: ✅ already specced · ➕ new in §A above.

### Product Management

| Marketing claim | Where |
|---|---|
| AI research: market signals / competitors / customer pain points | ✅ 02 PM-1 (`pm.discovery.research`) |
| Discovery feeds MVP scaffolding | ✅ 02 PM-1→PM-2 |
| MVP: scope-locked feature set, user stories, sprint plan, effort, draggable backlog | ✅ 02 PM-2 (`generate-backlog`) |
| Roadmap: outcome-driven, ranks by revenue/runway/strategic, live data, auto re-rank | ✅ 02 PM-3 (`pm.roadmap.generate`) |
| Validation: A/B / fake-door / concierge MVP templates | ➕ A9 |
| Validation: hypothesis ↔ metric ↔ decision rule; confidence; pursue/pivot/kill | ✅ 02 PM-4 + ➕ A9 (decision rule, recommendation) |
| Strategic backlog: business-value score, auto stack-rank, CPO override, Kanban integ | ✅ 02 PM-5, PM-6 |
| Link customer feedback to backlog | ✅ 05 §4.2 (CRM feedback ingest) |
| Revenue impact / priority score / sprint velocity / cost-per-point / ROI | ✅ 02 PM-5/PM-7, 03 AS-1/AS-7 |
| Product Analytics (feature perf, engagement, business impact) | ➕ A7 |
| Release Planning (timeline opt, milestones) | ➕ A7 (complements 02 PM-3) |
| Changelog / release notes | ➕ A7 |
| Performance Boost: AI optimization recommendations | ➕ A2 (`agile.eng.recommend`) |
| GitHub: link commits/PRs/issues to backlog | ➕ A3 |
| Slack: notifications & digests | ➕ A4 |
| Jira one-click importer; Linear importer | ➕ A1 |
| EMP: cycle time, DORA, PR analytics (Phase 11) | ➕ A2 |
| Analytics usage-data ingestion | ➕ A7 (product analytics ingestion) |
| Gap analysis / competitor analysis / financial ROI / startup pricing | ✅ 02 PM-1/PM-7 (pricing = host plan, doc 05 §3) |

### Agile Survival

| Marketing claim | Where |
|---|---|
| Planning poker: real-time, simultaneous reveal, Fibonacci/T-shirt/custom, re-vote, lock | ✅ 03 AS-1 |
| Poker: historical velocity improves estimates; session history; stories in-tool | ✅ 03 AS-1 (+`estimate-assist`), AS-5 |
| Poker: cost-per-point / runway impact visible during estimation | ✅ 03 AS-1 + AS-7 |
| Poker free on all plans | ✅ plan gating per host (doc 05 §3) |
| Retros: SSC / Mad-Sad-Glad / 4Ls / custom; anonymous; voting; grouping; action items | ✅ 03 AS-2 |
| Retros: sentiment analysis / recurring themes across sprints; team insights | ➕ A6 |
| Retros: action items carry forward until completed | ➕ A6 |
| Retro ↔ poker ↔ kanban integration; link retro items to board | ✅ 03 AS-2 (`convert-to-backlog`) |
| Kanban: burn-rate impact per card, runway-days cost, WIP limits, custom columns | ✅ 03 AS-3 + AS-7 |
| Kanban: swim lanes | ➕ A5 |
| Kanban: budget boosts on delivery, gamified economics, earned budget | ➕ A5 |
| Kanban: align development with investor milestones | ➕ A5 + A8 |
| Kanban: Scrum + Kanban process types; sprint mgmt; burndown | ✅ 01 `AgileProcessType`, 03 AS-3/AS-4 |
| Jira one-click import to board | ➕ A1 |
| Sprint forecasting: AI, velocity forecast, runway projection, risk, timeline opt | ✅ 03 AS-4 |
| Sprint cost = team×duration; running cost vs capacity; cost-per-point in reviews | ✅ 03 AS-7 |
| Velocity: points/sprint, burn overlay, capacity planning, burndown, predictive | ✅ 03 AS-5/AS-6 |
| Velocity → CFO runway forecast; same-day update on output dip | ➕ A8 (explicit) + ✅ 05 §4.3 |
| Feature-to-market-fit scoring (market fit / survival / ROI / strategic) | ✅ 03 AS-6 (`pm.feature_score`) |
| Every story gets a dollar cost; burndown overlays burn; same record across domains | ✅ 03 AS-7 + 05 §4.1 |

### Cross-cutting / AI / startup

| Marketing claim | Where |
|---|---|
| AI CTO persona for velocity analysis | ✅ 03 AS-4 + gateway persona (doc 05 §6) |
| Sentiment analysis across sprints | ➕ A6 |
| Burn-rate tracking, runway projections, cost-per-point, dollar-cost stories, cash forecasting | ✅ 03 AS-7 + 05 §4.1 |
| Real-time / async / distributed team collaboration | ✅ 03 realtime rooms (AS-1/AS-2) |
| No tool switching / integrated suite | ✅ single product, shared `WorkItem` spine |
| Startup pricing (free ≤5 users, $5/user) ; 5-min setup; no hidden fees | ✅ inherited from host plan/billing (doc 05 §3) — BuilderForce does not own pricing in v1 |
| Distributed/global, time-zone friendly | ✅ realtime + Segment model; no extra scope |

---

## §C — Net-new entities added by this doc (append to doc 01)

```
ImportJob          (A1)  source/status/mapping/counts/log
EngMetricSnapshot  (A2)  DORA + flow + PR metrics per team/repo/period
NotificationChannel(A4)  Slack connection + event subscriptions
BoardBudgetLedger  (A5)  append-only earned/spent budget events
+ WorkItem.swimlaneKey, WorkItem.externalRef (SCM/import back-link)
+ KanbanBoard.swimlaneConfig, .investorMilestoneRef
```

## §D — Net-new AI use cases (append to doc 01 §8)

| Use case | Purpose |
|---|---|
| `agile.eng.recommend` | DORA/flow-trend-driven improvement recommendations |
| `agile.retro.themes` | cross-sprint recurring-theme + sentiment clustering |
| `import.map_fields` | suggest field mappings for a CSV/Jira/Linear import |

---

## §E — Phasing note

The §A additions slot into the doc-00 rollout: **A1 (import)** is required for any team migrating
off Jira/Linear, so it ships early alongside the core port. **A2/A3 (EMP/DORA + git sync)** ride
on the agentic dev layer (repos already connected) — ship with doc 04 v1.1. **A5 (budget
economics)** is the kanban differentiator — ship with the core Agile port. **A4/A6/A7/A8/A9** are
fast-follows. None of them change the Tenant→Segment isolation model or the embed-back contract.
