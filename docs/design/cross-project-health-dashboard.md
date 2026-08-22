# Cross-Project Health Dashboard

**Where it lives:** Projects → Portfolio → **Health** (`/projects?tab=portfolio`), behind the
`insights.portfolio` capability gate the Portfolio tab already carries.

**Status:** live. It was written in July 2026 at
`Builderforce.ai/Builderforce.ai/frontend/src/dashboard/cross-project-health/` — a nested duplicate
of the repo folder name, outside `tsconfig`'s include and outside every import graph — with five
projects' status hand-written into a `projects[]` array. Moving it under `frontend/src` on
2026-08-22 meant re-sourcing every number from live data; the original snapshot module was deleted
rather than relocated.

---

## The question it answers

One question per project, answered the same way for all of them:

1. Is this thing moving?
2. What is the single biggest thing stopping it?
3. What is the one next action?

Plus the portfolio-level read leadership scans before the fold: how many projects sit in each RAG
band, what the portfolio's overall band is, and the top three actions across all of it.

## Where the numbers come from

Nothing here is a snapshot somebody edits each sprint. Every field is derived from the live
`/api/projects` list, which already attaches per-project task counts (`taskCount`,
`completedTaskCount`, `openTaskCount`, `blockedTaskCount`, `overdueTaskCount`) and the compact
`deliverySignals` bundle (30-day DORA + cycle time + flow).

| Layer | Module | Owns |
|---|---|---|
| Delivery verdict | `lib/deliveryVerdict.ts` | DORA + cycle time + flow → 0–100 score + verdict |
| Per-project health | `lib/projectHealth.ts` | that score + progress, for ONE project |
| Portfolio health | `lib/pm/portfolioHealth.ts` | RAG banding, blocker/action pair, summary |
| Card | `components/pm/PortfolioHealthCard.tsx` | one project's card (presentational) |
| Surface | `components/pm/PortfolioHealthContent.tsx` | the read, the states, the layout |

The health score and progress come from `computeProjectHealth` — the SAME function the project card,
the list row and the details panel call — so a project cannot read "Red" here and "Healthy" on its
own card. `portfolioHealth.ts` adds only the portfolio-level layer on top, and is pure and hook-free
so the banding is unit-tested without a DOM (`lib/pm/portfolioHealth.test.ts`).

## RAG rules

Read off the derived blocker and the shared delivery tier:

| Band | Trigger |
|---|---|
| 🔴 Red | No tasks defined · nothing completed yet · delivery stalled (`verdict: 'no'`) · critical tier |
| 🟡 Amber | On hold · blocked tasks · overdue tasks · at-risk verdict · at-risk tier · not yet past half-way |
| 🟢 Green | Past half-way, no impediment, and delivering |

Overall portfolio health is the worst band present — a portfolio is only as green as its reddest
project.

## The blocker/action pair

`HEALTH_SIGNALS` is one ordered vocabulary of nine keys. Each key names BOTH the blocker sentence
(`pmo.health.blocker.<key>`) and its remedy (`pmo.health.action.<key>`), so an impediment and its
recommended next action can never be paired up wrongly: there is one key, not two lists to keep
aligned. Precedence is deliberate — a deliberate hold outranks everything (it is not a problem), an
unmeasurable project outranks a measurable one, explicit task-level blockage outranks an inferred
delivery verdict, and "delivering fine" is the fall-through.

The module emits i18n KEYS plus interpolation values rather than English strings (the same shape as
`VerdictReason`), so the card owns the words and all five catalogs stay the single source. The
suffixes are enumerated in `i18n/messages.test.ts` — `check:i18n-keys` can only prove the two
prefixes exist.

## Scope

Cross-project by definition, so the Health tab deliberately ignores the portfolio/initiative scope
picker the Rollup tab carries — a health read that hides half the portfolio is not one. Completed and
archived projects are filtered out by `livePortfolioProjects`: they have no health to report and
would only dilute the counts.

## Requirements coverage

| ID | Criterion | How |
|---|---|---|
| FR-1 | One health card per project, with ONE blocker and ONE action | `PortfolioHealthCard`, fed by `buildPortfolioHealthItem` |
| FR-2 | Deeper context available | Card title links to the project's analytics panel |
| FR-3 | RAG status per project, consistently applied | `deriveRag`, unit-tested |
| FR-4 | Portfolio summary — counts, overall band, top 3 actions | `buildPortfolioHealth().summary` |
| FR-5 | Refresh | Live read on mount; re-reads on Brain `projects` data events |
| FR-6 | Scannable — summary before the fold, RAG prominent | Counts → banner → top 3 → grid, worst first |
