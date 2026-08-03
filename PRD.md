> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #157
> _Each agent that updates this PRD signs its change below._
>
> - **BA analysis (2026-07-25)** — Gap analysis, technical feasibility, and implementation plan appended. Signed: Business Analyst.

# Product Requirements Document: Diagnostic Report

## Problem & Goal

**Problem:** Project Managers and Leaders lack a consolidated, real-time view of project health, making it difficult to quickly identify risks, track trends, and understand the overall state of a project. This leads to reactive decision-making and potential project failures.

**Goal:** To enable PMs and Leaders to quickly understand a project's health and potential risks by providing a comprehensive, structured diagnostic report, generated through user input and ingested data, thereby facilitating proactive management and better project outcomes.

## Target users / ICP roles

*   **Project Managers (PMs):** Need a holistic view to manage their projects effectively.
*   **Team Leaders:** Require insights into team performance and project bottlenecks.
*   **Portfolio Managers / Senior Leadership:** Need high-level health snapshots across multiple projects to make strategic decisions.

## Scope

This feature encompasses the generation of a comprehensive diagnostic report, integrating user-provided answers and ingested project data. It includes the structured presentation of project health across predefined categories, visualization of trends and anomalies, highlighting of top risks, and identification of overdue items. The report will be accessible via a shareable link and exportable in PDF format, incorporating appropriate data visualizations.

## Functional Requirements

*   The system shall provide an interface for users to answer diagnostic questions related to project health.
*   The system shall ingest relevant project data from integrated sources (e.g., task trackers, bug databases, budget systems).
*   The system shall generate a structured diagnostic report based on user answers and ingested data.
*   The system shall categorize the report into predefined sections: Timeline, Budget, Quality, Risk, Team, and Alignment.
*   For each section, the system shall determine and display the "current state" (Red/Yellow/Green).
*   For each section, the system shall determine and display the "trend" (Improving/Worsening/Stable).
*   For each section, the system shall identify and display "anomalies" or significant deviations.
*   For each section, the system shall display "supporting data" (ingested or manually entered).
*   The system shall identify and prominently highlight the "top 3 risks" based on severity and likelihood scores.
*   The system shall calculate and display a composite "Project Health Score" (0-100) and its historical trend.
*   The system shall include a dedicated "What's Overdue?" section, listing tasks, bugs, or deadlines that are past their due dates.
*   The system shall allow users to export the generated report as a PDF document.
*   The system shall generate a shareable link for the diagnostic report, allowing read-only access.
*   The system shall utilize appropriate data visualizations (e.g., charts, tables, trend lines) to clearly present information within the report.

## Acceptance Criteria

*   Generate a structured report with sections mirroring the diagnostic categories: Timeline, Budget, Quality, Risk, Team, Alignment
*   Each section shows: current state (red/yellow/green), trend (improving/worsening/stable), anomalies, and supporting data (ingested or manual)
*   Highlight the top 3 risks (severity + likelihood)
*   Show a composite "Project Health Score" (0–100) and trend
*   Include a "What's Overdue?" section listing tasks, bugs, or deadlines past due
*   Allow exporting the report as PDF or sharing as a link

## Out of scope

*   Real-time continuous monitoring or alerting beyond the generation of the snapshot report.
*   Automated generation of prescriptive recommendations or action items (the report provides insights, not solutions).
*   Custom report template creation or extensive customization options for report structure.
*   Direct task assignment or project management capabilities within the report view.
*   Integration with all possible third-party project management tools beyond initial defined set.
*   Predictive analytics for future project states beyond current trends.

---

# BA Gap Analysis & Implementation Plan

**Analysis performed against branch `builderforce/task-157`, repo `seanhogg/builderforce.ai`, 2026-07-25.**

## 1. Existing Assets — What Already Serves This Need

| Asset | Location | What It Does | AC Coverage |
|---|---|---|---|
| `computeProjectHealth()` | `frontend/src/lib/projectHealth.ts` | Composite health score (0–100), health tier (healthy/watch/at_risk/critical), progress %, overdue/blocked counts. Erodes health by share of open work that is overdue/blocked. | ✅ Health Score (0–100), ✅ overdue count |
| `computeProjectInspection()` | `frontend/src/lib/projectInspection.ts` | Multi-dimension grading: Direction, Planning, Health, Progress, Execution. Letter grade A–F. Prescriptive recommendations sorted by urgency. | ⚠️ Partial — different dimensions from the six required categories |
| `ProjectHealthGauges` | `frontend/src/components/ProjectHealth.tsx` | Gauge chart (health score) + donut chart (progress %). Used on project cards, table, details panel. | ✅ Visual building block |
| `ProjectInspectionReport` | `frontend/src/components/ProjectInspection.tsx` | Full inspection report component with dimensions, grade, color-coded bars, recommendations. Slide-out panel pattern. | ✅ Report UI pattern to follow |
| `ProjectDiagnosticsTab` | `frontend/src/components/ProjectDiagnosticsTab.tsx` | Diagnostic tools tab: runs diagnostics (architecture analysis + registered tools), shows results in a slide-out panel. | ✅ Diagnostic run/result pattern |
| Report routes + scheduling | `api/src/presentation/routes/reportRoutes.ts` | Standup, code-review, executive summary, team comparison, inactive contributors, completed-by-assignee, portfolio rollup. Report schedule CRUD + subscriptions. | ✅ API pattern for report generation |
| `toHtmlTable()` | `api/src/application/export/tabularExport.ts` | Self-contained HTML document with inline styles — Excel and browser print-to-PDF compatible. | ✅ PDF export pattern (HTML → print-to-PDF) |
| `renderRfpDocHtml()` | `api/src/application/rfp/rfpBranding.ts` | Branded self-contained HTML document, print-to-PDF ready, same pattern. | ✅ PDF export pattern (HTML → print-to-PDF) |
| Project 360 page | `frontend/src/app/projects/[id]/360/page.tsx` | Route at `/projects/[id]/360` — the web surface for the whole-picture project health view. | ✅ Shareable link target |
| `computeProject360()` | `api/src/application/project/computeProject360.ts` | Server-side project 360 aggregate (loads live signals, assembles the model). | ✅ Backend computation infrastructure |
| `computeProjectDeliverySignals()` | `api/src/application/insights/projectDeliverySignals.ts` | Compact project delivery signals (task status breakdown) attached to `/api/projects` list. | ✅ Data ingestion pipeline |
| `tasks` table + `projects` table | `api/src/infrastructure/database/schema.ts` | Full task tracking with status, due dates, priorities, blocked state, assigned agents, sprints, releases. `projects` has `dueDate`, `status`, `governance`. | ✅ Core data source |
| Task status transitions history | `taskStatusTransitions` table in schema | Append-only lane-move log with timestamps → enables trend analysis (time-in-status, cycle time). | ✅ Trend data source |
| Workforce profiles + time entries | `memberProfiles`, `timeEntries` tables | Member capacity, skills, cost rates, logged effort. | ✅ Team-section data source |
| Product releases | `productReleases` table in `schema/delivery.ts` | Release tracking with dates, status, scope. | ✅ Timeline data source |

## 2. Gap Inventory — What Is Missing

### GAP-1: Six Required Diagnostic Categories Not Implemented
The PRD requires sections for **Timeline, Budget, Quality, Risk, Team, Alignment**. The existing `computeProjectInspection` uses different dimensions (Direction, Planning, Health, Progress, Execution). These are not 1:1 mappable:
- **Timeline** → Partially covered by "Planning" (scheduling) and the tasks table's due dates, but no dedicated timeline section with trend/anomaly analysis.
- **Budget** → No budget tracking exists in the schema. `timeEntries` has cost rates for labor but no project-level budget vs. actual. This is the largest structural gap.
- **Quality** → No quality metrics exist (bug counts, redo rate, test coverage). `taskStatusTransitions` has `isBackward` (redo signal) but no bug/quality data.
- **Risk** → No formal risk model (severity × likelihood). `computeProjectInspection` has recommendations ranked by priority, not a risk register.
- **Team** → `memberProfiles` and `timeEntries` provide team data, but no team-health analysis (burnout signals, capacity vs. load, velocity).
- **Alignment** → Partially covered by "Direction" (vision, goals/OKRs, architecture PRD), but no explicit alignment-to-strategy section.

**Severity: Critical.** These six sections are the core deliverable.

### GAP-2: Per-Section RAG State + Trend + Anomalies
The codebase has health tiers (`healthy`/`watch`/`at_risk`/`critical`) mapped to colors, but no per-section RAG (Red/Yellow/Green) determination, no trend direction (improving/worsening/stable), and no anomaly detection logic. The task status transitions table provides the raw data for trend calculation.

**Severity: High.** This is the primary visual output of the report.

### GAP-3: Top 3 Risks (Severity × Likelihood)
No risk register or risk-scoring model exists. The `computeProjectInspection` recommendations are prescriptive "what to target" items, not formal risks with severity and likelihood scores.

**Severity: High.** Explicitly required by AC.

### GAP-4: "What's Overdue?" Item-Level Listing
`computeProjectHealth` returns an `overdue` **count** (number) but does not list the individual overdue tasks/bugs/deadlines. The API needs a query that returns overdue task rows with titles, due dates, and assignees.

**Severity: Medium.** The count exists; the listing is a new query.

### GAP-5: Diagnostic Questions Interface
The PRD requires "an interface for users to answer diagnostic questions related to project health." The codebase has diagnostic **tools** (calculators, questionnaires, quizzes — see `frontend/src/lib/tools.ts`) but no project-health-specific diagnostic questionnaire UI.

**Severity: Medium.** The tool infrastructure exists; a new questionnaire definition + UI is needed.

### GAP-6: PDF Export of Diagnostic Report
The codebase has HTML → print-to-PDF patterns (`tabularExport.ts`, `rfpBranding.ts`) but no diagnostic-report-specific export. A new API endpoint or client-side print-to-PDF must be built.

**Severity: Medium.** The patterns are proven; implementation is wiring.

### GAP-7: Shareable Link
No dedicated shareable-link mechanism for the diagnostic report. The existing `/projects/[id]/360` route could serve as the target if made publicly readable, but there is no token-based or read-only share link infrastructure.

**Severity: Low.** The 360 page provides a link target; sharing requires auth scoping.

### GAP-8: Budget Data Source
No budget table exists in the schema. The `timeEntries` table captures logged effort × cost rate (labor cost), but there is no project budget baseline, no actual-vs-budget tracking, and no financial data ingestion from external budget systems.

**Severity: Critical for Budget section.** Without budget data, the Budget section would be limited to labor cost estimates from time entries only.

## 3. Data Visualization Recommendations

Based on the report structure and existing chart components (`GaugeChart`, `DonutChart`, `BandedMetricBar`), the following visualizations are recommended:

| Section | Primary Visualization | Supporting Elements |
|---|---|---|
| Overview (top) | **GaugeChart** for Health Score + **sparkline** for trend | DonutChart for progress % |
| Timeline | **Horizontal bar chart** — tasks by status with due-date markers. Overdue items highlighted in red. | Trend arrow, anomaly callout for stalled/slipping tasks |
| Budget | **Budget-vs-actual bar** (if data exists) or **cost-rate sunburst**. Fallback: labor cost table from time entries. | Trend comparison to prior period |
| Quality | **Redo-rate sparkline** (from taskStatusTransitions `isBackward`). Bug count if available. | Anomaly: redo spike |
| Risk | **Risk matrix** (2×2: severity × likelihood). Top 3 risks as prominent cards. | Color-coded severity badges |
| Team | **Capacity-vs-load donut** per member. Availability status indicators. | Velocity trend (completed/week) |
| Alignment | **Checklist/scorecard** — vision, goals/OKRs, architecture PRD, initiative link. Color-coded completeness. | Gap indicators |
| What's Overdue? | **Sorted table** — task title, due date, days overdue, assignee, priority badge. | Count badge in section header |

All visualizations should use the existing chart color conventions (`#22c55e` healthy, `#eab308` watch, `#f59e0b` at_risk, `#ef4444` critical) for consistency.

## 4. Architecture Recommendation

### Backend (API)

```
api/src/
  application/
    reports/
      diagnosticReport.ts        ← NEW: Pure computation — assembles the six sections
      diagnosticReport.test.ts   ← NEW: Unit tests
  presentation/
    routes/
      reportRoutes.ts            ← EDIT: Add GET /api/reports/diagnostic/:projectId
```

**`diagnosticReport.ts`** — a pure function module (like `computeProjectInspection`) that:
1. Accepts a project aggregate (task breakdown, member profiles, time entries, status transitions, release data)
2. Computes each of the six sections with RAG state, trend, anomalies, and supporting data
3. Returns a typed `DiagnosticReport` object

**`GET /api/reports/diagnostic/:projectId`** — queries the database for all needed data, calls the pure computation, caches the result, and returns JSON. Also supports `?format=html` for the print-to-PDF document (reusing the `toHtmlTable`/`rfpBranding` pattern).

### Frontend

```
frontend/src/
  lib/
    diagnosticReport.ts          ← NEW: Client-side computation mirror + types
  components/
    DiagnosticReport/
      DiagnosticReport.tsx        ← NEW: Full report component
      DiagnosticSection.tsx       ← NEW: One section card (RAG + trend + anomalies + data)
      DiagnosticRiskMatrix.tsx    ← NEW: Risk matrix + top-3 cards
      DiagnosticOverdueTable.tsx  ← NEW: Sorted overdue-items table
      DiagnosticScoreTrend.tsx    ← NEW: Health score sparkline/trend
    ProjectDiagnosticsTab.tsx     ← EDIT: Add "Diagnostic Report" row linking to the report
  app/
    projects/[id]/diagnostic/
      page.tsx                    ← NEW: Diagnostic report page route
```

### PDF Export

Reuse the `api/src/application/export/tabularExport.ts` pattern: render the report as a self-contained HTML document (inline styles, no external assets), serve it at `GET /api/reports/diagnostic/:projectId?format=html`, and let the browser's print-to-PDF handle conversion. The frontend adds a "Download PDF" button that opens this URL in a new tab with `window.print()` auto-triggered.

### Shareable Link

The report page at `/projects/[id]/diagnostic` is the natural share target. For read-only sharing to non-members, add a short-lived signed token parameter (`?token=...`) validated by the API — this is deferred to a follow-up task (see GAP-7 note below).

## 5. Implementation Phasing

### Phase 1 — Core Computation & API (MVP)
**Deliverable:** Backend module that produces a complete `DiagnosticReport` JSON.
- [ ] `api/src/application/reports/diagnosticReport.ts` — Pure computation
- [ ] `GET /api/reports/diagnostic/:projectId` — API endpoint
- [ ] Covers: Timeline, Team, Alignment, Health Score, Overdue list (sections with available data)
- [ ] Budget and Quality sections return "no data available" stub until data sources exist

### Phase 2 — Frontend Report UI
**Deliverable:** Rendered report with all six sections, visualizations, and export.
- [ ] `DiagnosticReport` component tree
- [ ] GaugeChart + sparkline for health score trend
- [ ] Per-section cards with RAG badge, trend arrow, anomaly callout, supporting data table
- [ ] Risk matrix + top-3 risk cards
- [ ] Overdue items table
- [ ] PDF export button (HTML → print-to-PDF)
- [ ] Share link (copy-to-clipboard of the report URL)

### Phase 3 — Diagnostic Questions Interface
**Deliverable:** User-facing questionnaire that feeds into the report.
- [ ] New tool definition (kind: `questionnaire`) for project health diagnostic
- [ ] UI at `/tools/diagnostic?project=:id`
- [ ] Answers stored and merged into the report's supporting data

### Phase 4 — Budget & Quality Data Sources
**Deliverable:** Real data for Budget and Quality sections.
- [ ] `project_budgets` table (budget baseline, actuals, period) — requires schema migration
- [ ] Quality metrics from `taskStatusTransitions` (redo rate, cycle time outliers)
- [ ] Bug tracking integration (GitHub issues with `bug` label, or a `project_bugs` table)

## 6. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Budget section has no data source | High | Phase 1 ships with labor-cost estimate from `timeEntries`; Phase 4 adds proper budget table. The section renders "budget data not configured" rather than crashing. |
| Trend computation requires historical snapshots that don't exist | Medium | Derive trends from `taskStatusTransitions` history (time-in-status deltas) and compare current period to prior period (e.g., last 30 days vs. 30–60 days ago). No snapshot storage needed. |
| Shareable link requires auth model changes | Low | Phase 1 uses the existing auth-gated page URL. Read-only sharing tokens deferred to follow-up. |
| Questionnaire UX may diverge from existing tool runner | Low | Reuse the `ToolRunner` component pattern from `frontend/src/app/tools/[id]/page.tsx`; define the diagnostic as a tool registered in the tools API. |

## 7. Open Questions for PM

1. **Budget data source:** Should Phase 1 include a new `project_budgets` table, or should it start with labor-cost estimates from `timeEntries` and defer the budget table? Recommendation: start with time-entries labor cost, add the budget table in Phase 4.
2. **Diagnostic questions:** Should the questionnaire be part of the initial MVP (Phase 3), or can it ship post-MVP? Recommendation: defer to Phase 3 — the report is valuable with ingested data alone.
3. **Share permissions:** Should the shareable link require Builderforce authentication, or should it support unauthenticated read-only access? Recommendation: auth-gated initially (the 360 page pattern), unauthenticated tokens deferred.
4. **Bug tracking:** Is there a planned GitHub Issues integration for bug counts, or should we add a `project_bugs` table? The `projects` table already has `githubRepoUrl`/`githubRepoName` — a GitHub Issues integration is the natural path.
