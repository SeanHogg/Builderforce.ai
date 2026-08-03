# Product Requirements Document: Cross-Project Health Dashboard

> **PRD** — drafted by Ada (Sr. Product Mgr) · task #146
> _Each agent that updates this PRD signs its change below._

## Problem & Goal

**Problem:** Leadership has no single, at-a-glance view of health across all projects in the portfolio. Status signals — completion, blockers, risk, and recommended next actions — are scattered across different tools or missing entirely. This slows decision‑making and causes risks to go unnoticed until they escalate.

**Goal:** Deliver a cross‑project health dashboard that consolidates the status of all 5 portfolio projects into one scannable view. Each project gets a one‑page health card with Red/Amber/Green status, completion metrics, key blockers, risk level, and a concrete recommended next action. An above‑the‑fold portfolio snapshot summarises overall health and surfaces the top‑3 priority actions.

## Target Users / ICP Roles

- **Engineering Leads / VPs** — portfolio pulse for executive reviews.
- **Program Managers / TPMs** — triaging risk, identifying stuck projects, preparing status reports.
- **Product Owners** — understanding cross‑team dependencies and flagging blockages.
- **Delivery Managers / Scrum Masters** — tracking project momentum and blockers.

## Scope

### In Scope

- A committed, version‑controlled Markdown artifact (`CROSS-PROJECT-HEALTH-DASHBOARD.md`) at the repository root, generated from the latest board data.
- Five per‑project health cards, each containing: project name, status, completion %, RAG indicator with rationale, task summary, key blocker, risk level, and recommended next action.
- An above‑the‑fold Portfolio Snapshot: total projects, RAG colour‑coded counts, overall portfolio health status, and top‑3 priority actions.
- A documented RAG rules table defining the trigger conditions for Red, Amber, and Green.
- A timestamp on every generated report so freshness is verifiable.
- The dashboard component (`CrossProjectHealthDashboard.tsx`) and its data source (`portfolioHealthData.tsx`) that produce the artifact.

### Out of Scope

- Real‑time streaming or websocket‑based updates; the artifact is a point‑in‑time snapshot.
- Interactive filtering, drill‑down, or customisation of cards (V1 is read‑only and fixed‑layout).
- Backend API or database schema changes.
- Modifying underlying project management tools or workflows.
- Alerting, notification, or escalation triggers (future iteration).
- Historical trend lines or time‑series views.

---

## Functional Requirements

### FR‑1: One‑Page Health Card Per Project

Each project MUST render a health card with the following elements:

| Element | Description |
|---------|-------------|
| **Project Name** | Unique project identifier (e.g. "BuilderForce.AI") |
| **Overall Status** | Human‑readable label: On Track, At Risk, Blocked, or On Hold — derived from RAG + completion context |
| **Completion %** | Numeric 0–100 shown as a horizontal progress bar with percentage label |
| **RAG Indicator** | Traffic‑light icon (🔴 Red / 🟡 Amber / 🟢 Green) with a short text rationale (≤140 chars) explaining why the colour was assigned |
| **Task Summary** | Concise summary, e.g. "13 of 19 tasks done (68%)" or "No tasks created" |
| **Key Blocker** | Single most critical blocker, if any; otherwise "None" |
| **Risk Level** | Enum: High / Medium / Low with a one‑line rationale |
| **Recommended Next Action** | Clear, actionable step the responsible person should take |

### FR‑2: Completion % Progress Bar

- Calculated as: `(completed tasks) / (total tasks) × 100`
- Displayed as a segmented bar, colour‑coded:
  - &lt; 30% → red
  - 30–70% → amber
  - &gt; 70% → green
- If total tasks = 0, bar is empty and shows "0%" or "N/A".

### FR‑3: RAG Indicator Logic & Rationale

| Colour | Trigger Conditions (any one true) |
|--------|----------------------------------|
| 🔴 **Red** | Build broken (latest CI failed); 0% progress with tasks defined; empty project (no tasks); stalled backlog (&gt;10 tasks stuck for &gt;X days); on‑hold status |
| 🟡 **Amber** | Completion 30–70% without passing all acceptance tests; some failing tests but build passing; at risk due to incomplete localisation/blockers |
| 🟢 **Green** | &gt;70% completion and all critical checks passing |

- Rationale text is auto‑generated from the dominant condition, e.g. "Build broken (CI failure)", "40 backlog items stalled", "3 failing tests".

### FR‑4: Portfolio Snapshot (Above the Fold)

The dashboard MUST include a snapshot section at the top containing:

- **Total project count:** 5
- **Status breakdown** with labelled counts: 🟢 Green: N, 🟡 Amber: N, 🔴 Red: N
- **Overall portfolio health indicator:** derived from the worst project status (e.g. "RED" if any project is Red)
- **Priority Actions** (ordered list, top‑3):
  1. Fix Hired.Video build
  2. Kickoff RumbleDating
  3. Define or archive pattysnob.com

### FR‑5: Data Freshness & Timestamp

- Every generated report MUST carry a generation timestamp in the header (ISO 8601 or human‑readable UTC).
- Data sources are project boards; the snapshot reflects board state at generation time.
- The report is regenerated whenever underlying project data changes.

### FR‑6: Detailed Analysis of 5 Projects

The dashboard MUST analyse and surface status for all five portfolio projects:

| Project | Status | Completion | Key Concern |
|---------|--------|-----------|-------------|
| **BuilderForce.AI** | Active | ~68% (13/19 done) | 3 failing tests, blocked/stuck items |
| **Hired.Video** | Active | ~11% | Build broken, French localisation gaps |
| **RumbleDating** | Active | 0% (0/40 started) | Stalled — all 40 tasks in backlog |
| **BurnRateOS** | On Hold | 0% (0/9 started) | Deprioritised; needs re‑engagement date |
| **pattysnob.com** | Active | N/A (0 tasks) | Empty project shell — no scope or tasks |

For each project the card must surface: status, completion %, risk level, key blocker, and recommended next action.

---

## Acceptance Criteria

| ID | Criterion |
|----|-----------|
| **AC‑1** | One health card rendered per project — all 5 cards present. |
| **AC‑2** | Each card shows a Red / Amber / Green status indicator matching the RAG rules in FR‑3. |
| **AC‑3** | Completion % is visible on every card, including 0% and N/A cases. |
| **AC‑4** | Every card names one primary key blocker (or "None" when none exists). |
| **AC‑5** | Every card includes one concrete, time‑bound recommended next action. |
| **AC‑6** | Portfolio Snapshot section renders above the fold with total count, RAG breakdown, overall health, and top‑3 actions. |
| **AC‑7** | Top‑3 portfolio actions are listed exactly as: (1) Fix Hired.Video build, (2) Kickoff RumbleDating, (3) Define or archive pattysnob.com. |
| **AC‑8** | Every generated report carries a generation timestamp. |
| **AC‑9** | RAG colours are applied consistently across all cards and match the documented trigger rules. |
| **AC‑10** | The artifact is scannable in ≤30 seconds — one glance per project. |

---

## RAG Status Rules (Applied)

| Colour | Conditions | Projects in This Colour |
|--------|-----------|--------------------------|
| 🟢 Green | &gt;70% completion, no blockers, all checks passing | _(none — all projects have blockers or are stalled)_ |
| 🟡 Amber | Active with known blockers (failing tests, on‑hold with defined re‑engagement) | BuilderForce.AI, BurnRateOS |
| 🔴 Red | Build broken, 0% complete with active status, no tasks defined | Hired.Video, RumbleDating, pattysnob.com |

---

## Assumptions & Constraints

- The dashboard reflects a **point‑in‑time snapshot** generated from current board state; it is not a live dashboard.
- Project completion % is derived from `(done tasks) / (total tasks)` on each project board. Numbers may differ from sub‑portfolio metrics that weigh story points differently.
- The "On Hold" status (BurnRateOS) is treated as Amber under FR‑3 when the hold is intentional and documented; it is Red when no re‑engagement date exists.
- The top‑3 priority actions are derived from the most critical blockers across the portfolio and are reviewed with each regeneration.

---

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
