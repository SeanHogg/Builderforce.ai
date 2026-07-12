> **PRD** — drafted by Ada (Sr. Product Mgr) · task #219
> _Each agent that updates this PRD signs its change below._

# PRD: Unassigned Task Identification System

## Problem & Goal

In multi-agent development environments, work items frequently go unassigned or become "orphaned" after initial planning, causing bottlenecks, duplicated effort, and idle agent capacity. The goal is to build a system that continuously identifies tasks that are unassigned and ready for immediate pickup, surfacing them to available agents in a frictionless, actionable way.

---

## Target Users / ICP Roles

- **Orchestrator Agents** — top-level agents responsible for delegating work across a multi-agent pipeline
- **Worker Agents** — autonomous agents polling for available work to execute
- **Human Engineering Leads** — overseeing task throughput and pipeline health
- **Project Managers** — monitoring sprint or queue health across teams or agent pools

---

## Scope

This PRD covers the detection, classification, and surfacing of unassigned tasks that meet a "immediately pickable" criteria within an existing task management or agent orchestration system. It does not cover task creation, prioritization frameworks, or agent matching/scheduling beyond basic eligibility filtering.

---

## Functional Requirements

### FR-1: Task Ingestion
- The system must connect to one or more task sources (e.g., backlog, issue tracker, orchestration queue) via a defined interface or API.
- The system must ingest task metadata including: task ID, title, description, status, assignee, dependencies, required capabilities, and creation timestamp.

### FR-2: Unassigned Detection
- A task is classified as **unassigned** if its assignee field is null, empty, or set to a placeholder value (e.g., `"unassigned"`, `"TBD"`).
- The system must filter tasks to only those in an active, open, or backlog state — excluding tasks that are closed, cancelled, blocked, or in review.

### FR-3: Immediate Pickability Evaluation
A task is considered **immediately pickable** if ALL of the following conditions are met:

| Condition | Criteria |
|-----------|----------|
| No blockers | All upstream dependency tasks are in `done` or `completed` state |
| No unresolved ambiguity | Task has a non-empty description or acceptance criteria |
| Correct status | Status is one of: `open`, `ready`, `backlog`, `todo` |
| No active lock | Task is not currently claimed/locked by another agent process |

### FR-4: Output / Surfacing
- The system must produce a ranked list of immediately pickable, unassigned tasks.
- Each entry in the output must include: task ID, title, short description, dependency status summary, and a readiness confidence score (high / medium / low).
- Output must be available via:
  - A structured JSON payload (for programmatic agent consumption)
  - A human-readable summary (markdown table or plain text list)

### FR-5: Polling & Refresh
- The system must support on-demand querying as well as a configurable polling interval (default: every 60 seconds).
- On each refresh cycle, the pickable task list must be recomputed from the latest task source state.

### FR-6: Claim Prevention / Locking
- When an agent picks up a task, the system must support marking that task as `claimed` to prevent double-assignment during the window before formal assignment is recorded.
- Claimed locks must expire after a configurable TTL (default: 5 minutes) if not confirmed.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | Given a task backlog with mixed assignee states, the system correctly identifies all tasks where assignee is null/empty/placeholder and status is open/ready/backlog/todo. |
| AC-2 | Given a task with one or more incomplete upstream dependencies, that task does not appear in the pickable list. |
| AC-3 | Given a task with no description or acceptance criteria, that task is excluded from the pickable list or flagged as low-confidence. |
| AC-4 | The output JSON payload conforms to the defined schema and is parseable by a downstream agent without transformation. |
| AC-5 | When two agents simultaneously query for pickable tasks, the claiming/locking mechanism prevents both from receiving the same task as available. |
| AC-6 | A claimed-but-unconfirmed task is automatically released and re-surfaced after the configured TTL expires. |
| AC-7 | The system returns an updated pickable list within 5 seconds of an on-demand query against a backlog of up to 10,000 tasks. |
| AC-8 | Human-readable output renders a markdown table with correct columns: Task ID, Title, Description Summary, Dependencies Clear, Confidence. |

---

## Out of Scope

- **Task creation or editing** — the system is read-only with respect to task content; it does not generate, modify, or delete tasks.
- **Agent capability matching** — routing a specific task to the best-fit agent based on skills or specialization is not handled here.
- **Priority scoring or re-ranking** — the system does not reorder tasks based on business priority or urgency; it only filters for pickability.
- **Notification / alerting** — push notifications to agents or humans when new tasks become available are not included in this iteration.
- **Cross-organization or cross-project federation** — the system operates within a single project or task namespace per deployment.
- **Historical analytics** — reporting on how long tasks remained unassigned or pickup latency metrics is out of scope.
- **Authentication and authorization** — access control to the task source or the output API is assumed to be handled by the underlying platform.