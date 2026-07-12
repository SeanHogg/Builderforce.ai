> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #317
> _Each agent that updates this PRD signs its change below._

# PRD: Schedule Acceleration Assistant

## Problem & Goal

Engineering teams and project managers frequently discover mid-execution that a project is running behind schedule. When this happens, they lack fast, structured guidance on *which specific levers to pull*—parallelizing tasks, reducing scope, or deploying additional agents/contributors—to recover lost time without compromising critical outcomes.

**Goal:** Build a Schedule Acceleration feature that automatically detects schedule slippage and surfaces actionable, prioritized recommendations across three recovery strategies: task parallelization, scope reduction, and agent/resource deployment.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Manager** | Quickly identify which work items are blocking delivery and how to reallocate team capacity |
| **Project / Program Manager** | Maintain milestone commitments; communicate recovery plans to stakeholders |
| **Tech Lead** | Understand technical dependencies that allow or prevent parallelism |
| **AI Orchestration Operator** | Manage multi-agent pipelines and dispatch specialized agents to unblock bottlenecks |
| **Individual Contributor** | Receive clear, re-sequenced task assignments when the plan changes |

---

## Scope

This feature operates within an existing project execution context where:
- A baseline schedule (tasks, durations, dependencies, owners) exists.
- Actual progress data is tracked and comparable to the baseline.
- Agents, human contributors, or both can be assigned to work items.

The feature covers **detection → analysis → recommendation → optional execution** of schedule recovery actions.

---

## Functional Requirements

### FR-1: Slippage Detection

- **FR-1.1** Continuously or on-demand compare actual task completion timestamps against baseline schedule.
- **FR-1.2** Compute schedule variance per task, per milestone, and for the overall critical path.
- **FR-1.3** Classify severity of slippage: `Minor` (< 10% buffer consumed), `Moderate` (10–30%), `Critical` (> 30% or milestone at risk).
- **FR-1.4** Trigger acceleration analysis automatically when severity reaches `Moderate` or higher, or on explicit user request.

### FR-2: Dependency & Constraint Analysis

- **FR-2.1** Parse the task dependency graph (DAG) to identify the current critical path.
- **FR-2.2** Identify tasks that are dependency-free or have all prerequisites met (parallelization candidates).
- **FR-2.3** Catalog each task's: estimated remaining effort, required skill/agent type, hard vs. soft scope classification, and downstream dependents.
- **FR-2.4** Detect resource contention (tasks competing for the same agent or contributor).

### FR-3: Parallelization Recommendations

- **FR-3.1** Identify sequential tasks that have no true technical dependency and can be executed concurrently.
- **FR-3.2** For each parallelization opportunity, output:
  - Tasks to run in parallel
  - Prerequisite conditions that must first be satisfied
  - Estimated time saved (in original schedule units)
  - Risk level (`Low`, `Medium`, `High`) with rationale
- **FR-3.3** Rank parallelization opportunities by time-to-value impact on the critical path.
- **FR-3.4** Flag tasks that *appear* parallelizable but carry hidden shared-state or integration risks.

### FR-4: Scope Reduction Recommendations

- **FR-4.1** Classify all remaining tasks as `Must-Have`, `Should-Have`, `Nice-to-Have` based on metadata tags, dependency chains, and stated acceptance criteria.
- **FR-4.2** Propose a minimum viable delivery set that satisfies all `Must-Have` tasks and critical acceptance criteria.
- **FR-4.3** For each proposed scope cut, provide:
  - Description of what is deferred
  - Impact on downstream tasks or dependents
  - Effort recovered (in hours/days)
  - Suggested deferral milestone or version
- **FR-4.4** Never automatically drop tasks; all scope reductions require explicit human approval.

### FR-5: Agent / Resource Deployment Recommendations

- **FR-5.1** Identify tasks that are under-resourced relative to their remaining effort and remaining schedule time.
- **FR-5.2** Match each bottleneck task to available agent types or contributor profiles with the required capabilities.
- **FR-5.3** For each deployment recommendation, output:
  - Target task(s)
  - Recommended agent type or contributor role
  - Expected ramp-up/onboarding overhead
  - Net time saved after accounting for coordination cost
  - Handoff requirements from current owner
- **FR-5.4** If an orchestration layer is available, generate a ready-to-dispatch agent assignment payload for operator review.
- **FR-5.5** Warn when adding agents introduces Brooks' Law risk (coordination overhead exceeds time saved).

### FR-6: Unified Recovery Plan Output

- **FR-6.1** Synthesize all recommendations into a single, ranked Recovery Plan document.
- **FR-6.2** Each recommended action includes: action type, affected tasks, effort to implement, estimated schedule recovery, risk level, and required approvals.
- **FR-6.3** Provide a projected revised completion date under three scenarios: (a) all recommendations adopted, (b) parallelization only, (c) scope reduction only.
- **FR-6.4** Export Recovery Plan in at minimum two formats: structured JSON (machine-readable) and human-readable Markdown summary.

### FR-7: Feedback & Learning Loop

- **FR-7.1** Track which recommendations were accepted, rejected, or modified by users.
- **FR-7.2** After recovery actions are taken, measure actual vs. predicted schedule improvement.
- **FR-7.3** Surface accuracy delta to the operator dashboard for model/heuristic refinement.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a project with confirmed slippage ≥ 10%, the system produces a Recovery Plan within 60 seconds of analysis trigger. |
| AC-2 | Every parallelization recommendation references specific task IDs, their dependency status, and a quantified time-savings estimate. |
| AC-3 | Scope reduction recommendations never include `Must-Have` tasks unless zero `Should-Have` or `Nice-to-Have` tasks remain. |
| AC-4 | No task is automatically removed from scope or reassigned without explicit operator/manager approval. |
| AC-5 | Agent deployment recommendations include Brooks' Law risk warnings for any task where adding > 1 additional agent yields < 15% net time savings after coordination overhead. |
| AC-6 | The Recovery Plan is exported in valid JSON and Markdown within the same response/artifact. |
| AC-7 | Projected revised completion dates are within ± 5% accuracy when back-tested against 10 historical project datasets. |
| AC-8 | All recommendations are traceable to source data (task ID, current status, dependency graph node). |
| AC-9 | The system handles circular dependency detection gracefully and alerts the user rather than producing invalid recommendations. |
| AC-10 | Users can request a re-analysis after accepting or rejecting recommendations, producing an updated plan reflecting current state. |

---

## Out of Scope

- **Budget / cost optimization** — resource deployment recommendations are time-focused only; cost modeling is a separate feature.
- **Automatic execution of recovery actions** — the system recommends and prepares payloads but does not self-execute without human approval.
- **Initial project planning or schedule creation** — this feature acts only on an existing baseline schedule.
- **External calendar or HR system integration** — contributor availability is assumed to be provided as input metadata, not fetched live.
- **Stakeholder communication drafting** — the Recovery Plan is an internal operational artifact; external comms tooling is out of scope.
- **Risk management beyond schedule** — quality risk, security risk, and compliance risk analysis are not covered.
- **Historical project ingestion for initial training** — back-testing for AC-7 uses pre-loaded datasets; live historical import is a future capability.