> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #316
> _Each agent that updates this PRD signs its change below._

# PRD: Risk Mitigation Action Engine

## Problem & Goal

Project managers and team leads operating in multi-agent or human-in-the-loop execution environments lack timely, specific, and actionable guidance when project risks materialize. Generic alerts ("Task is overdue") are insufficient — stakeholders need concrete remediation steps tied to real project context (assignees, dependencies, budgets, timelines).

**Goal:** Build a Risk Mitigation Action Engine that detects identified risks across active projects and surfaces specific, context-aware remediation actions for each risk instance — enabling faster human decision-making and supporting automated agent handoffs.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Project Manager** | Prioritized risk list with clear actions to direct human team members or agents |
| **Team Lead / Scrum Master** | Task-level mitigations to unblock delivery and rebalance workloads |
| **Orchestrator Agent** | Structured action payloads to autonomously trigger downstream agents |
| **Executive Sponsor** | Budget and timeline risk summaries with escalation recommendations |
| **Resource / Capacity Planner** | Agent/human assignment suggestions when tasks are understaffed or overloaded |

---

## Scope

The engine operates on **existing project data** (tasks, budgets, agents/assignees, dependencies, timelines) already ingested into the platform. It produces **risk records** paired with **ranked mitigation actions**. The first release targets the four most common risk categories:

1. Overdue tasks
2. Budget overrun (actual vs. forecast)
3. Blocked dependencies
4. Unassigned or under-resourced tasks

---

## Functional Requirements

### FR-1: Risk Detection

| ID | Requirement |
|---|---|
| FR-1.1 | The system SHALL continuously (or on-demand) scan all active project tasks, budgets, and resource assignments to identify risk conditions. |
| FR-1.2 | A risk record SHALL be created for each discrete risk instance, capturing: risk type, severity (Critical / High / Medium / Low), affected entity (task ID, budget line, agent ID), detection timestamp, and context snapshot. |
| FR-1.3 | Overdue task risk SHALL trigger when `current_date > task.due_date` AND `task.status != complete`. |
| FR-1.4 | Budget overrun risk SHALL trigger when `actual_spend >= (budget_cap * overrun_threshold)` where default `overrun_threshold = 0.90`. |
| FR-1.5 | Blocked dependency risk SHALL trigger when a predecessor task is overdue or failed and one or more successor tasks are in a waiting state. |
| FR-1.6 | Under-resource risk SHALL trigger when a task is `in_progress` or `scheduled` with zero active assignees, or when an assignee's current load exceeds a configurable utilization ceiling (default 100%). |

### FR-2: Mitigation Action Generation

| ID | Requirement |
|---|---|
| FR-2.1 | For each risk record the system SHALL generate 1–5 ranked mitigation actions ordered by expected impact and lowest disruption. |
| FR-2.2 | Each action SHALL include: `action_type`, `target_entity`, `rationale`, `estimated_effort` (Low / Medium / High), and `auto_executable` flag (boolean). |
| FR-2.3 | **Overdue task mitigations** SHALL include options such as: re-prioritize task (drop lower-priority siblings), extend deadline with stakeholder notification, split task into sub-tasks with independent owners, reassign to an available agent/human, or escalate to project manager. |
| FR-2.4 | **Budget overrun mitigations** SHALL include options such as: flag for executive review, defer non-critical task scope to next sprint/phase, reallocate budget from under-spent lines, reduce agent compute allocation, or halt discretionary spend. |
| FR-2.5 | **Blocked dependency mitigations** SHALL include options such as: fast-track the blocking task (assign additional resource), reorder task sequence where technically feasible, begin parallel preparatory work on successor, or escalate blocker to owner with SLA deadline. |
| FR-2.6 | **Under-resource mitigations** SHALL include options such as: auto-assign the highest-availability qualified agent, request human assignment via notification, split workload across multiple agents, or defer task start date. |
| FR-2.7 | The system SHALL NOT generate duplicate mitigation actions for the same risk if the action is already in an `accepted` or `in_progress` state. |

### FR-3: Action Payload & Integration

| ID | Requirement |
|---|---|
| FR-3.1 | Each mitigation action SHALL be serializable as a structured JSON payload consumable by downstream orchestrator agents and human dashboards. |
| FR-3.2 | Actions marked `auto_executable: true` SHALL be publishable to an outbound action queue without human approval, subject to a per-project `auto_execute_enabled` setting. |
| FR-3.3 | Actions requiring human approval SHALL trigger a notification (email, Slack, or in-app) to the responsible project manager or team lead within 5 minutes of risk detection. |
| FR-3.4 | The system SHALL expose a REST API endpoint (`POST /risks/{risk_id}/actions/{action_id}/accept`) and (`POST /risks/{risk_id}/actions/{action_id}/reject`) for human decision capture. |
| FR-3.5 | Accepted actions SHALL update risk record status to `mitigating`; rejected actions SHALL prompt regeneration of the next-best alternative. |

### FR-4: Prioritization & Ranking

| ID | Requirement |
|---|---|
| FR-4.1 | Risk records SHALL be ranked using a composite score: `severity_weight * (days_overdue_or_overrun_pct) * dependency_fan_out`. |
| FR-4.2 | The risk feed SHALL be sortable and filterable by: risk type, severity, project, assignee, and auto-executable status. |
| FR-4.3 | Critical severity risks SHALL appear at the top of all default views regardless of score. |

### FR-5: Audit & Reporting

| ID | Requirement |
|---|---|
| FR-5.1 | All risk detections, action generations, acceptances, rejections, and executions SHALL be logged to an immutable audit trail with actor identity and timestamp. |
| FR-5.2 | A weekly Risk Mitigation Summary report SHALL be auto-generated per project showing: risks detected, actions taken, resolution rate, and average time-to-mitigation. |

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a task whose `due_date` has passed and `status != complete`, the system generates a risk record with severity ≥ Medium and at least 2 ranked mitigation actions within 60 seconds of detection. |
| AC-2 | Given `actual_spend >= 90%` of `budget_cap`, a budget overrun risk record is created and a notification is delivered to the project manager within 5 minutes. |
| AC-3 | Given a blocked dependency scenario, at least one mitigation action of type `reassign` or `fast_track` is present in the action list targeting the blocking task. |
| AC-4 | Given an under-resourced task with a qualified available agent in the system, the generated action correctly identifies that agent by ID in the `target_entity` field. |
| AC-5 | An `auto_executable: true` action on a project with `auto_execute_enabled: true` is published to the action queue without requiring human input. |
| AC-6 | Rejecting a mitigation action via the API returns HTTP 200, marks the action `rejected`, and causes a new alternative action to appear in the risk record within 30 seconds. |
| AC-7 | All risk and action events appear in the audit log with correct actor, timestamp, and entity references — zero gaps under load test of 500 concurrent risk records. |
| AC-8 | The risk feed correctly returns only risks matching applied filters (type, severity, project) with ≤ 200 ms p95 response time. |
| AC-9 | The weekly Summary report is generated automatically every Monday 06:00 UTC per active project and contains all five required fields. |
| AC-10 | No duplicate mitigation action of the same `action_type` is generated for a risk that already has an `accepted` or `in_progress` action of that type. |

---

## Out of Scope

- **Root cause analysis:** The engine surfaces mitigations, not causal forensics or post-mortems.
- **Predictive / forecasted risks:** V1 detects only realized or threshold-breached conditions; ML-based early-warning prediction is deferred.
- **Budget re-allocation execution:** The engine recommends reallocation but does not write to financial or ERP systems directly.
- **Cross-project resource scheduling:** Agent/human assignment suggestions are scoped to the affected project's resource pool only.
- **Mitigation action execution logic:** The engine publishes action payloads; execution is the responsibility of downstream orchestrator agents or human actors.
- **UI/dashboard design:** Frontend implementation is outside this PRD; the engine delivers data via API and notification hooks.
- **SLA / contract compliance enforcement:** Legal or contractual breach handling triggered by overdue tasks is out of scope.
- **Third-party PM tool integrations** (Jira, Asana, Linear): API adapters are a separate workstream.