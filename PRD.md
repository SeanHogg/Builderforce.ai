> **PRD** — drafted by Ada (Sr. Product Mgr) · task #235
> _Each agent that updates this PRD signs its change below._

# PRD: Human Resources Planning Tool — FTEs by Skill/Role with Timeline

## Problem & Goal

**Problem:**
Organizations lack a structured, centralized way to forecast and visualize the full-time equivalents (FTEs) required across skill sets and roles over a project or initiative timeline. This forces workforce planners, project managers, and finance teams to stitch together information from spreadsheets, emails, and tribal knowledge — leading to under-staffing, over-commitment, budget overruns, and missed delivery milestones.

**Goal:**
Deliver a feature (or standalone tool) that enables workforce planners to define, visualize, and manage FTE demand by skill/role across a configurable time horizon, producing an artifact that can be shared with finance, HR, and delivery leadership for staffing decisions and budget approvals.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Workforce / Resource Planner** | Enter and maintain FTE demand by role and time period |
| **Project / Program Manager** | Align resource needs to project phases and milestones |
| **Finance Business Partner** | Validate headcount costs against budget envelopes |
| **HR / Talent Acquisition Lead** | Identify hiring needs and lead times by skill |
| **Executive Sponsor / VP** | Review aggregate demand vs. capacity at a portfolio level |

---

## Scope

### In Scope
- Define roles and skill categories relevant to a project or department
- Assign FTE values (full or fractional) per role per time period (week, month, or quarter)
- Set a configurable planning horizon (e.g., 3 months to 3 years)
- Distinguish between **existing headcount**, **open requisitions**, and **gap/unmet demand**
- Associate FTE entries with project phases or milestones
- Export/share the plan as a structured artifact (CSV, PDF, or shareable link)
- Summary view aggregating FTEs across all roles per time period
- Role-level detail view showing allocation over time

### Out of Scope
- Real-time integration with HRIS systems (e.g., Workday, SAP HCM) — deferred to v2
- Compensation and total rewards calculation — handled by Finance tooling
- Individual employee scheduling or shift planning
- Automated sourcing or ATS integration
- Approval workflow and RACI management

---

## Functional Requirements

### FR-1: Role and Skill Definition
- Users can create, edit, and delete named roles (e.g., "Senior Backend Engineer," "Data Analyst," "Scrum Master").
- Each role must have at least one associated skill tag (e.g., Python, Product Management, UX Research).
- Roles can be grouped into skill families (e.g., Engineering, Design, PMO, Data).

### FR-2: Timeline Configuration
- Users can set a planning start and end date.
- Users can select the time-period granularity: **weekly**, **monthly**, or **quarterly**.
- The timeline must support a minimum of 1 month and a maximum of 36 months.

### FR-3: FTE Entry
- For each role × time period cell, users can enter an FTE value as a decimal (e.g., 0.5, 1.0, 2.5).
- FTE values of 0 are valid (indicating no demand in that period).
- Users can bulk-fill a row (same FTE across a date range) via a fill/copy action.

### FR-4: Headcount Status Classification
- Each FTE entry must be classifiable as one of:
  - **Filled** — existing employee allocated
  - **Open Req** — approved requisition in flight
  - **Gap** — demand with no supply identified
- Color-coding in the grid must reflect these statuses.

### FR-5: Milestone / Phase Overlay
- Users can define named project phases (e.g., Discovery, Build, Launch) with start and end dates.
- Phases are displayed as a visual band above the FTE timeline grid.

### FR-6: Aggregated Summary
- A summary row must display total FTEs across all roles for each time period.
- A summary column must display total FTEs across all time periods for each role.
- Totals must update in real time as entries are modified.

### FR-7: Export and Sharing
- Users can export the plan to:
  - **CSV** (role × time period matrix with status)
  - **PDF** (formatted snapshot including phase overlays and summary)
- Users can generate a read-only shareable link valid for 30 days.

### FR-8: Access and Permissions
- The plan creator has full edit rights.
- Invited collaborators can be granted **Edit** or **View-only** access.
- No authentication required for read-only shareable link access.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A planner can create a new plan, add 10+ roles with skill tags, and set a 12-month monthly timeline in under 5 minutes. |
| AC-2 | Entering or modifying an FTE value updates the row total, column total, and grand total without a page reload. |
| AC-3 | Each cell correctly displays color-coding for Filled (green), Open Req (amber), and Gap (red) statuses. |
| AC-4 | A project phase defined with start/end dates renders as a labeled band above the correct time-period columns. |
| AC-5 | CSV export contains one row per role, one column per time period, with FTE values and status included. |
| AC-6 | PDF export renders legibly at A3/Tabloid size for a 12-month monthly plan with up to 20 roles. |
| AC-7 | A shareable link grants view-only access to an unauthenticated user and expires after 30 days. |
| AC-8 | Fractional FTE values (e.g., 0.25, 0.5, 0.75) are accepted and displayed correctly in all views. |
| AC-9 | A plan with 36-month quarterly granularity and 30 roles loads the full grid in under 3 seconds on a standard broadband connection. |
| AC-10 | An invited collaborator with View-only access cannot modify any FTE value, role, or phase. |

---

## Out of Scope

- **HRIS / HR system integration** — no live sync with Workday, SAP, Oracle HCM, or equivalent in v1
- **Cost and compensation modeling** — salary rates, benefits loading, and budget roll-ups are not computed
- **Individual-level staffing** — the tool operates at role/skill level, not named-person scheduling
- **Capacity supply input** — the tool captures demand only; available supply is tracked externally
- **Automated gap analysis or AI recommendations** — no algorithmic suggestions for filling gaps in v1
- **Approval workflows** — no multi-step sign-off, notifications, or status state machine
- **Mobile-native experience** — responsive web is a stretch goal; native iOS/Android apps are deferred
- **Localization and multi-currency** — English-only, no currency fields in v1