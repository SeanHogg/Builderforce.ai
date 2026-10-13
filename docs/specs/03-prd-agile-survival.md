# 03 — PRD: Agile Survival Pillar

**Persona:** CTO / engineering-lead founder. **Pillar goal:** plan and execute delivery with
runway awareness — every estimate, sprint, and board decision is honest about its cash cost.
**Scope:** six features + the cost/runway integration, all owned by BuilderForce, Segment-scoped,
with realtime collaboration for poker and retros.

> The defining property of this pillar (vs. generic Jira/Linear) is **cost-awareness**: story
> points, sprints, and cards carry dollar/runway impact. The marketing promised this; the
> BurnRateOS implementation only partially delivered it (cost fields were manual and not linked
> to real burn rate). **This PRD makes the runway link real** via the BI seam (doc 05 §4.1).

---

## AS-1 — Planning Poker Sessions (realtime)

**What it is.** Cost-aware collaborative story pointing with velocity-based forecasting.

**Entities:** `PlanningPokerSession`, `PlanningPokerSessionParticipant`, `Story`, `Vote`,
`SessionDiscussion`, `CardDeck`. **Realtime:** a per-session room (BurnRateOS used a Cloudflare
durable object `SessionRoom`; BuilderForce re-implements with its realtime layer — WebSocket/SSE).

**User stories**
- As a facilitator, I create a session (voting system, timer, settings), add stories, and invite
  participants via a join link.
- As a voter, I join, vote on the active story; votes are hidden until reveal.
- As a facilitator, I reveal votes, see convergence, reset/re-vote, and finalize an estimate.
- As a team, we discuss via the in-session discussion panel (comment/question/clarification/
  decision), resolvable.
- As a facilitator, I see each story's revenue impact, runway extension, cost estimate, and ROI
  while estimating — so cost stays visible during the debate.
- On close, finalized estimates apply back to the linked WorkItems.

**Realtime events** (room keyed by `sessionId`, authorized to Segment members):
`participant.joined/left`, `vote.cast` (value hidden), `story.revealed`, `votes.reset`,
`story.activated`, `discussion.posted/resolved`, `timer.started/ended`, `session.completed`.

**API**
```
GET/POST   /v1/poker/sessions
GET/PATCH/DELETE /v1/poker/sessions/:id
POST       /v1/poker/sessions/:id/join | /leave
POST       /v1/poker/sessions/:id/close                 finalize + apply estimates to WorkItems
GET/POST   /v1/poker/sessions/:id/stories
PATCH/DELETE /v1/poker/sessions/:id/stories/:storyId
POST       /v1/poker/sessions/:id/stories/:storyId/votes
POST       /v1/poker/sessions/:id/stories/:storyId/reveal
GET        /v1/poker/sessions/:id/stories/:storyId/voting-history
GET        /v1/poker/sessions/:id/analytics             avg estimate, convergence, velocity
GET/POST/PATCH/DELETE /v1/poker/card-decks
GET        /v1/poker/metrics                            session count, velocity
POST       /v1/poker/estimate-assist                    → agile.estimate.assist (suggest from history)
```

**Acceptance**
- Votes are server-hidden until `reveal`; no client can read peers' values pre-reveal.
- Built-in decks: Fibonacci (default), T-Shirt, Powers of 2, Linear 1–10; custom via `CardDeck`.
- Session room enforces Segment membership on connect; no cross-Segment join even with a link.
- `close` writes `finalEstimate` and (if a story maps to a WorkItem) sets `effort`/`estimatedHours`.
- **[NEW]** `estimate-assist` proposes a point value from `TeamVelocity` + similar past stories.

---

## AS-2 — Team Retrospectives

**What it is.** Structured retro templates, anonymous or attributed, with AI-summarized action
items that flow into the backlog.

**Entities:** `Retrospective`, `RetrospectiveParticipant`, `RetrospectiveItem`, `ActionItem`.
Templates: MAD_SAD_GLAD, FOUR_LS, START_STOP_CONTINUE, WHAT_WENT_WELL, CUSTOM (plus Sailboat as a
custom layout).

**User stories**
- As a facilitator, I create a retro with a template and phases (brainstorm → vote → discuss →
  actions).
- As a participant, I add items to categories, vote on items, group related items.
- As a facilitator, I generate AI-summarized action items from the items and discussion.
- As a team, action items are tracked and **auto-convertible to backlog WorkItems**.

**Flow**
1. Create `Retrospective`; participants join (realtime, same room pattern as poker).
2. Items added per category; votes increment `RetrospectiveItem.votes`.
3. `agile.retro.summarize` → drafts `ActionItem`s (`sourceType = RETROSPECTIVE`,
   `retrospectiveId` set).
4. **[NEW — build this]** "Convert to backlog" on an action item creates a `WorkItem`
   (`stage = STRATEGIC_BACKLOG`, `origin = MANUAL`) and sets the action item's
   `linkedEntityType = WORK_ITEM`, `linkedEntityId`. (BurnRateOS only had the columns; the
   auto-conversion was never wired — wire it here.)

**API**
```
GET/POST   /v1/retros/sessions
GET/PATCH/DELETE /v1/retros/sessions/:id
POST       /v1/retros/sessions/:id/join | /leave
GET/POST   /v1/retros/sessions/:id/items
PATCH/DELETE /v1/retros/sessions/:id/items/:itemId
POST       /v1/retros/sessions/:id/items/:itemId/votes
POST       /v1/retros/sessions/:id/groups               grouping
POST       /v1/retros/sessions/:id/advance-phase | /set-phase
POST/GET   /v1/retros/sessions/:id/action-items          → agile.retro.summarize
PATCH/DELETE /v1/retros/action-items/:id
POST       /v1/retros/action-items/:id/convert-to-backlog   [NEW] → WorkItem
GET/POST/PATCH/DELETE /v1/retros/templates
GET        /v1/retros/sessions/:id/analytics | /export
GET        /v1/retros/insights                          trends
```

**Acceptance**
- Anonymous mode hides `authorId` in responses (still stored for audit) per session setting.
- `convert-to-backlog` is idempotent (re-converting links to the existing WorkItem).
- Action items appear in the cross-source Action Items dashboard regardless of origin.

---

## AS-3 — Agile Kanban Boards

**What it is.** Visual workflow with startup metrics; the Agile-side view of `WorkItem`
(`stage = KANBAN_BOARD`).

**Entities:** `KanbanBoard`, `KanbanColumn`, `WorkItem`, `Delivery`, `ItemActivity`.

**User stories**
- As a team, I create boards (Kanban or Scrum), columns with WIP limits, and cards.
- As a team, I drag cards across columns; cycle/lead time is tracked.
- As a team, cards show business value, task cost, and runway-impact badges.
- As a team, I link a board to an MVP scenario for budget-to-actuals variance.
- As a team, I see flow metrics (throughput, cycle time, lead time, WIP) and burndown.
- As a team, I archive completed items.

**API**
```
GET/POST   /v1/kanban/boards            GET /v1/kanban/boards/team/:teamId
GET/PATCH/DELETE /v1/kanban/boards/:id
PUT        /v1/kanban/boards/:id/link-mvp | /unlink-mvp
GET        /v1/kanban/boards/:id/mvp-variance
POST       /v1/kanban/columns   PATCH/DELETE /v1/kanban/columns/:id
PATCH      /v1/kanban/boards/:id/columns/reorder
GET/POST   /v1/kanban/items             (stage=KANBAN_BOARD)
GET/PATCH/DELETE /v1/kanban/items/:id
PATCH      /v1/kanban/items/:id/move    { columnId, position }
GET        /v1/kanban/items/:id/activity
GET/POST   /v1/kanban/backlog/:teamId   POST /v1/kanban/backlog/:itemId/move-to-board
POST/PUT   /v1/kanban/deliveries
GET        /v1/kanban/metrics/flow/:teamId | /velocity/:teamId | /burndown/:sprintId
GET        /v1/kanban/dashboard
POST       /v1/kanban/archive-completed   GET /v1/kanban/archived
```

**Acceptance**
- WIP limits enforced per column (move blocked / warned when exceeded, per board setting).
- Moving to a "done" status sets `workCompletedAt` and computes `cycleTime`/`leadTime`.
- Card value/cost/runway badges read `BusinessValueConfig`, `TaskEffortEstimate`, and the
  runway link (AS-7) — same numbers as the backlog and roadmap.
- **[NEW]** Each card exposes an "Assign to dev agent" action (doc 04) that opens an `AgentRun`.

---

## AS-4 — Sprint Forecasting

**What it is.** Sprint planning with velocity history + runway-aware capacity caps.

**Entities:** `Sprint`, `SprintForecast`, `TeamVelocity`, `CapacityPlanning`,
`SprintFinancialImpact`.

**User stories**
- As a lead, I create a sprint (goal, dates, capacity in points) and add items.
- As a lead, I get a forecasted completion with a confidence interval and risk factors.
- As a lead, capacity caps reflect runway: the system warns if the sprint's projected burn
  exceeds the runway budget.
- As a lead, I see commitment vs. delivered and the sprint's financial impact.

**API**
```
GET/POST   /v1/sprints           PATCH /v1/sprints/:id
GET        /v1/teams/:teamId/sprints | /sprints/active
POST/DELETE /v1/sprints/:sprintId/items/:itemId
GET        /v1/sprints/:id/forecast            → agile.forecast (narrative over computed forecast)
GET        /v1/sprints/:id/financial-impact
POST       /v1/sprints/:id/calculate-financial-impact
GET        /v1/sprint-planning/:id/capacity
```

**Acceptance**
- Forecast = computed (velocity-based) + AI narrative; the date math is deterministic.
- Runway-aware scoping uses the real burn rate from the BI seam where available.
- Financial impact persists per sprint (`SprintFinancialImpact`, unique per sprint).

---

## AS-5 — Velocity Tracking

**What it is.** Rolling velocity with burndown and commitment-vs-delivered analytics.

**Entities:** `TeamVelocity`, `VelocityHistory`.

**User stories**
- As a lead, I see rolling sprint velocity, trend (UP/DOWN/STABLE), and per-team breakdown.
- As a lead, velocity history feeds forecasting and poker estimate-assist.

**API**
```
GET   /v1/velocity/teams/:teamId            rolling + history + trend
POST  /v1/velocity/teams/:teamId/record      append a velocity point (on sprint close)
GET   /v1/velocity/teams/:teamId/burndown
```

**Acceptance**
- A completed sprint automatically records a `TeamVelocity` row and a `VelocityHistory` point.
- Rolling average window is configurable; trend derived, not stored stale.

---

## AS-6 — Feature Scoring & Capacity (RICE)

**What it is.** RICE-style feature scoring overlaid with team capacity, so prioritization
respects the engineering hours actually available.

**Entities:** reads `WorkItem` + `TeamCapacity`/`CapacityPlanning`; scoring via `pm.feature_score`.
Source criteria weights (from BurnRateOS): Market Fit 0.30, Survival Impact 0.25, ROI 0.25,
Strategic Alignment 0.20 → `overallScore` → recommendation BUILD/CONSIDER/DEFER/SKIP.

**User stories**
- As a lead, I score features (reach, impact, confidence, effort + survival/ROI dimensions) and
  get a BUILD/CONSIDER/DEFER/SKIP recommendation.
- As a lead, I overlay team capacity to see what's actually shippable this quarter.
- As a lead, I see bottlenecks and a capacity heatmap.

**API**
```
GET   /v1/feature-scoring/criteria
GET   /v1/feature-scoring/:featureId
POST  /v1/feature-scoring/calculate/:featureId      → pm.feature_score
GET   /v1/capacity/teams/:teamId                     overview + utilization
POST  /v1/capacity/teams/:teamId                     add member capacity
GET   /v1/capacity/teams/:teamId/bottlenecks
POST  /v1/capacity/teams/:teamId/risk-assessment
GET   /v1/capacity/teams/:teamId/heatmap
```

**Acceptance**
- Scoring is explainable (per-dimension breakdown returned with the overall).
- Capacity overlay uses `TeamCapacity.availableHours/allocatedHours`; utilization computed.

---

## AS-7 — Cost & Runway Integration (the cost-aware engine)

**What it is.** The financial spine that makes Agile "survival-focused": every task, sprint, and
card carries a real dollar/runway cost — linked to the company's actual burn rate.

**Entities:** `TaskEffortEstimate`, `CostCalculation`, `SprintFinancialImpact`,
`RunwayForecastLink`.

**User stories**
- As a lead, I estimate a task's cost (hours × rate + overhead) → `TaskEffortEstimate`.
- As a lead, I compute sprint cost (labor/overhead/tooling/infra) and runway days consumed.
- As a lead, cost-per-point is computed from the **real monthly burn** (BI seam), not a guess.
- As a lead, a task/sprint can be linked to the runway forecast so finishing it moves the
  runway number.

**Flow & the seam (closes the marketing gap)**
1. `costPerPoint` previously = `(monthlyCost/4 × sprintWeeks) / storyPoints` with `monthlyCost`
   hand-entered. **Now:** fetch the Segment's current monthly burn from BurnRateOS BI
   (`GET /api/bi/burn-rate` for the Segment — doc 05 §4.1). Cache it on `RunwayForecastLink
   .externalBurnRateMetricRef`. Fall back to manual input if the seam is unavailable or the host
   hasn't granted the scope.
2. Sprint financial impact and runway-days-consumed are computed against that real burn.

**API**
```
GET   /v1/agile/cost-estimates
POST  /v1/agile/tasks/:workItemId/calculate-cost
GET   /v1/agile/tasks/:workItemId/cost-breakdown
PUT   /v1/agile/tasks/:taskId/runway-link
GET   /v1/agile/sprints/:sprintId/financial-impact
POST  /v1/agile/sprints/:sprintId/calculate-financial-impact
```

**Acceptance**
- When the BI seam is authorized, cost-per-point reflects real burn; the UI shows the source
  ("live burn" vs. "manual estimate").
- No synchronous hard dependency on BurnRateOS in the render path — burn is fetched async and
  cached; staleness is surfaced, not fatal.

---

## Action Items dashboard (cross-source)

`ActionItem` rows from retros, meetings, syncs, milestones, **and agents** in one Segment-scoped
dashboard.
```
GET/POST   /v1/action-items          GET /v1/action-items/stats
PATCH/DELETE /v1/action-items/:id
```

## Pillar-level acceptance

- Parity with BurnRateOS Agile pages: poker (list/session/dashboard/join), retros
  (dashboard/session/join), kanban (board/dashboard/backlog), sprint planning, velocity,
  feature scoring, capacity, cost calculation, project detail tabs (list/calendar/gantt/MVP
  comparison), agile hub, action items.
- Realtime poker + retro rooms enforce Segment isolation.
- The cost-aware promise is real (AS-7 seam), with graceful manual fallback.
- Every board card and backlog item can spawn an `AgentRun` (doc 04).
