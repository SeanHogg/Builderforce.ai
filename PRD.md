> **PRD** — drafted by Ada (Sr. Product Mgr) · task #222
> _Each agent that updates this PRD signs its change below._

# PRD: Parallelization Opportunity Analysis Tool

## Problem & Goal

Development teams and project managers lose significant time to unnecessarily sequential execution of tasks — running things one after another when many could safely run at the same time. Without a clear dependency map and explicit identification of parallelizable work, engineers default to serial execution, inflating total wall-clock time, delaying delivery, and underutilizing available compute or human resources.

**Goal:** Build a tool (or structured analytical process) that ingests a task graph, identifies all tasks with no blocking dependencies, groups them into concurrent execution tiers, and surfaces a clear parallelization plan that teams and automated pipelines can act on immediately.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform / DevOps Engineer** | Optimize CI/CD pipeline stage ordering to reduce build times |
| **Engineering Manager** | Assign parallel workstreams to team members without creating blockers |
| **Data Engineer** | Parallelize DAG steps in ETL/ELT pipelines |
| **Technical Project Manager** | Identify critical path and surface free-floating tasks for earlier scheduling |
| **AI/Automation Agent** | Receive a machine-readable execution plan for orchestrated multi-agent task execution |

---

## Scope

### In Scope

- Accepting a task list with explicit dependency declarations as input
- Constructing a directed acyclic graph (DAG) from the input
- Detecting and rejecting or flagging cyclic dependencies
- Identifying all **root tasks** (zero in-degree nodes) that can start immediately and run concurrently
- Computing **execution tiers** (topological levels) — groups of tasks that can run in parallel once the previous tier completes
- Identifying the **critical path** (longest dependency chain determining minimum total duration)
- Outputting a human-readable parallelization plan and a machine-readable format (JSON)
- Handling tasks with no declared dependencies as implicitly parallelizable

---

## Functional Requirements

### FR-1: Input Parsing
- Accept task definitions in at minimum one structured format: JSON, YAML, or a simple DSL
- Each task entry must support: `id`, `name`, optional `duration_estimate`, and optional `depends_on: [list of task IDs]`
- Tasks with an empty or absent `depends_on` field are treated as having no dependencies

### FR-2: DAG Construction
- Build an internal directed acyclic graph from parsed input
- Each directed edge `A → B` means "B depends on A" (A must complete before B starts)
- Validate the graph is acyclic; surface a clear error listing the cycle if one is detected

### FR-3: Root Task Identification
- Compute in-degree for every node
- Emit all nodes with in-degree = 0 as **Tier 0** — the initial parallel execution set
- Label this set explicitly: "These tasks have no dependencies and can begin immediately and concurrently"

### FR-4: Execution Tier Computation
- Apply Kahn's algorithm (or equivalent topological sort by level) to group all tasks into ordered tiers
- Tier N contains all tasks whose dependencies are fully satisfied by tiers 0 through N-1
- All tasks within the same tier are safe to execute concurrently
- Output tiers in sequence with their member tasks

### FR-5: Critical Path Analysis
- If `duration_estimate` values are provided, compute the critical path (longest path by total duration through the DAG)
- Highlight which tasks lie on the critical path; these must not be delayed even when parallelizing
- Report minimum possible total execution time assuming unlimited parallelism

### FR-6: Output — Human-Readable Report
- Render a tiered execution plan in markdown or plain text:
  - Tier label, list of parallel tasks per tier, estimated duration for the tier (if durations provided)
  - Summary: total tiers, total tasks, critical path, estimated wall-clock time
- Flag tasks that are sole members of a tier (sequential bottlenecks)

### FR-7: Output — Machine-Readable JSON
- Emit a JSON object containing:
  - `tiers`: ordered array of `{ tier: N, tasks: [task_ids], max_duration: X }`
  - `critical_path`: ordered array of task IDs
  - `parallelization_summary`: `{ total_tiers, immediate_parallel_tasks, bottleneck_tasks }`

### FR-8: Cycle & Validation Error Reporting
- If a cycle is detected, output must clearly identify the cycle members and halt tier computation
- If a `depends_on` references an unknown task ID, surface a validation error listing the bad reference

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a valid acyclic task list, the tool correctly identifies all tasks with zero dependencies and labels them as Tier 0 (immediately parallelizable) |
| AC-2 | All tasks within a computed tier share no dependency relationship with each other (verified by confirming no edge exists between any two tasks in the same tier) |
| AC-3 | Every task appears in exactly one tier |
| AC-4 | Tiers are ordered such that for every task in Tier N, all its declared dependencies appear in tiers 0 through N-1 |
| AC-5 | Given duration estimates, the reported critical path matches the longest-duration path through the DAG and the minimum wall-clock time equals the sum of durations along that path |
| AC-6 | A task graph containing a cycle produces a clear error identifying the cycle; no tier output is produced |
| AC-7 | A task referencing an undefined dependency ID produces a validation error naming the missing ID |
| AC-8 | The machine-readable JSON output is valid JSON and conforms to the schema defined in FR-7 |
| AC-9 | A task list where all tasks are independent (no `depends_on` fields) results in a single Tier 0 containing all tasks |
| AC-10 | A fully linear chain of N tasks (each depending on the previous) produces N tiers of one task each, with every task flagged as a bottleneck |

---

## Out of Scope

- **Resource-constrained scheduling** — this tool assumes unlimited parallel executors; it does not schedule around worker pool limits or CPU/memory constraints
- **Dynamic dependency resolution** — dependencies that are only known at runtime are not supported; all dependencies must be declared statically at input time
- **Task execution / orchestration** — the tool produces a plan only; it does not invoke, monitor, or retry tasks
- **Real-time DAG updates** — incremental re-computation as tasks complete is not supported in v1; inputs are treated as a static snapshot
- **GUI or visual graph rendering** — no graphical DAG visualization; output is text and JSON only
- **Probabilistic duration modeling** — duration estimates are treated as deterministic point values; no Monte Carlo or PERT analysis
- **Cross-project or multi-DAG merging** — each invocation handles a single, self-contained task graph