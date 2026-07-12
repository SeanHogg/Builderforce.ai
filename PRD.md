> **PRD** — drafted by Ada (Sr. Product Mgr) · task #238
> _Each agent that updates this PRD signs its change below._

# PRD: Scenario Modeling for Team & Scope Planning

## Problem & Goal

Engineering managers, product leads, and delivery teams routinely need to answer "what if" questions during sprint planning, roadmap reviews, and resource negotiations — yet today these analyses happen ad hoc in spreadsheets, are not reproducible, and are disconnected from actual project data. The result is slow decision-making, inconsistent estimates, and missed commitments.

**Goal:** Provide an interactive scenario modeling tool that lets users instantly project the impact of resource changes (adding/removing agents/team members) and scope changes (cutting or expanding work) against a baseline plan, surfacing revised timelines, velocity projections, and risk indicators in real time.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Justify headcount asks; replan after attrition |
| Product Manager | Trade-off scope vs. deadline in roadmap reviews |
| Delivery Lead / Scrum Master | Sprint replanning after unplanned absence or scope change |
| Program Manager | Cross-team dependency impact of resource shifts |
| Executive Sponsor | High-level "what does it cost to go faster?" answer |

---

## Scope

### In This Release (v1)

- Scenario modeling against a **single active project or sprint backlog**
- Two core scenario types:
  - **Agent/resource delta** — add or remove N agents (whole numbers, 1–10)
  - **Scope delta** — increase or decrease remaining work by a percentage (1–100 %)
- Baseline auto-derived from current plan (capacity, velocity, remaining story points / tasks)
- Side-by-side comparison of baseline vs. up to **3 simultaneous scenarios**
- Exportable summary (PDF and CSV)

---

## Functional Requirements

### FR-1 Baseline Ingestion
- FR-1.1 System reads current sprint/project data (team size, average velocity, remaining story points, start date, target end date) from the connected project data source.
- FR-1.2 Baseline is recalculated automatically when the underlying project data changes.
- FR-1.3 User can manually override any baseline parameter before creating scenarios.

### FR-2 Resource Scenario ("What if we add/remove N agents?")
- FR-2.1 User specifies a signed integer delta (e.g., +2, −1) representing agent count change.
- FR-2.2 System applies a configurable productivity ramp curve for new agents (default: 0 % week 1, 50 % week 2, 100 % week 3+).
- FR-2.3 Projected completion date and revised velocity are recalculated immediately (< 2 s).
- FR-2.4 System surfaces warnings when adding agents is projected to yield < 5 % schedule improvement (Brooks's Law threshold indicator).

### FR-3 Scope Scenario ("What if we cut/expand scope by X%?")
- FR-3.1 User specifies a signed percentage delta applied to remaining story points/tasks.
- FR-3.2 System optionally suggests which backlog items to defer to reach the target cut, ranked by priority descending (requires backlog integration).
- FR-3.3 Projected completion date and new scope total are recalculated immediately (< 2 s).
- FR-3.4 If scope expands, system flags whether current capacity can absorb the work within the target date.

### FR-4 Combined Scenarios
- FR-4.1 User may combine a resource delta and a scope delta in a single scenario.
- FR-4.2 System calculates the combined effect without double-counting.

### FR-5 Scenario Comparison View
- FR-5.1 Baseline and all active scenarios are displayed in a comparison table showing: projected end date, total story points, team size, estimated velocity, and schedule variance (days).
- FR-5.2 A Gantt-style timeline visualization overlays all scenarios on a shared time axis.
- FR-5.3 User can name, save, and reload scenarios within a project context.
- FR-5.4 User can delete any non-baseline scenario.

### FR-6 Export
- FR-6.1 Export comparison table and timeline chart to PDF (print-ready, letter/A4).
- FR-6.2 Export raw scenario data to CSV (one row per scenario, all computed fields included).

### FR-7 Audit & History
- FR-7.1 All saved scenarios are timestamped and attributed to the creating user.
- FR-7.2 Scenario history is retained for 90 days.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a connected project, the baseline loads within 3 seconds and displays correct team size, velocity, and projected end date matching the source system. |
| AC-2 | Adding 2 agents to a 4-person team recalculates the projected end date in ≤ 2 seconds, accounting for the default ramp curve. |
| AC-3 | Cutting scope by 20 % produces a projected completion date earlier than or equal to the baseline date, and the new story-point total equals original remaining points × 0.80 (± 1 point rounding). |
| AC-4 | Up to 3 scenarios plus baseline are visible simultaneously in the comparison table without horizontal scrolling on a 1280 px viewport. |
| AC-5 | A combined scenario (e.g., +2 agents AND −20 % scope) produces a result consistent with applying both deltas; neither delta is applied twice. |
| AC-6 | Brooks's Law warning is displayed when projected schedule improvement from adding agents is < 5 %. |
| AC-7 | Exported PDF renders the comparison table and timeline chart legibly; exported CSV contains all scenario rows with correct computed values. |
| AC-8 | Saved scenarios persist across browser sessions and are visible to all project members with read access. |
| AC-9 | Scenario history older than 90 days is purged automatically; no manual deletion is required to enforce the limit. |

---

## Out of Scope

- **Multi-project / portfolio-level scenario modeling** — single project only in v1
- **Financial / cost modeling** — fully-loaded headcount cost projections are not included
- **Automatic backlog re-ordering** — the tool may *suggest* deferral candidates but will not modify the backlog in the source system
- **Fractional agents** — partial FTE modeling (e.g., 0.5 agent) is deferred to v2
- **Monte Carlo or probabilistic simulation** — deterministic projection only in v1; confidence intervals deferred
- **Mobile-optimized layout** — desktop-first; responsive design deferred to v2
- **Real-time collaborative editing** — concurrent multi-user live editing of the same scenario is not supported; last-write-wins on save
- **Integration with more than one project data source simultaneously** — single source per scenario session in v1