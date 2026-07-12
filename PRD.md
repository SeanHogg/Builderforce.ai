> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #241
> _Each agent that updates this PRD signs its change below._

# PRD: Human vs AI Resource Breakdown

## Problem & Goal

Engineering managers, project leads, and workforce planners lack a clear, unified view of how work is distributed between human contributors and AI-assisted or AI-automated tasks across a project or organization. This ambiguity leads to inaccurate capacity planning, misattributed productivity, and poor forecasting.

**Goal:** Deliver a resource breakdown report and visualization that clearly distinguishes human effort from AI contribution across tasks, time periods, and cost centers — enabling data-driven decisions about workforce composition, AI investment, and project staffing.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Understand team capacity vs. AI augmentation ratio |
| PMO / Project Lead | Accurate effort attribution for project reporting |
| Workforce Planner / HR | Headcount forecasting adjusted for AI offload |
| Finance / FinOps | Cost comparison between human labor and AI tooling spend |
| C-Suite / VP Engineering | Executive summary of AI adoption ROI across teams |

---

## Scope

### In Scope

- Aggregation of effort data from human contributors (hours logged, tickets assigned, PRs, story points)
- Aggregation of AI contribution signals (AI-generated code accepted, AI-resolved tasks, automated pipeline executions, AI agent task completions)
- Breakdown views by: project, team, sprint/time period, cost center, and task type
- Side-by-side comparison of human vs. AI resource allocation (percentage and absolute values)
- Cost overlay: human labor cost vs. AI tooling cost per unit of output
- Trend analysis over configurable time windows (weekly, monthly, quarterly)
- Export capability (CSV, PDF, shareable link)

### Integrations Required

- Project management tools: Jira, Linear, Asana, GitHub Issues
- Version control: GitHub, GitLab, Bitbucket (PR-level attribution)
- AI tooling signals: GitHub Copilot, Cursor, internal AI agents, CI/CD automation logs
- Time-tracking: Toggl, Harvest, Clockify, Tempo
- HRIS (optional): Workday, BambooHR (for cost-per-hour normalization)

---

## Functional Requirements

### FR-1: Data Ingestion & Attribution Engine
- The system must ingest task-level effort data from connected integrations and tag each unit of work as `human`, `ai-assisted`, or `ai-automated`.
- Attribution logic must be configurable per organization (e.g., define what percentage of AI-accepted suggestions constitutes "AI-assisted").
- The system must deduplicate effort when both human and AI signals exist on the same artifact.

### FR-2: Resource Breakdown Dashboard
- Display a top-level summary card showing:
  - Total effort units (hours or story points)
  - Human share (% and absolute)
  - AI share (% and absolute), split into `AI-assisted` and `AI-automated`
- Support filtering by: date range, team, project, individual contributor, task type.
- Dashboard must refresh on a configurable cadence (real-time, daily, weekly snapshot).

### FR-3: Drill-Down Views
- Users must be able to click into any summary metric to see the underlying task list with individual attribution details.
- Each task/artifact must display: assignee, AI tool involved (if any), effort logged, attribution classification, and confidence score.

### FR-4: Cost Layer
- Map human effort to fully-loaded cost using configurable hourly rates (by role, seniority, or individual).
- Map AI effort to tooling cost using seat-license costs and/or consumption-based API spend.
- Render a cost comparison view: cost per story point / feature / PR for human vs. AI pathways.

### FR-5: Trend & Forecasting View
- Plot human vs. AI contribution ratio over time as a stacked area or line chart.
- Surface trend signals: increasing AI share, declining human logged hours, cost trajectory.
- Provide a simple linear forecast for the next period based on trailing data.

### FR-6: Export & Sharing
- Export any view to CSV (raw data) or PDF (formatted report).
- Generate a shareable, read-only link to a specific dashboard state (filters preserved).
- Support scheduled email delivery of the summary report (daily / weekly / monthly).

### FR-7: Permissions & Access Control
- Role-based access: `Admin`, `Manager`, `Viewer`.
- Managers see only their teams by default; Admins see org-wide.
- Individual contributor data must be aggregatable but individually identifiable data gated by Admin role.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a connected Jira project and GitHub Copilot account, the system correctly ingests and attributes effort within 24 hours of initial setup. |
| AC-2 | The top-level dashboard renders human vs. AI breakdown with <2s load time for datasets up to 10,000 tasks. |
| AC-3 | Attribution classification achieves ≥90% accuracy on a labeled test dataset of 500 mixed human/AI tasks, validated by QA. |
| AC-4 | Drill-down from a summary metric surfaces the correct underlying task list with matching aggregate totals (zero discrepancy). |
| AC-5 | Cost comparison view correctly calculates cost-per-story-point using configured hourly rates and returns results matching manual spot-check calculations within ±1%. |
| AC-6 | CSV export contains all fields shown in the UI view plus raw attribution confidence scores. |
| AC-7 | A Manager-role user cannot access individual contributor data for teams outside their reporting line. |
| AC-8 | Scheduled email report is delivered within 15 minutes of the configured send time. |
| AC-9 | Trend chart renders correctly for date ranges spanning 1 week to 24 months. |
| AC-10 | The system handles missing or incomplete integration data gracefully, surfacing a data-gap warning rather than silently skewing totals. |

---

## Out of Scope

- **Performance management or individual scoring:** This tool reports aggregate attribution, not individual productivity ratings. No score or ranking of individual contributors will be generated.
- **Real-time AI session monitoring:** Keystroke-level or session-level surveillance of how individuals interact with AI tools is explicitly excluded.
- **AI model training:** Effort data collected will not be used to train any internal or external ML model without a separate, explicit data-use agreement.
- **Full project management functionality:** This is a reporting and analytics layer; it does not replace Jira, Linear, or other PM tools.
- **Budget approval workflows:** Cost visibility is read-only; purchase orders, budget requests, or approval flows are out of scope.
- **Non-knowledge-work resource types:** Physical labor, manufacturing, or field operations tracking is not addressed in this version.
- **Multi-currency support:** Initial release targets single-currency organizations; FX conversion is a future enhancement.