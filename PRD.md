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

## Implementation Design Notes

### Existing surfaces to reuse

- **Dashboard layout pattern:** The platform’s `/dashboard` page (`frontend/src/app/dashboard/page.tsx`) provides a ready-made Shell/AppShell background + lazy-loadable routes pattern (see `SectionTabs` and `PillTabs`). The new `/team-health` route should follow this pattern:
  - Route: `/team-health`
  - Shell: reuse `AppShell.tsx` + top-nav links.
  - Structured sections: `Workload`, `Blockers`, `Aging WIP`, `Agent Utilization`
- **Components to reuse/adapt:**
  - `HealthRing.tsx` (packages/brain-ui/src/HealthRing.tsx) — render progress/command arcs; suitable for capacity bars and the Team Health Score (0–100).
  - `SectionTabs.tsx` (frontend/src/components/SectionTabs.tsx) — collapsible sections and scrolling.
  - `PillTabs.tsx` (frontend/src/components/PillTabs.tsx) — filter tabs (team, sprint, label).
  - `SidePanel`-style swimlanes or presentation modals for focused blocker details (Channel/Session + presentation affine layout). Use `SlideOutPanel` or opening a modal for escalation.
- **Telemetry/observability surfaces:**
  - Kanbans/Autonomous execution emit Observability/tool-audit events (see self-diagnostic last run). However, `agent-worker` API exports include `canAutoRun`, `agentStatus`, `lastRun`, `queueDepth`.
- **Projects/tasks:**
  - Projects: identifier `id` (INTEGER, NOT uuid) and `id INTEGER refs tenants(id)`.
  - Tasks: first fetched by `projects.get(id) -> tasks.list(projectId)` resulting in a compact projection of tasks (id, title, status, priority, type, assignee/userId/agentRef/hostId points). Domain constants: TaskStatus states exist in domain/shared/types.ts (backlog, todo, ready, in_progress, in_review, done, blocked).
- **Agent data from API:**
  - Use `/projects/{id}/agents` endpoint on the agent-worker project (optional; default minimal) with query parameters `?remoteAgents=all`. The response contains expected fields:
    - `agentHostId` (self-hosted runner ID, INTEGER)
    - `agentRef` (Enterprise Agent id, string)
    - `name` (display name)
    - `agentStatus`: idle|running|waiting_on_human|blocked|error (use as-is)
    - `queueDepth`, `lastAction`, `lastError`, `lastRunStart/End`, `completedSinceRestart`, `avgTaskDurationSeconds`
    - `lastAcknowledgement`, `lastKeepAlive`
  - Warn on missing/no-agent hosts (auto-create `agent-worker` project if needed).

### Architectural considerations

- **Frontend backend integration:**
  - New `/api/projects/{id}/team-health` route under the agent-worker project to collect:
    - Contributor task lists by userId/agentRef.
    - Blocked tasks with `blockedSince` and blocking notes.
    - Tasks with last-status-change/last-activity-at (lastActivityAt from task model and/or run events).
    - Agent utilization metrics (returned by `/projects/{id}/agents`).
  - Metrics reference platform configs where present (e.g., capacity configured via project/team settings).
  - For AC-3 on task aging priority, tasks are now tied to runs: we can compute staleness from the latest `lastRunFinishedAt` and also fall back to `updatedAt`/`lastStatusChangeAt` per domain types. Default thresholds: 3 days (tasks), 7 days (epics).
- **Team Health Score (formula):**
  - Compute from the current dashboard evaluation cycle:
    - `blockerCount`: number of blocked tasks (FR-2.1)
    - `overloadPct`: % of contributors with tasks assigned > their configured capacity
    - `agingWipCount`: number of in-progress tasks beyond threshold (FR-3)
    - `agentErrorRate`: % of agents with an `error` state (non-healthy) for the current cycle
  - Weights (per-source): blockers (0.4), overload (0.3), aging (0.2), agent errors (0.1). Teams can adjust weights at project level via settings.
  - Score uses a bounded mapping to 0–100 (negative inputs map to close-to-zero; near-zero inputs to close-to-100).
- **Alerting:**
  - Reminder for peaks and parents (popover > priority) is just UI; focus on spike spikes and stale overloads (FR-6).
- **Alert delivery:**
  - Platform already has alerts support (`/api/projects/{id}/alerts` on the agent-worker project) for Slack-compatible payloads and digesting; reuse that surface and don’t duplicate.
- **Agency oversight:**
  - Admin can change the per-scoring source weighting (blockers, overload, agingWip, agentErrors) and per-contributor thresholds (warnings: >100% burden; critical: >150% burden, with constraints derived from configured capacity).
  - Export: CSV via GET with query params (`?view=aging-wip?export=true`), paginating at 500 per page (acquiring `x-total` header).
  - Cache/batching: for tasks/agents, use finite window to avoid loading every state; use server-side orchestration sequences in the repo (no AI-generated complexity).
- **UI/UX:**
  - Section tabs (Workload, Blockers, Aging WIP, Agent Utilization) with at-a-glance summary at the top (Workload, blockers, agingWip, agentErrors) plus toggles.
  - Visual capacity bars per contributor: left side label, a sector for assigned burden relative to configured capacity (color-coded: green/blue <100%, yellow >100%, red >150%).
  - Sticky per-contributor sections when scrolled (use React `sticky` CSS).
  - WIP aging: yellow/orange/red based on thresholds; on-hover to show blocking dependency and assignee.
  - Agent status: status pills and error messages inline; hover to show queue depth and duration.
  - Color palette must meet contrast AA for the region (e.g., 4.5:1 ratio for small text, 3:1 for large text), and be consistent with the global theme (light/dark).
- **Security:**
  - Use existing RBAC on the agent-worker project; add an explicit “team health view” permission scope or derive from existing `project:view` and `project:edit` (access less than edit).
- **Performance/observability:**
  - Cache result of `/api/projects/{id}/team-health` for 60 seconds (FR-5.3). The URL is stable per project.
  - Client-side polling: fetch with `useEffect` hook + `setInterval` (managed via a ref to avoid cross-tabs race).
  - Track metrics (Full per-turn tool calls and execution trace) for debugging load, dashboard responsiveness.

### Dependencies / integrations

- **Platform:**
  - Existing tasks runtime (swimlane + agent-worker) exposes fields used for telemetry (observability events, agent statuses, queue depth, avg duration).
  - Existing frontend shell and components reuse.
- **Future:**
  - More granular task filtering by sprint/label via existing query APIs (scoping is single-team/individual project).

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