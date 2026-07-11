> **PRD** — drafted by Ada (Sr. Product Mgr) · task #144
> _Each agent that updates this PRD signs its change below._

# PRD: Resource Estimation — Human & AI Capacity Analysis

## Problem & Goal

**Problem:** The team (1 human + 4 AI cloud agents) is operating against a multi-project backlog of unknown total effort. There is no current visibility into agent utilization rates, task queue depth per agent, or projected time-to-completion. The 50 identified cloud-agent validation gaps (many P0/P1) represent unquantified engineering risk that may exceed current capacity.

**Goal:** Produce a structured capacity and resource estimate that maps remaining backlog effort to available human and AI resources, identifies bottlenecks and capability gaps, and yields an actionable recommendation on whether additional agents or human hours are required to hit delivery targets.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Sean Hogg (Human Lead) | Understand where his review time is the binding constraint; decide whether to hire or spin up additional agents |
| Kevin (BA/PM Agent) | Understand backlog sizing and prioritization inputs |
| Mike (QA Agent) | Understand validation queue depth and P0/P1 defect load |
| Bob / John (Developer / Coder Agents) | Understand task assignment balance and throughput expectations |

---

## Scope

This PRD covers a **one-time analytical deliverable** (with a recommended refresh cadence) that:

1. Inventories all open tasks across every active project.
2. Sizes effort per task using story points or t-shirt sizing (XS/S/M/L/XL).
3. Maps tasks to agent roles and calculates current utilization.
4. Factors in the 50 cloud-agent validation gaps as a discrete workstream.
5. Outputs a per-project resource estimate and a team-level capacity recommendation.

---

## Functional Requirements

### FR-1: Backlog Inventory & Effort Estimation

- FR-1.1 Pull all open tasks across every active project into a single consolidated list, tagged by project, priority (P0–P3), and current assignee.
- FR-1.2 Assign a story-point estimate (1 / 2 / 3 / 5 / 8 / 13) or t-shirt size to every open task. Tasks with insufficient definition must be flagged as **needs refinement** and counted separately.
- FR-1.3 Compute total estimated effort per project (sum of story points) and a grand total across all projects.
- FR-1.4 Segregate the 50 cloud-agent validation gaps into their own sub-inventory; label each with priority (P0/P1/P2), owning agent role, and estimated effort. Sum to a standalone validation-gap effort total.

### FR-2: Agent Utilization Analysis

- FR-2.1 For each of the 5 team members (1 human + 4 agents), list:
  - Tasks currently **in-progress** or **assigned**.
  - Tasks **blocked** (on human review, external input, or agent capability gap).
  - Tasks **queued but unstarted**.
- FR-2.2 Calculate a utilization percentage for each agent: `(active tasks × avg task duration) / available agent-hours per sprint`.
- FR-2.3 Identify any agent whose queue is empty (idle risk) or whose queue exceeds a single-sprint capacity (overload risk).
- FR-2.4 Estimate per-agent throughput in story points per day based on observed or assumed velocity; flag where no empirical data exists.

### FR-3: Bottleneck Identification

- FR-3.1 Flag every task or task category that is **blocked on human (Sean) review**. Count total blocked story points and estimated human-hours to unblock.
- FR-3.2 Identify task types that **no current agent role can handle** (capability gaps). List the missing capability and the number/effort of affected tasks.
- FR-3.3 Identify **inter-agent handoff bottlenecks** (e.g., Bob/John coding → Mike QA → Kevin acceptance) and whether any stage is a throughput constraint.
- FR-3.4 Produce a bottleneck severity rating (Critical / High / Medium / Low) for each identified bottleneck.

### FR-4: Time-to-Completion Estimate

- FR-4.1 Given per-agent throughput (FR-2.4) and total queued effort (FR-1.3), calculate **calendar days to backlog completion** under current resourcing, broken down per project.
- FR-4.2 Produce a **human-days** estimate for Sean and an **agent-hours** estimate for each AI agent, per project and in aggregate.
- FR-4.3 Model two scenarios:
  - **Scenario A (Status Quo):** Current team, no additions.
  - **Scenario B (Recommended):** Team with suggested additions (new agents or human hours), showing projected time-to-completion reduction.
- FR-4.4 Highlight any project where completion date under Scenario A breaches a known deadline or SLA.

### FR-5: Recommendations

- FR-5.1 State explicitly whether additional agents are recommended, and if so: what role, how many, and which project/task type they should be assigned to first.
- FR-5.2 State whether additional human hours (Sean) are required or whether human bottlenecks can be reduced by delegation/automation.
- FR-5.3 Provide a prioritized **top-3 actions** the team should take in the next sprint to improve throughput, ordered by impact.
- FR-5.4 Recommend a refresh cadence for this capacity analysis (suggested: weekly or per-sprint).

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | A consolidated backlog table exists with every open task tagged by project, priority, assignee, and story-point estimate. | Reviewer confirms no project is missing; all tasks have an estimate or a "needs refinement" flag. |
| AC-2 | Each of the 50 cloud-agent validation gaps has a priority label (P0/P1/P2), owning agent, and effort estimate. | Count of rows in validation-gap table equals 50; no row missing priority or estimate. |
| AC-3 | Utilization rate (%) is reported for each of the 5 team members. | Five utilization figures present; methodology documented inline. |
| AC-4 | At least one bottleneck is identified per category: human-review blocks, capability gaps, inter-agent handoffs. | Each category has a named bottleneck with severity rating. |
| AC-5 | Per-project resource estimate is present, showing human-days (Sean) and agent-hours (per agent) to close that project's backlog. | One row per active project in the estimate table; totals column present. |
| AC-6 | Two scenarios (Status Quo vs. Recommended) are modeled with projected calendar completion dates. | Both scenarios present; delta in days is explicit. |
| AC-7 | A concrete recommendation states yes/no on additional agents and/or human hours, with role and rationale. | Recommendation section is unambiguous; no conditional-only language without a default recommendation. |
| AC-8 | Top-3 next-sprint actions are listed in priority order with expected impact stated. | Exactly 3 actions, each with impact statement. |
| AC-9 | Refresh cadence is documented. | Single explicit statement of cadence. |

---

## Out of Scope

- **Hiring / contracting process:** This PRD covers the *need* for additional resources, not the recruitment or procurement workflow.
- **Budget dollar amounts:** Cost modeling ($/hour for cloud agents or contractor rates) is excluded; this is a capacity-units analysis only.
- **Roadmap re-prioritization:** This analysis informs prioritization decisions but does not itself reprioritize the backlog.
- **Technical architecture of the agent platform:** How agents are provisioned, scaled, or billed is not covered here.
- **Completed or cancelled tasks:** Historical velocity data may be referenced, but closed tasks are not re-estimated.
- **Third-party dependency timelines:** External API readiness, vendor SLAs, or partner delivery dates are out of scope unless they directly create a blocking dependency captured in FR-3.2.