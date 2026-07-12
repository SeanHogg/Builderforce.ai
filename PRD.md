> **PRD** — drafted by Ada (Sr. Product Mgr) · task #213
> _Each agent that updates this PRD signs its change below._

# PRD: Backlog Burn-Rate Estimator

## Problem & Goal

Engineering teams and project managers lack a quick, data-driven answer to the question: **"At our current pace, when will we finish?"** Existing tools (Jira, Linear, GitHub Projects) surface raw backlog counts but do not automatically compute a forward-looking time estimate anchored to measured velocity. This feature closes that gap by calculating estimated agent-hours or human-hours required to clear the remaining backlog, given observed throughput.

**Goal:** Deliver a single, trustworthy estimate — and the reasoning behind it — that any stakeholder can act on immediately.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Manager / Tech Lead** | Forecast sprint or release completion dates; identify if current velocity is sufficient |
| **Project Manager / Scrum Master** | Communicate delivery timelines to stakeholders without manual spreadsheet work |
| **AI Agent Orchestrator** | Programmatically receive a structured estimate to gate downstream planning tasks |
| **Product Owner** | Understand trade-offs between scope cuts and timeline pressure |

---

## Scope

This document covers the **estimation calculation layer** — ingesting backlog and velocity data, computing remaining effort, and surfacing the result. It does not cover the upstream tooling that manages backlog items or the downstream scheduling of work.

---

## Functional Requirements

### FR-1 · Velocity Ingestion
- Accept a velocity figure expressed as **story points, tasks, or hours completed per unit time** (e.g., 12 story points/sprint, 4 tasks/day, 6 agent-hours/hour).
- Support manual entry and structured data input (JSON/CSV).
- Allow velocity to be provided as a **single value** or as a **time-series** (last N sprints / last N days) from which the system computes a rolling average.
- Support separate velocity tracks for **human workers** and **AI agents** when both are active.

### FR-2 · Backlog Ingestion
- Accept a backlog expressed as a **list of items with effort estimates** (story points, hours, or task counts).
- Accept a **pre-aggregated total** (e.g., "142 story points remaining") as an alternative.
- Categorise items by status: `remaining`, `in-progress` (partially counted), `blocked` (optionally excluded or flagged).
- Support import from plain text, JSON, CSV, or GitHub/Linear/Jira webhook payload.

### FR-3 · Estimation Calculation
- Compute **estimated hours to completion** using:

  ```
  Remaining Effort (normalised units)
  ─────────────────────────────────── × Hours per Time Unit = Estimated Hours
        Velocity (units / time unit)
  ```

- Apply a **confidence interval** (pessimistic / expected / optimistic) based on velocity variance when a time-series is provided; default to ±20 % when only a single velocity value is given.
- Distinguish and report **agent-hours** and **human-hours** separately when dual-track data is present.
- Surface a **calendar estimate** (completion date/time) when working-hours-per-day or agent-uptime-per-day is provided.

### FR-4 · Output Report
- Return a structured result containing:
  - Remaining backlog size (normalised)
  - Observed / computed velocity (with source period)
  - **Estimated hours to completion** — pessimistic / expected / optimistic
  - Estimated completion date (if calendar context provided)
  - Key assumptions list
  - Confidence level (Low / Medium / High) based on data quality
- Render as **human-readable markdown summary** and **machine-readable JSON**.

### FR-5 · Sensitivity Analysis
- Show the effect on the estimate if velocity changes by −25 %, −10 %, +10 %, +25 %.
- Highlight the **break-even velocity** needed to hit a user-supplied deadline.

### FR-6 · Blocking & Risk Flags
- Flag backlog items marked `blocked` and report how many hours of work are at risk.
- Warn when velocity data covers fewer than 3 time periods (low confidence).
- Warn when in-progress items represent more than 30 % of remaining effort (WIP risk).

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a single velocity value and a pre-aggregated backlog total, the system returns an expected-hours estimate within 2 seconds. |
| AC-2 | Given a velocity time-series of ≥ 3 periods, the system computes pessimistic / expected / optimistic bounds and labels confidence **Medium** or **High**. |
| AC-3 | When agent and human velocities are supplied separately, the output report contains distinct agent-hours and human-hours figures that sum to total estimated hours. |
| AC-4 | When a target deadline is provided, the system outputs the required velocity needed to meet it and flags whether current velocity is sufficient. |
| AC-5 | The JSON output validates against the published schema with no missing required fields. |
| AC-6 | When fewer than 3 velocity periods are available, the output carries a **Low** confidence label and displays an explicit assumption warning. |
| AC-7 | Blocked items are excluded from the default estimate and reported in a separate `blocked_hours_at_risk` field. |
| AC-8 | The sensitivity table reflects accurate re-calculations for all four velocity-change scenarios (±10 %, ±25 %). |

---

## Out of Scope

- **Backlog prioritisation or re-ordering** — the estimator treats the backlog as-is.
- **Sprint planning or task assignment** — no scheduling of who does what.
- **Real-time integration / live sync** with Jira, Linear, or GitHub (webhook ingestion is supported, but continuous polling is not).
- **Capacity planning** (vacation, holidays, headcount changes) — callers must pre-adjust velocity before input.
- **Cost estimation** (dollar amounts, billing rates) — hours only.
- **Historical trend forecasting beyond the supplied dataset** — no ML model training.
- **UI/dashboard** — this PRD covers the calculation engine and its output contract; any front-end is a separate workstream.