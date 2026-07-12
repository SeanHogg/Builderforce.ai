> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #243
> _Each agent that updates this PRD signs its change below._

# PRD: Scenario Modeling — Add/Remove Resources & Scope Changes

## Problem & Goal

Project managers and planners lack a fast, interactive way to evaluate the downstream impact of staffing changes or scope shifts before committing to decisions. They must manually recalculate timelines, costs, and capacity across spreadsheets, leading to slow decisions, errors, and misaligned stakeholder expectations.

**Goal:** Deliver an in-app scenario modeling capability that lets users create, compare, and save "what-if" configurations of resources and scope against a baseline plan, surfacing projected impact on timeline, budget, and workload in real time.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Project Manager | Model headcount changes and see revised delivery dates instantly |
| Resource Manager | Test add/remove resource actions without affecting live plans |
| Program Manager | Compare multiple scenarios across a portfolio of projects |
| Finance / PMO Lead | Evaluate budget impact of scope additions or reductions |
| Executive Sponsor | Review summarized scenario comparisons for decision approval |

---

## Scope

### In Scope

- Creating named scenario drafts branched from a live baseline plan
- Adding or removing individual resources (people, teams, roles) within a scenario
- Adjusting scope items (tasks, milestones, epics, deliverables) — add, remove, resize effort
- Real-time recalculation of projected end date, total cost, and per-resource utilization
- Side-by-side comparison of up to four scenarios against the baseline
- Saving, naming, and archiving scenarios
- Promoting a scenario to become the new baseline (with confirmation and audit log entry)
- Commenting and sharing a scenario with stakeholders (read-only link)

---

## Functional Requirements

### FR-1 Scenario Creation
1. A user can branch any saved baseline plan into a new scenario with a single action.
2. Each scenario stores a name, description, owner, created timestamp, and last-modified timestamp.
3. A project can have a maximum of **20 active scenarios** at one time; archived scenarios do not count toward this limit.

### FR-2 Resource Modeling
1. Users can add a resource (named individual, role placeholder, or team) to a scenario and assign an availability percentage (0–100%).
2. Users can remove any resource from a scenario; affected tasks are flagged as unassigned automatically.
3. Changing a resource's availability recalculates dependent task durations using the project's scheduling algorithm (effort-driven by default).
4. Resource cost rates are pulled from the resource registry; overrides are allowed at the scenario level without modifying the registry.

### FR-3 Scope Modeling
1. Users can add new tasks, milestones, or epics to a scenario with estimated effort, duration, and dependencies.
2. Users can remove existing scope items; successor dependencies are flagged as broken and require user resolution.
3. Users can resize effort (hours/story points) or duration of any existing scope item within a scenario.
4. All scope edits cascade through the dependency chain and recalculate the critical path in real time (within 3 seconds for plans up to 1,000 tasks).

### FR-4 Impact Calculations
1. The system displays, for every scenario:
   - **Projected end date** (compared to baseline delta in days)
   - **Total estimated cost** (compared to baseline delta in currency)
   - **Per-resource utilization %** with over-allocation highlighted (>100%)
   - **Scope change summary** (tasks added / removed / resized counts)
2. Calculations refresh automatically on every user edit without requiring a manual save.
3. Calculation methodology (scheduling algorithm, cost formula) matches the methodology used for the live baseline plan.

### FR-5 Scenario Comparison
1. A comparison view displays 2–4 selected scenarios plus the baseline in a side-by-side panel.
2. Differences from baseline are visually highlighted (color-coded delta indicators).
3. Users can export the comparison view as a PDF or CSV.

### FR-6 Scenario Lifecycle Management
1. Users can rename, duplicate, archive, or delete any scenario they own or have edit permission on.
2. Promoting a scenario to baseline:
   - Requires explicit confirmation dialog listing the changes to be applied.
   - Creates an immutable snapshot of the previous baseline.
   - Records the promotion event in the project audit log (user, timestamp, scenario name).
3. Archived scenarios are read-only and retained for 12 months, then auto-deleted with a 30-day advance notification.

### FR-7 Collaboration & Sharing
1. Scenario owners can invite other users with **view** or **edit** roles.
2. A shareable read-only link can be generated for external stakeholders (no login required).
3. Users can leave threaded comments on any scenario; commenters receive in-app and email notifications.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A user can create a scenario from the baseline in ≤ 2 clicks and see it listed within 2 seconds. |
| AC-02 | Adding or removing a resource recalculates projected end date and cost within 3 seconds for plans with up to 1,000 tasks. |
| AC-03 | Removing a scope item with downstream dependencies surfaces a broken-dependency warning before the change is applied. |
| AC-04 | Side-by-side comparison renders correctly for 2, 3, and 4 scenarios simultaneously alongside the baseline. |
| AC-05 | Promoting a scenario to baseline creates an immutable snapshot of the prior baseline visible in audit history. |
| AC-06 | A read-only share link grants view-only access and does not expose edit controls to unauthenticated users. |
| AC-07 | Export to PDF and CSV from the comparison view produces a complete, correctly formatted file within 10 seconds. |
| AC-08 | Over-allocated resources (>100% utilization) are visually flagged in both the single-scenario and comparison views. |
| AC-09 | Scenario edits are auto-saved; no data is lost if the user closes the browser without manually saving. |
| AC-10 | Archived scenarios become read-only immediately upon archiving and remain accessible for 12 months. |

---

## Out of Scope

- **Automated scenario recommendations** — the system will not suggest which scenario to choose based on AI/ML optimization (future phase).
- **Resource procurement or hiring workflows** — adding a role placeholder does not trigger HR or procurement processes.
- **Financial forecasting integrations** — cost calculations use internal rate cards only; no ERP or accounting system sync in this release.
- **Gantt chart editing within scenario view** — scope and resource changes are made via structured form inputs; a full drag-and-drop Gantt editor for scenarios is deferred.
- **Multi-project dependency modeling** — scenarios are scoped to a single project; cross-project dependency impact is not calculated.
- **Mobile-native scenario editing** — the comparison and editing interface targets desktop web; mobile users have read-only access to scenario summaries.
- **Version history within a scenario** — individual edits inside a scenario are not versioned; only the promoted-to-baseline event is snapshotted.