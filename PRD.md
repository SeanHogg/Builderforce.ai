> **PRD** — drafted by Ada (Sr. Product Mgr) · task #183
> _Each agent that updates this PRD signs its change below._

# PRD: OKR Critical Gap Identification System

## Problem & Goal

**Problem:** Teams executing against OKRs frequently lack a structured, systematic way to surface the most impactful blockers preventing Key Result progress. Gap identification today is ad hoc, buried in status meetings, or discovered too late to course-correct within the OKR cycle.

**Goal:** Deliver a repeatable process and supporting tooling that automatically identifies and surfaces the **top 3 critical gaps per OKR** that are actively blocking progress — enabling owners and leadership to prioritize interventions before the cycle closes.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **OKR Owner / DRI** | Know exactly what is blocking their Key Results and own resolution |
| **Team Lead / Engineering Manager** | Triage gaps across multiple OKRs owned by their team |
| **Chief of Staff / Strategy Ops** | Portfolio-level visibility into systemic blockers across the org |
| **Executive Sponsor** | Confirm top escalations require their decision or resource unlock |

---

## Scope

### In Scope
- Analysis of all active OKRs within a defined cycle (quarter or custom period)
- Gap detection per Objective, surfacing exactly 3 critical gaps ranked by impact on Key Result attainment
- Gap classification (resource, dependency, clarity, execution, external)
- Confidence scoring indicating likelihood the gap will block the OKR if unresolved
- Owner assignment and due-date tracking per identified gap
- Weekly refresh cadence aligned to check-in rhythm
- Output consumable as a structured report (dashboard view and exportable format)

### Out of Scope
- OKR creation or editing workflows
- Full project management (tasks, sprints, backlogs)
- Gap resolution workflows beyond status tracking
- Historical trend analysis across multiple past cycles (v1)
- Integration with HR or compensation systems

---

## Functional Requirements

### FR-1 — OKR Ingestion
- System must ingest all active Objectives and their associated Key Results from the connected OKR source (API, CSV, or native entry)
- Each KR must carry: current value, target value, owner, due date, and last-updated timestamp
- OKRs marked "on track" by automated scoring below threshold must still be evaluated for latent gaps

### FR-2 — Gap Detection Engine
- For each Objective, the system must analyze progress signals across Key Results and surface no more than **3 critical gaps**, ranked by estimated impact on overall Objective attainment
- Gap detection must consider:
  - Progress velocity vs. time remaining (burn rate delta)
  - Missing owners or unassigned action items on lagging KRs
  - KRs with zero progress updates beyond a configurable staleness window (default: 7 days)
  - Declared dependencies with no confirmed status
  - Qualitative signals from linked check-in notes (keyword/sentiment parsing)
- Gaps below a configurable criticality threshold must be suppressed from the top-3 output but retained in a secondary audit log

### FR-3 — Gap Classification & Scoring
- Each identified gap must be assigned one of five categories: `Resource`, `Dependency`, `Clarity`, `Execution`, `External`
- Each gap must receive a **Confidence Score** (0–100) representing the likelihood the gap blocks KR attainment if unresolved within 14 days
- Scoring must be recalculated on every weekly refresh

### FR-4 — Owner Assignment
- Each gap must have an assigned owner (defaulting to the KR owner if unassigned)
- The system must support manual override of the assigned owner
- Owner must receive a notification (email or in-app) upon gap assignment and on each weekly refresh where the gap remains open

### FR-5 — Reporting Output
- A **Gap Summary Report** must be generated per OKR cycle containing:
  - Objective name and overall health status
  - Top 3 critical gaps per Objective, each showing: description, category, confidence score, owner, and first-detected date
  - Total count of suppressed gaps (not shown in detail)
- Report must be available as:
  - Live dashboard view (filterable by team, owner, category)
  - Exportable PDF and CSV
- Report must refresh automatically on the configured weekly cadence and be accessible on demand

### FR-6 — Escalation Flagging
- Any gap with Confidence Score ≥ 85 must be automatically flagged for executive review
- Escalated gaps must appear in a dedicated "Escalations" section surfaced to Executive Sponsors and Chiefs of Staff
- Escalation flag must be dismissible with a required written rationale

### FR-7 — Audit Log
- All gap detections, score changes, owner assignments, escalation flags, and dismissals must be recorded in an immutable audit log with actor and timestamp

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given an active OKR cycle with ≥ 1 Objective, the system surfaces exactly 3 critical gaps per Objective (or all gaps if fewer than 3 exist) within one processing cycle |
| AC-2 | Each gap includes category, confidence score, owner, and first-detected date before the report is considered complete |
| AC-3 | A gap with no progress update beyond the staleness window is detected and classified within the next scheduled refresh |
| AC-4 | Any gap scoring ≥ 85 confidence appears in the Escalations view visible to Executive Sponsor and Chief of Staff roles within 24 hours of detection |
| AC-5 | Gap Summary Report exports successfully to PDF and CSV with all required fields populated |
| AC-6 | Owner receives notification within 1 hour of gap assignment and on each subsequent weekly refresh while gap remains open |
| AC-7 | All user actions against gaps (assignment, dismissal, override) are recorded in the audit log with actor identity and timestamp |
| AC-8 | Re-running the detection engine on the same OKR data produces the same top-3 output (deterministic ranking) |
| AC-9 | OKRs marked manually as "at risk" by their owner are evaluated first, regardless of automated scoring order |
| AC-10 | Dashboard filters by team, owner, and gap category return correct subsets within 3 seconds on a dataset of 500 OKRs |

---

## Out of Scope

- **OKR authoring** — creating, editing, or approving Objectives and Key Results
- **Resolution workflows** — task creation, sprint planning, or project tracking to close identified gaps
- **Multi-cycle trend analysis** — comparison of gap patterns across historical quarters (deferred to v2)
- **Predictive goal-setting** — recommending OKR targets or stretch goals based on gap data
- **Compensation or performance review integration** — gap data must not feed directly into HR systems
- **Real-time gap detection** — system operates on a weekly scheduled refresh, not continuous event streaming (v1)
- **Third-party OKR platform write-back** — system reads from but does not write back to source OKR tools in v1