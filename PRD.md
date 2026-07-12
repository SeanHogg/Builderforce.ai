> **PRD** — drafted by Ada (Sr. Product Mgr) · task #152
> _Each agent that updates this PRD signs its change below._

# PRD: AI-Powered Resolution Plan

## Problem & Goal

**Problem:** When a project enters an unhealthy state — schedule slippage, budget overrun, rising bug counts, resource contention, or blocked dependencies — PMs and leaders lack fast, structured guidance on *how* to recover. Existing dashboards surface *what* is wrong but not *what to do about it*. This forces manual triage, delays corrective action, and increases the probability of compounding failures.

**Goal:** Deliver an AI-powered Resolution Plan module that automatically analyzes the current project diagnostic state and produces a prioritized, actionable set of recommendations — each linked to specific project data, assigned to a responsible party, and accompanied by an estimated impact — so teams can move from red to green as quickly as possible.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Project Manager / Program Lead** | Quickly understand the highest-leverage actions to recover schedule, budget, or quality health |
| **Engineering Lead / Tech Lead** | Receive specific technical recommendations (parallelization, refactoring targets, testing focus) tied to real work items |
| **Executive Sponsor / Portfolio Owner** | Validate that a credible recovery plan exists before escalating or reallocating resources |
| **AI Agent Orchestrator** | Accept automated recommendations and trigger downstream workflows without manual handoff |

---

## Scope

This PRD covers the **Resolution Plan** feature within the existing project-health platform. It assumes a functioning diagnostic layer that already identifies risks, flags overdue tasks, surfaces budget variance, and tracks dependency graphs. The Resolution Plan consumes diagnostic output and adds the recommendation + action layer on top.

---

## Functional Requirements

### FR-1 — Diagnostic Ingestion & Trigger
- The AI engine must ingest the latest diagnostic snapshot (schedule variance, budget delta, bug/defect counts, resource utilization, dependency graph, agent availability) each time a resolution plan is requested or automatically triggered by a health-threshold breach.
- Plans must be regeneratable on demand at any time by authorized users.

### FR-2 — Risk Mitigation Recommendations
- For each active risk flag (overdue task, budget overrun, SLA breach, etc.), the engine must generate at least one specific mitigation action (e.g., "Re-prioritize task T-204 ahead of T-198," "Assign Agent-7 to unblock Story S-41").
- Each recommendation must cite the source diagnostic signal that triggered it.

### FR-3 — Schedule Acceleration Recommendations
- When schedule variance is negative (behind plan), the engine must identify:
  - Tasks that can be safely parallelized with current or available agents.
  - Scope items eligible for deferral, with rationale.
  - Specific agents or human roles to deploy against named work items.

### FR-4 — Quality Improvement Recommendations
- When defect density or open bug count exceeds configured thresholds, the engine must recommend:
  - Specific modules, components, or agents producing the highest defect concentration.
  - Focused testing strategies (regression suite, exploratory areas) tied to those components.
  - Code review or agent-assisted refactoring targets with justification.

### FR-5 — Resource Optimization Recommendations
- When resource utilization is over- or under-allocated, the engine must suggest:
  - Agent reallocation across work items with utilization delta.
  - Human workflow optimizations (e.g., handoff sequencing, meeting load reduction).
  - New agent provisioning needs with estimated onboarding cost/time.

### FR-6 — Dependency Resolution Recommendations
- The engine must traverse the critical path dependency graph and identify:
  - Blocked nodes preventing downstream work from starting.
  - Specific unblocking actions (e.g., "Owner X must approve deliverable D-3 by [date] to keep path clear").
  - Alternative sequencing if the primary blocker cannot be resolved within the recovery window.

### FR-7 — Prioritized Recommendation Output
- All recommendations must be ranked by a composite priority score derived from estimated impact and urgency.
- Each recommendation card must include:
  - **Action**: A single, specific instruction in plain language.
  - **Category**: One of {Risk Mitigation, Schedule Acceleration, Quality Improvement, Resource Optimization, Dependency Resolution}.
  - **Linked Data**: Direct reference to the task, agent, budget line, bug ID, or dependency node that is the subject of the recommendation.
  - **Estimated Impact**: A quantified projection (e.g., "Accelerates delivery by ~3 days," "Reduces schedule risk score by ~18%"). Estimates must display confidence bands where certainty is low.
  - **Responsible Party**: Named human role or agent ID designated as the owner of executing the action.
  - **Suggested Deadline**: The latest date by which the action should be taken to achieve the stated impact.

### FR-8 — Accept / Reject Workflow
- Users must be able to **Accept**, **Reject**, or **Defer** each recommendation individually.
- **Accept** on an automatable recommendation must trigger the corresponding workflow (e.g., agent reassignment, task reprioritization, schedule update) without additional manual steps.
- **Accept** on a human-action recommendation must create a tracked action item assigned to the responsible party with the suggested deadline.
- **Reject** must prompt the user for a brief reason (free text or taxonomy pick-list) and log the decision for model feedback.
- **Defer** must allow the user to set a future review date; the recommendation re-surfaces at that date with refreshed impact estimates.

### FR-9 — Plan Versioning & Audit Log
- Each generated Resolution Plan must be saved as a versioned snapshot (timestamp, trigger type, diagnostic state hash).
- All accept/reject/defer decisions must be recorded in an immutable audit log with actor identity and timestamp.
- The system must allow side-by-side comparison of two plan versions to show how health metrics have changed between them.

### FR-10 — Notifications & Escalation
- When a resolution plan is auto-generated due to a threshold breach, responsible parties must receive a notification (in-app + configurable channel) summarizing the top three recommendations.
- If accepted recommendations remain unexecuted past their suggested deadline, an escalation notification must be sent to the user's manager or designated escalation contact.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a completed diagnostic snapshot, the AI engine generates a Resolution Plan within **60 seconds** containing at least one recommendation per active risk category present in the snapshot. |
| AC-2 | Every recommendation card displays: a plain-language action, category label, link to the source data artifact, quantified estimated impact, responsible party, and suggested deadline. |
| AC-3 | Estimated impact values are present on **100%** of recommendations; values flagged as low-confidence display a visible uncertainty indicator (e.g., range or confidence level). |
| AC-4 | Accepting an automatable recommendation triggers the downstream workflow within **30 seconds** and surfaces a confirmation with execution status to the accepting user. |
| AC-5 | Accepting a human-action recommendation creates a tracked action item visible in the project task list, assigned to the named responsible party, with the suggested deadline pre-populated. |
| AC-6 | Rejecting a recommendation logs the actor, timestamp, and stated reason; the rejected recommendation is excluded from subsequent auto-generated plans unless the underlying diagnostic signal worsens. |
| AC-7 | Deferring a recommendation re-surfaces it on the selected date with refreshed impact estimates derived from the then-current diagnostic state. |
| AC-8 | Every Resolution Plan is persisted as a versioned snapshot; an authorized user can retrieve and compare any two historical snapshots. |
| AC-9 | All accept/reject/defer events appear in the audit log within **5 seconds** of the action being taken. |
| AC-10 | A PM-role user in UAT testing rates **≥ 80%** of generated recommendations as "specific and actionable" in post-session evaluation. |

---

## Out of Scope

- **Root-cause analysis engine**: This PRD covers recommendation generation only; the upstream diagnostic layer that detects and classifies risks is a separate component.
- **Automated execution of human-owned tasks**: The system surfaces and assigns human-action items but does not autonomously execute work that requires human judgment or approval beyond what is explicitly accepted.
- **Budget re-forecasting or financial modeling**: Recommendations may reference budget lines, but the system does not generate revised financial forecasts or rebaseline project budgets.
- **Cross-project portfolio optimization**: Resolution Plans are scoped to a single project instance; cross-project resource balancing and portfolio-level trade-offs are out of scope for this release.
- **Custom ML model training per organization**: The AI engine uses a shared model; per-tenant fine-tuning pipelines are deferred to a future release.
- **Real-time streaming updates to an open plan**: Plans are point-in-time snapshots; continuous live mutation of an in-progress plan as new data arrives is not supported in v1.
- **External stakeholder sharing portal**: Exporting or publishing the Resolution Plan to external parties outside the platform is out of scope.