> **PRD** — drafted by Ada (Sr. Product Mgr) · task #225
> _Each agent that updates this PRD signs its change below._

# PRD: Immediately Actionable Tasks View

## Problem & Goal

Team members and project managers lose time triaging backlogs to find work they can start right now. Tasks blocked by dependencies, unresolved decisions, or missing assignments are mixed in with genuinely ready work, forcing repeated manual filtering. The goal is to surface a single, always-current list of tasks that are **ready to start and unassigned**, so any contributor can claim and begin work without further coordination.

---

## Target Users

| Role | Need |
|---|---|
| **Individual Contributor (IC)** | Quickly find available work to self-assign without asking a manager |
| **Team Lead / Engineering Manager** | Identify unassigned ready work to delegate or prioritize |
| **Scrum Master / Project Coordinator** | Spot bottlenecks where ready work sits unclaimed too long |

---

## Scope

This PRD covers the **query logic, display, and interaction model** for the "Immediately Actionable Tasks" view within an existing project/task management system. It assumes tasks, assignments, dependencies, and statuses already exist as data entities in the system.

---

## Functional Requirements

### FR-1 — Task Eligibility Criteria
A task appears in the list if and only if **all** of the following are true:

- `status` is one of: `open`, `to-do`, `backlog-ready`, or equivalent "not started" states (configurable per workspace)
- `assignee` is **null / unassigned**
- All blocking dependencies have `status = done/closed`
- The task is not archived or deleted
- The task is not marked as `on-hold` or `blocked`

### FR-2 — List Display
- Show task title, project/epic label, priority level, creation date, and estimated effort (if set)
- Default sort: **priority descending**, then **creation date ascending** (oldest high-priority first)
- User may re-sort by: priority, creation date, estimated effort, due date
- Paginate or virtually scroll; show count of total results (e.g., "47 tasks")

### FR-3 — Filtering
- Filter by: project, team, label/tag, priority, estimated effort range
- Filters persist per user session; optionally saveable as named views

### FR-4 — Real-Time / Near-Real-Time Updates
- List refreshes automatically when any task's eligibility status changes (dependency resolved, assignee removed, status changed)
- Refresh latency ≤ 30 seconds; optimistic UI update acceptable for same-session changes

### FR-5 — Self-Assign Action
- Each task row exposes a one-click **"Assign to me"** action
- On click: sets `assignee = current user`, `status = in-progress` (or workspace equivalent), removes task from list immediately
- Confirmation prompt is optional (workspace setting)

### FR-6 — Task Detail Access
- Clicking the task title opens the full task detail view without losing list context (slide-over panel or new tab — configurable)

### FR-7 — Empty State
- When no tasks match criteria, display a contextual empty state: "No unassigned ready tasks right now. Check back later or adjust your filters."

### FR-8 — Notifications / Alerts (Optional Enhancement)
- Users may subscribe to a digest (daily or real-time) notifying them when new tasks enter the actionable list matching their saved filters

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A task with all dependencies closed, no assignee, and a non-blocked open status appears in the list within 30 seconds of becoming eligible |
| AC-2 | A task with one or more open blocking dependencies does **not** appear in the list |
| AC-3 | A task with an assignee does **not** appear in the list |
| AC-4 | Clicking "Assign to me" assigns the task to the current user, transitions its status, and removes it from the list in the same session without a page reload |
| AC-5 | The list correctly reflects applied filters; removing all filters restores the full eligible set |
| AC-6 | Default sort returns highest-priority, oldest tasks at the top |
| AC-7 | The total task count displayed matches the actual number of records returned by the eligibility query |
| AC-8 | The view loads initial results in ≤ 2 seconds for lists up to 500 tasks |
| AC-9 | Empty state message is shown when zero tasks meet the criteria after filters are applied |
| AC-10 | All eligibility logic is enforced server-side; client-side filtering is additive only |

---

## Out of Scope

- Creating, editing, or deleting tasks from this view
- Assigning tasks to **other** users (only self-assign)
- Time tracking or effort logging
- Capacity planning or workload balancing recommendations
- Changes to how dependencies, statuses, or priorities are defined or managed
- Mobile-native (iOS/Android) implementation — web responsive only in this iteration
- AI-based task recommendation or ranking
- Integration with external tools (Slack, email notifications beyond FR-8 digest) in this iteration