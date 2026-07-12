> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #300
> _Each agent that updates this PRD signs its change below._

# PRD: Team Health Dashboard — Workload, Blockers, Aging WIP & Agent Utilization

## Problem & Goal

Engineering teams operating with multiple contributors (human or AI agents) lack a unified, real-time view of how work is distributed, where flow is stalling, and which contributors are over- or under-utilized. This results in hidden bottlenecks, invisible blockers, and unbalanced workloads that slow delivery and increase risk.

**Goal:** Deliver a Team Health dashboard that surfaces workload distribution, active blockers, aging WIP items, and agent/contributor utilization in a single, actionable view — enabling team leads and project managers to intervene early and keep delivery flow healthy.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Engineering Lead / Tech Lead** | Spot overloaded contributors and unresolved blockers before they cascade |
| **Project / Delivery Manager** | Enforce WIP limits, track aging items, report team health to stakeholders |
| **Scrum Master / Agile Coach** | Facilitate data-driven standups and retrospectives |
| **AI Agent Orchestrator** | Monitor AI agent task queues, idle agents, and failure states |
| **Individual Contributor (human or agent)** | See own queue, flag blockers, understand priority |

---

## Scope

This PRD covers the **Team Health** module within the broader project management/orchestration platform. It is scoped to:

- A single team or squad (cross-team rollup is out of scope for v1)
- Work items tracked within the platform's existing task/ticket system
- Both human contributors and AI agents as assignable entities
- Dashboard, alerting, and data-export surfaces

---

## Functional Requirements

### FR-1 · Workload Distribution

- **FR-1.1** Display a per-contributor breakdown of active task count, story points (or relative units), and task types (feature, bug, review, etc.) for the current sprint/cycle.
- **FR-1.2** Render a visual capacity bar per contributor showing assigned load vs. configured capacity (hours or points).
- **FR-1.3** Highlight contributors whose load exceeds configurable thresholds (default: >120% capacity = warning; >150% = critical).
- **FR-1.4** Support filtering by team, sprint, label, and task type.

### FR-2 · Blocker Tracking

- **FR-2.1** Aggregate all tasks flagged as "blocked" (via status, label, or explicit blocker link) into a dedicated Blockers panel.
- **FR-2.2** Display blocker age (time since blocked status set), blocking dependency (what/who is blocking), and owning contributor.
- **FR-2.3** Allow a team lead to assign a blocker owner or escalate directly from the panel.
- **FR-2.4** Send configurable alerts (in-app notification + webhook) when a blocker remains unresolved beyond a threshold (default: 24 h for P0/P1, 72 h for P2).
- **FR-2.5** Link each blocker to the originating task and any dependency tasks.

### FR-3 · Aging WIP

- **FR-3.1** Define "aging WIP" as any in-progress task that has not had a status transition or meaningful activity update within a configurable window (default: 3 days for tasks, 7 days for epics).
- **FR-3.2** Display an Aging WIP list sorted by staleness (oldest first), showing task ID, title, assignee, current status, and days since last activity.
- **FR-3.3** Color-code aging severity: yellow (1× threshold), orange (2×), red (3×+).
- **FR-3.4** Allow leads to mark an item as "intentionally paused" with a required note, suppressing it from the aging list for a configurable snooze period.
- **FR-3.5** Export aging WIP list to CSV and generate a shareable permalink snapshot.

### FR-4 · Agent Utilization

- **FR-4.1** Treat AI agents as first-class contributors with their own utilization metrics: tasks assigned, tasks in execution, tasks completed (current cycle), average task duration, and idle time.
- **FR-4.2** Display a real-time agent status per agent instance: `idle`, `running`, `waiting_on_human`, `blocked`, `error`.
- **FR-4.3** Show queue depth per agent (tasks assigned but not yet started).
- **FR-4.4** Alert when an agent has been in `idle` state with non-empty queue for more than a configurable period (default: 15 min) — indicating a scheduling or orchestration failure.
- **FR-4.5** Alert when an agent enters `error` state; surface the error summary inline without requiring navigation away from the dashboard.
- **FR-4.6** Provide a time-series utilization chart (last 7 days, last 30 days) showing active vs. idle time per agent.

### FR-5 · Dashboard & Navigation

- **FR-5.1** Present all four health dimensions (Workload, Blockers, Aging WIP, Agent Utilization) on a single scrollable dashboard with collapsible sections.
- **FR-5.2** Provide a top-level Team Health Score (0–100) computed from a weighted formula: blocker count, % over-capacity contributors, aging WIP count, agent error rate. Weights must be configurable.
- **FR-5.3** Auto-refresh dashboard data every 60 seconds; support manual refresh. Display last-updated timestamp.
- **FR-5.4** Support dark and light mode; meet WCAG 2.1 AA contrast requirements.
- **FR-5.5** Dashboard must be fully usable on a 1280×800 viewport (desktop minimum); tablet layout (768px) is a stretch goal.

### FR-6 · Notifications & Alerts

- **FR-6.1** All alert thresholds (blocker age, overload %, aging WIP window, agent idle time) must be configurable per team by a team admin.
- **FR-6.2** Alerts delivered via: in-app notification feed, email digest (configurable frequency), and outbound webhook (Slack/Teams-compatible payload).
- **FR-6.3** Alert deduplication: do not re-fire the same alert for the same item within a 1-hour window unless the severity level increases.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a sprint with ≥1 contributor assigned tasks, the Workload panel renders accurate task counts and capacity bars within 5 seconds of page load. |
| AC-2 | A task flagged as "blocked" appears in the Blockers panel within 60 seconds of the status change, without a manual refresh. |
| AC-3 | A task that has had no status transition for 3 days (default) appears in the Aging WIP list with the correct staleness color code. |
| AC-4 | An AI agent in `error` state displays the error summary on the dashboard within 60 seconds of the error event. |
| AC-5 | Team Health Score updates when any underlying metric changes and is recomputed on each dashboard refresh cycle. |
| AC-6 | A team admin can modify any alert threshold, save it, and the new threshold takes effect on the next evaluation cycle without requiring a deployment. |
| AC-7 | Aging WIP CSV export contains all required fields (task ID, title, assignee, status, days-since-activity) and downloads without error for lists up to 500 items. |
| AC-8 | All alerts respect the 1-hour deduplication window; no duplicate notifications fire for the same item at the same severity within that window. |
| AC-9 | Dashboard renders without layout breakage at 1280×800 in both light and dark mode, passing automated WCAG 2.1 AA contrast checks. |
| AC-10 | An intentionally-paused WIP item does not reappear in the aging list until the snooze period expires. |

---

## Out of Scope

- **Cross-team or portfolio-level rollup** — multi-team aggregation is deferred to v2.
- **Predictive / ML-based health scoring** — v1 uses deterministic weighted formula only.
- **Time-tracking integrations** (Toggl, Harvest, etc.) — capacity is defined by configured values, not logged hours.
- **Sprint planning or task creation** — this module is read/alert only; no task editing beyond blocker escalation assignment.
- **Mobile (< 768px) responsive layout** — desktop-first for v1.
- **Historical trend comparison across sprints** — only current cycle + 7/30-day agent charts are in scope.
- **SLA enforcement or billing impact reporting** — out of scope for this module.
- **Role-based access control (RBAC) changes** — existing platform permissions govern who can view/configure; no new permission model is introduced.