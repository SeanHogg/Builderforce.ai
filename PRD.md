> **PRD** — drafted by Ada (Sr. Product Mgr) · task #548
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Per-Project Health Cards

**Status:** Draft  
**Version:** 1.0  
**Author:** Product Architect  

---

## Problem & Goal
**Problem:** Stakeholders currently have no single view to quickly assess the health of multiple projects. Important signals—completion status, blockers, risk levels, and recommended actions—are scattered across different tools or missing. This leads to delayed decision-making and reactive oversight.

**Goal:** Deliver an at-a-glance, one-page health card for each active project that consolidates critical project health metrics into a consistent, actionable format. The card must enable stakeholders to instantly understand project status, identify risks, and know the next step to take.

---

## Target Users / ICP Roles
- Delivery Managers / Technical Program Managers  
- Engineering Managers / Team Leads  
- Project Managers / Scrum Masters  
- Product Managers tracking multiple workstreams  
- Leadership (VP Engineering, CTO) during portfolio reviews  

---

## Scope
**In scope:**
- Design and implement a new UI component (card grid/list) that displays one health card per active project.
- Each card includes: project name, overall status, completion % (progress bar), RAG indicator with rationale (per FR-3), task summary, key blocker, risk level with rationale, recommended next action.
- Populate card data from existing project data sources (project dashboards, task boards, CI/CD, etc.).
- Ensure cards are automatically updated when underlying data changes (near real-time).

**Out of scope:**
- Modifying underlying project management tools or workflows.
- Creating new alerting/notification systems (cards are a read-only visualization).
- Customization of card layout or content (V1 uses fixed structure).
- Historical trends or trend lines on cards.
- Any changes to the data models of tasks, builds, or status definitions.

---

## Functional Requirements

### FR-1: Card Composition
Each project health card MUST display:

| Element | Description |
|---------|-------------|
| Project Name | Unique project identifier (e.g., "BuilderForce.AI") |
| Overall Status | Human-readable label (e.g., On Track, At Risk, Blocked, On Hold) – derived from RAG + completion context |
| Completion % | Numeric 0–100 shown as a horizontal progress bar with percentage label |
| RAG Indicator | Traffic-light icon (Red/Amber/Green) with a short text rationale (max 140 chars) explaining why the color was assigned (per FR-3) |
| Task Summary | Concise summary of task progress, e.g., "13 of 19 tasks done (68%)" or "0 tasks created" |
| Key Blocker | Single most critical blocker, if any; otherwise "None" |
| Risk Level | Enum: High / Medium / Low with a one-line rationale based on blockers, stalled tasks, broken builds, missing activity |
| Recommended Next Action | Clear, actionable step the responsible person should take (e.g., "Resolve 3 failing tests", "Define and assign initial tasks") |

### FR-2: Completion % Progress Bar
- Calculated as: `(completed tasks or story points) / (total tasks or story points) * 100`
- Displayed as a segmented bar, color-coded:  
  - < 30% → red  
  - 30–70% → amber  
  - > 70% → green
- If total tasks = 0, bar is empty and shows 0%.

### FR-3: RAG Indicator Logic & Rationale
- **Red** conditions (any one true):  
  - Build broken (latest CI failed)  
  - 0% progress with tasks defined, or empty project (no tasks)  
  - Stalled backlog (>10 tasks stuck for >X days)  
  - On hold status  
- **Amber** conditions:  
  - Completion 30–70% without passing all acceptance tests  
  - Some failing tests but build passing  
  - At risk due to incomplete localization/blockers  
- **Green** conditions:  
  - >70% completion and all critical checks passing  
- **Rationale text** is auto-generated from the dominant condition, e.g., “Build broken (CI failure)”, “40 backlog items stalled”, “3 failing tests”.

### FR-4: Task Summary
- Format: `{completedTasks} of {totalTasks} tasks done ({completion%}%)`
- If no tasks exist: display “No tasks created”
- If project is on hold: prepend “On hold – ”
- If there are failing tests, append “+ {failingTestsCount} failing tests”

### FR-5: Key Blocker
- Derived from the most critical open blocker ticket or detected condition (e.g., build failure, missing resource, unresolved dependency).
- If multiple, select the one with the highest severity or longest standing; display its title or a standard phrase like “Build broken (main branch)”.
- If none: “None”.

### FR-6: Risk Level & Rationale
- **High**: Red RAG, blocked status, 0% with no activity, or >5 critical blockers.
- **Medium**: Amber RAG, stalled tasks, partial test failure.
- **Low**: Green RAG, healthy progress.
- Rationale (≤100 chars) summarizes why the risk level was assigned.

### FR-7: Recommended Next Action
- Context-specific, prescriptive, and directed at the project owner/team.
- Examples:  
  - “Fix broken build (CI job #123)”  
  - “Close 40 stalled backlog items”  
  - “Define initial tasks and assign team”  
  - “Investigate 3 failing tests in FR localization”
- Generated from the most prominent issue.

---

## Acceptance Criteria

### AC-1: Health Cards Visibility
- A dedicated view (e.g., /projects) displays a card for every active project in the system.
- Cards are rendered in a responsive grid; each card occupies one logical page’s worth of information (no scrolling within a card).

### AC-2: Data Accuracy and Dynamics
- Example scenarios must render correctly:
  - **BuilderForce.AI** → amber, 68% completion bar (13/19 tasks), RAG rationale: “3 failing tests”, task summary: “13 of 19 tasks done (68%) + 3 failing tests”, key blocker: “3 failing tests”, risk: Medium – “Acceptance tests failing”, next action: “Fix 3 failing tests”.
  - **Hired.Video** → red, 11% completion, RAG rationale: “Build broken + incomplete localization”, task summary: “2 of 18 tasks done (11%)”, key blocker: “Build broken”, risk: High, next action: “Restore CI build and complete FR localization”.
  - **RumbleDating** → red, 0% completion, RAG rationale: “40 backlog items stalled”, task summary: “0 of 40 tasks done (0%)”, key blocker: “Stalled backlog”, risk: High, next action: “Close or reprioritize 40 stalled items”.
  - **BurnRateOS** → amber, 0% completion, RAG rationale: “Project on hold”, task summary: “On hold – 0 of 9 tasks done (0%)”, key blocker: “On hold (no active work)”, risk: Medium – “Project on hold”, next action: “Resume work and assign tasks”.
  - **pattysnob.com** → red, 0% progress, RAG rationale: “No tasks created”, task summary: “No tasks created”, key blocker: “No tasks defined”, risk: High, next action: “Define and assign initial tasks”.

### AC-3: RAG Indicator and Rationale
- RAG color is determined by the logic in FR-3; hovering or clicking the indicator reveals the full rationale text.
- Rationale text is visible without interaction (shown below/next to the indicator).

### AC-4: Progress Bar Behavior
- Bar width and color match the computed percentage and thresholds in FR-2.
- When completion = 0% and tasks = 0, bar shows empty grey state and label “0%”.

### AC-5: Key Blocker and Recommended Action
- Key blocker is always populated based on the highest priority issue; recommended action is actionable and specific.
- When no issues exist, both fields show “None” and “No action needed” respectively.

---

## Out of Scope
- Historical snapshot or trend views of health cards.
- Manual editing of card content (all fields are read-only derived data).
- Export, sharing, or notification features based on card data.
- Customization of card fields per user role.
- Integration with external monitoring tools beyond current project data sources.
- Auto-remediation or workflow triggers from the recommended action.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._