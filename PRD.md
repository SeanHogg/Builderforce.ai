> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #320
> _Each agent that updates this PRD signs its change below._

# PRD: Dependency Resolution — Critical Path Unblocking

## Problem & Goal

Engineering teams lose significant velocity when critical path dependencies stall delivery. Blockers are often identified too late, communicated informally, or left unresolved because ownership is unclear. The goal of this system is to **automatically identify dependency blockers on the critical path, surface them with context, and suggest concrete resolution actions** — reducing the mean time to unblock (MTTUB) and keeping delivery on schedule.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Lead / Tech Lead** | Knows what is blocked; needs prioritized, actionable resolution steps without manual triage |
| **Project / Program Manager** | Needs visibility into which dependencies threaten the delivery date and who owns resolution |
| **Individual Contributor (IC)** | Needs clear, immediate next steps when their work is blocked |
| **Engineering Manager** | Needs escalation signals and resource reallocation recommendations |

---

## Scope

This PRD covers the automated analysis of a project's task/dependency graph to:

1. Identify which tasks sit on the **critical path**.
2. Detect which of those tasks have **unresolved dependencies** (blockers).
3. Generate **ranked, actionable resolution suggestions** for each blocker.

The system operates on data already present in the project's task management tooling (e.g., GitHub Issues, Jira, Linear, or a structured task graph file).

---

## Functional Requirements

### FR-1: Critical Path Computation
- The system MUST parse a directed acyclic graph (DAG) of tasks and their dependencies.
- The system MUST compute the critical path using the **Critical Path Method (CPM)** — identifying the longest chain of dependent tasks that determines the minimum project duration.
- The system MUST re-compute the critical path dynamically when task estimates or statuses change.

### FR-2: Blocker Detection
- The system MUST flag any critical-path task whose upstream dependency meets one or more of the following conditions:
  - Status is `blocked`, `on-hold`, `pending-external`, or equivalent.
  - Owner is unassigned.
  - Estimated completion date exceeds the dependent task's start date.
  - No activity recorded within a configurable staleness window (default: 3 business days).
- The system MUST distinguish between **hard blockers** (task cannot start) and **soft blockers** (task can start partially but will be impeded).

### FR-3: Resolution Suggestion Engine
- For each detected blocker, the system MUST generate one or more suggested resolution actions drawn from the following action categories:

  | Category | Example Action |
  |---|---|
  | **Re-assignment** | "Assign this dependency to [available team member with relevant skills]" |
  | **Escalation** | "Escalate to [owner's manager] — stale for N days" |
  | **Parallelization** | "Tasks X and Y can proceed in parallel; reorder to remove sequential constraint" |
  | **Scope reduction** | "Deliver minimal interface/stub to unblock downstream; defer full implementation" |
  | **External coordination** | "Schedule sync with [external team/vendor] to resolve API contract ambiguity" |
  | **Risk acceptance** | "Accept risk; proceed with documented assumption [A]" |

- Suggestions MUST be ranked by estimated unblocking speed (fastest first) with a secondary sort by confidence score.
- Each suggestion MUST include: action type, description, suggested owner, estimated time-to-unblock, and confidence level (`high` / `medium` / `low`).

### FR-4: Dependency Impact Scoring
- Each blocker MUST be assigned a **Dependency Impact Score (DIS)** calculated from:
  - Number of downstream tasks affected.
  - Total schedule slip risk (days) propagated through the DAG.
  - Business priority weight of the affected milestone.
- The DIS MUST be used to sort the blocker list, surfacing highest-impact blockers first.

### FR-5: Output & Reporting
- The system MUST produce a structured report in both **human-readable markdown** and **machine-readable JSON**.
- The report MUST include:
  - Executive summary (total blockers, critical-path tasks at risk, projected schedule impact).
  - Ranked blocker list with suggestions.
  - Dependency graph visualization (mermaid diagram or equivalent) annotated with blocker status.
- The system MUST support delivery via: CLI output, comment on linked issue/PR, and webhook payload.

### FR-6: Staleness & Re-evaluation
- The system MUST re-evaluate the dependency graph on a configurable schedule (default: every 24 hours or on any task status change event).
- Previously resolved blockers MUST be removed from the active report and logged to a resolution history.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a valid task DAG with ≥ 2 tasks, the system correctly identifies the critical path matching a manually verified CPM calculation. |
| AC-2 | Given a critical-path task with a stale, unassigned upstream dependency, the system flags it as a hard blocker within one evaluation cycle. |
| AC-3 | Every flagged blocker has at least one resolution suggestion with all required fields populated (action type, description, owner, time-to-unblock, confidence). |
| AC-4 | Blocker suggestions are ranked fastest-to-unblock first; ties are broken by confidence score descending. |
| AC-5 | The Dependency Impact Score correctly propagates delay through multi-hop dependency chains (verified against 3 test DAGs of increasing complexity). |
| AC-6 | The markdown and JSON reports are generated in < 5 seconds for a DAG of up to 500 tasks. |
| AC-7 | When a blocker is resolved (status changes to `done`/`complete`), it is removed from the active report within one evaluation cycle and appears in resolution history. |
| AC-8 | The system handles cycles in the input graph gracefully, reports them as configuration errors, and does not crash. |
| AC-9 | CLI, issue-comment, and webhook delivery modes each produce identical report content (format may differ). |
| AC-10 | Staleness window and re-evaluation schedule are configurable without code changes (environment variable or config file). |

---

## Out of Scope

- **Automatic execution of resolution actions** — the system suggests; humans act. No automated ticket reassignment, calendar invites, or code changes.
- **Resource capacity planning** — the system does not model team-wide workload or sprint capacity; it operates on task-level dependency data only.
- **Cost estimation** — financial impact of delays is not calculated.
- **Third-party vendor SLA tracking** — external dependency timelines must be manually entered; the system does not query external APIs for SLA status.
- **Historical trend analytics / burndown** — resolution history is stored but trend reporting is a future phase.
- **Natural language task ingestion** — tasks must be in a structured format; free-text parsing is not supported in this version.
- **Real-time collaborative editing** of the task graph within this tool.