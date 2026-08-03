> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #157
> _Each agent that updates this PRD signs its change below._
>
> **Signed:** Business Analyst (gap analysis + implementation plan, 2026-07-24)

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

## Gap Analysis — Existing Artifact Audit (2026-07-24)

### What Already Exists

| Capability | Existing Artifact | Coverage |
|---|---|---|
| **Health score (0–100)** | `frontend/src/lib/projectHealth.ts` → `computeProjectHealth()` | ✅ 0–100 score + 4-tier (healthy/watch/at_risk/critical) + overdue/blocked counts |
| **Multi-dimension inspection** | `frontend/src/lib/projectInspection.ts` → `computeProjectInspection()` | ✅ 5 dims (direction/planning/health/progress/execution), letter grade A–F, prescriptive recs |
| **Health visuals** | `frontend/src/components/ProjectHealth.tsx` (GaugeChart + DonutChart) | ✅ Reusable gauge + donut chart components |
| **Inspection report UI** | `frontend/src/components/ProjectInspection.tsx` → `ProjectInspectionReport` | ✅ Full slide-out report pattern |
| **Tool-based diagnostics** | `frontend/src/components/ProjectDiagnosticsTab.tsx` | ✅ DTO tools + architecture analysis runner |
| **Report generation (server)** | `api/src/presentation/routes/reportRoutes.ts` | ✅ 7 report types, schedule/subscription infra, cache-read-through |
| **HTML → PDF export** | `api/src/application/export/tabularExport.ts` | ✅ `toHtmlTable()` with inline styles → browser print-to-PDF |
| **Project 360 (server)** | `api/src/application/project/computeProject360.ts` | ✅ Aggregated project signals (referenced from projectRoutes) |
| **Overdue count** | `computeProjectHealth()` returns `overdue` count | ⚠️ Count only — no itemized list (names, dates) |
| **Project data signals** | `/api/projects` returns taskCount, completedTaskCount, overdueTaskCount, blockedTaskCount | ✅ Feeds all existing health computations |

### What Is Partially Covered

| PRD Requirement | Status | Gap |
|---|---|---|
| **Timeline section** | ⚠️ Partial | Tasks have `dueDate`/`startDate`, project has `dueDate`. ProjectInspection checks "has deadline" as binary. No RAG/timeline-trend/overdue-list per section. |
| **Budget section** | ❌ Missing | No budget ingestion/schema. `timeEntries` table exists for logged hours but no budget-baseline, burn-rate, or cost-variance data. |
| **Quality section** | ⚠️ Partial | `ProjectDiagnosticsTab` runs DTO quality tools, but results are separate per-tool runs — not aggregated into a single Quality RAG. No bug/defect ingestion. |
| **Risk section** | ⚠️ Partial | `blockedTaskCount` exists. `ProjectInspection` has recommendations but no severity × likelihood scoring for top-3 risks. No risk register. |
| **Team section** | ⚠️ Partial | `memberProfiles` + `teamMembers` tables exist. No team health metric (velocity, churn, availability RAG). |
| **Alignment section** | ⚠️ Partial | `initiativeId` + `linkedGoalCount` exist. ProjectInspection checks "has goals" as binary. No OKR-alignment score or strategic-fit RAG. |
| **RAG (red/yellow/green)** | ⚠️ Partial | HealthTier is 4-level, not 3-level RAG. No per-section state. No single "current state" per category. |
| **Trend (improving/worsening/stable)** | ❌ Missing | No historical snapshots. `computeProjectHealth` is point-in-time only. |
| **Anomaly detection** | ❌ Missing | No deviation-from-baseline logic. |
| **Top 3 risks** | ❌ Missing | No severity × likelihood model. |
| **What's Overdue (itemized)** | ❌ Missing | Overdue COUNT exists, but no list with task names/dates. |
| **PDF export** | ⚠️ Partial | `tabularExport.ts` pattern exists but not wired to diagnostic reports. |
| **Shareable link** | ❌ Missing | No `shareableLink` anywhere in codebase. |
| **Historical trend for health score** | ❌ Missing | No time-series storage for health snapshots. |

---

## Implementation Plan

### Phase 1 — Data Foundation (backend)

**New DB schema needed:**

1. **`project_diagnostic_snapshots`** — append-only table storing a point-in-time snapshot of all 6 category scores + the composite health score. This enables TREND (compare current vs. previous snapshot) and ANOMALY detection (deviation from rolling baseline).

   ```sql
   CREATE TABLE project_diagnostic_snapshots (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
     composite_score REAL NOT NULL,            -- 0–100
     timeline_score REAL,                      -- 0–100 per section
     budget_score REAL,
     quality_score REAL,
     risk_score REAL,
     team_score REAL,
     alignment_score REAL,
     timeline_state TEXT,                      -- red | yellow | green
     budget_state TEXT,
     quality_state TEXT,
     risk_state TEXT,
     team_state TEXT,
     alignment_state TEXT,
     overdue_items JSONB,                      -- [{id, title, dueDate, kind}]
     top_risks JSONB,                          -- [{title, severity, likelihood, score}]
     ingested_metrics JSONB,                   -- raw ingested data payload
     manual_answers JSONB,                     -- user-provided questionnaire answers
     generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```

2. **`project_diagnostic_share_links`** — shareable read-only links with optional expiry.

   ```sql
   CREATE TABLE project_diagnostic_share_links (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     snapshot_id UUID NOT NULL REFERENCES project_diagnostic_snapshots(id) ON DELETE CASCADE,
     token TEXT NOT NULL UNIQUE,               -- opaque URL token
     expires_at TIMESTAMPTZ,
     created_by TEXT NOT NULL REFERENCES users(id),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     accessed_at TIMESTAMPTZ
   );
   ```

**New API route (Hono on Cloudflare Workers):**

- `POST /api/projects/:id/diagnostic` — generate a new diagnostic snapshot (run all 6 category scorers, store snapshot, return full report)
- `GET /api/projects/:id/diagnostic/latest` — get the most recent snapshot
- `GET /api/projects/:id/diagnostic/history` — list historical snapshots for trend chart
- `GET /api/projects/:id/diagnostic/export/pdf` — return self-contained HTML (print-to-PDF, reuse `toHtmlTable` pattern)
- `POST /api/projects/:id/diagnostic/share` — create a shareable link
- `GET /api/diagnostic/shared/:token` — read-only access via share link (no auth required, token-scoped)
- `DELETE /api/diagnostic/shared/:token` — revoke a share link

**New application service:**

- `api/src/application/diagnostics/computeDiagnosticReport.ts` — the core scorer
  - **Timeline scorer:** overdue ratio, schedule variance (current date vs. target), milestone slippage
  - **Budget scorer:** (when budget data exists) burn rate vs. planned, cost variance — fallback: no-data = green
  - **Quality scorer:** aggregate DTO tool scores, blocked-task ratio, redo/reopen counts
  - **Risk scorer:** blocked-task ratio, overdue ratio, stale PR count, dependency chain health — produce severity × likelihood top-3
  - **Team scorer:** member availability (ooo count), velocity trend (completed/week), unassigned-task ratio
  - **Alignment scorer:** OKR linkage status, initiative alignment, goal coverage

### Phase 2 — Frontend (Next.js, App Router)

**New pages/components:**

1. **`frontend/src/app/projects/[id]/diagnostic/page.tsx`** — the report page
   - Renders the 6-section diagnostic report
   - "Generate Report" button (POSTs to API, stores snapshot)
   - "Export PDF" button (opens `/export/pdf` in new tab → browser print)
   - "Share" button → copy link to clipboard
   - Historical trend sparkline at top (composite score over time)

2. **`frontend/src/components/DiagnosticReport.tsx`** — the structured report component
   - Reuses `GaugeChart` for composite health score
   - Per-section: RAG badge, trend arrow (↑ improving / → stable / ↓ worsening), anomaly callout, supporting data table
   - "Top 3 Risks" card (severity × likelihood matrix)
   - "What's Overdue" table (task name, due date, status, days overdue)

3. **`frontend/src/lib/diagnosticReport.ts`** — shared types + helper (mirrors `projectHealth.ts` pattern)
   - `DiagnosticReport`, `SectionState`, `Trend`, `RiskItem`, `OverdueItem` types

4. **`frontend/src/components/charts/Sparkline.tsx`** — tiny trend sparkline (reusable, SVG-based)

### Phase 3 — Integration & Polish

- Wire the "Generate" action into the existing Project Details Panel (add a "Diagnostic Report" tab or action button)
- Add i18n keys for all 6 sections, RAG labels, trend labels
- Ensure the share link page renders read-only (no edit controls)
- Add diagnostic snapshots to the existing report schedule/subscription system so PMs can auto-generate weekly

### What to Reuse (do NOT rebuild)

| Reuse | Source | Notes |
|---|---|---|
| Health score computation | `computeProjectHealth()` | Already returns overdue/blocked counts — feed into diagnostic |
| Multi-dimension scoring pattern | `computeProjectInspection()` | Same weighted-score architecture, applied to 6 PRD categories |
| Report route pattern | `reportRoutes.ts` | Same Hono router, auth middleware, cache-read-through |
| HTML → PDF pattern | `tabularExport.ts` → `toHtmlTable()` | Same inline-style approach for diagnostic report |
| Visual components | `GaugeChart`, `DonutChart` | Already themed with `var(--accent)` etc. |
| Report scheduling | `reportSchedules`/`reportSubscriptions` | Add `report_type = 'diagnostic'` |
| Project data signals | `/api/projects` response fields | taskCount, overdueTaskCount, blockedTaskCount, etc. |

---

## Data Flow

```
User clicks "Generate Diagnostic Report"
  ↓
POST /api/projects/:id/diagnostic
  ↓
computeDiagnosticReport(db, projectId)
  ├─ Query tasks (overdue, blocked, completed counts + itemized overdue list)
  ├─ Query memberProfiles (team availability)
  ├─ Query project (deadline, initiativeId, goals)
  ├─ Query DTO tool results (quality scores)
  ├─ Query timeEntries (budget burn)
  ├─ Query previous snapshot (trend delta)
  ├─ Compute 6 category scores + RAG states + trends + anomalies
  ├─ Compute top-3 risks (severity × likelihood)
  ├─ Insert project_diagnostic_snapshots row
  └─ Return full DiagnosticReport JSON
  ↓
Frontend renders DiagnosticReport.tsx
  ├─ GaugeChart (composite score)
  ├─ Per-section cards (RAG + trend + anomalies + data)
  ├─ Top 3 Risks card
  ├─ What's Overdue table
  └─ Action bar (Export PDF, Share, Regenerate)
```

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Budget data may not exist for all projects | Budget section defaults to green + "No budget data ingested" note — not a blocker |
| Trend requires ≥2 snapshots to compute | First snapshot shows "—" for trend; second onwards show delta |
| Anomaly detection needs baseline | Use rolling 5-snapshot average; if <5 snapshots exist, skip anomaly flag |
| Share link security | Token is opaque UUID; expiry optional but encouraged; accessed_at logged |
| PDF rendering consistency | Use the same inline-style approach as `toHtmlTable()` (no external CSS) — tested across Chrome/Firefox/Safari print |

---

## Open Questions (for PM / stakeholder)

1. **Budget data source:** Is budget data ingested from an external system (e.g., QuickBooks, Harvest), manually entered per-project, or derived from `timeEntries` × `costRateUsdCents`? The latter is available now.
2. **Diagnostic questionnaire:** The PRD mentions "user-provided answers to diagnostic questions." Should this be a free-form questionnaire the PM fills out (like the existing DTO tools), or is it purely derived from ingested data? Recommendation: start data-driven with an optional "PM override" on each section.
3. **Snapshot cadence:** Should snapshots be generated on-demand only, or also scheduled (weekly)? The report scheduling infrastructure already supports this — recommend both, with weekly auto-snapshots as default.
