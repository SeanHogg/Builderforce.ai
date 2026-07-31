> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #297
> _Each agent that updates this PRD signs its change below._

# PRD: Quality Health Dashboard

## Problem & Goal

Engineering teams lack a unified, at-a-glance view of software quality trends. Bug data lives in issue trackers, test results scatter across CI pipelines, and regression signals are buried in release notes. Without consolidated visibility, teams react to quality degradation too late, ship with unknown risk, and struggle to demonstrate improvement over time.

**Goal:** Deliver a Quality Health dashboard that surfaces bug counts, trend direction, open/closed ratios, regression rates, and test coverage in a single, continuously updated view — enabling teams to detect quality drift early and make data-driven release decisions.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Portfolio-level quality signal; team accountability |
| QA Lead | Regression tracking, coverage gaps, daily triage |
| Staff / Principal Engineer | Trend analysis to prioritize technical debt |
| Product Manager | Release-readiness confidence; stakeholder reporting |
| DevOps / Release Engineer | Go/no-go gating based on quality thresholds |

---

## Scope

### In Scope

- Bug inventory metrics (total, by severity, by component)
- Bug trend visualization (time-series, improving/worsening classification)
- Open vs. closed ratio tracking with configurable time windows
- Regression rate calculation per release / sprint
- Test coverage percentage with per-module breakdown
- Configurable thresholds and alerting for metric breaches
- Integration with common issue trackers and CI systems (see Functional Requirements)
- Role-appropriate views (summary card vs. drill-down detail)

### Out of Scope

_(see dedicated section below)_

---

## Functional Requirements

### FR-1: Bug Count

- **FR-1.1** Display total open bug count segmented by severity (Critical, High, Medium, Low).
- **FR-1.2** Display total open bug count segmented by component / service / team label.
- **FR-1.3** Support filtering by date range, assignee, label, and milestone.
- **FR-1.4** Refresh data on a configurable schedule (default: every 15 minutes); support manual refresh.

### FR-2: Bug Trend

- **FR-2.1** Render a time-series line chart of open bug count over selectable windows (7d, 14d, 30d, 90d, custom).
- **FR-2.2** Compute and display a trend indicator — **Improving** (net decrease), **Stable** (±5% variance), or **Worsening** (net increase) — based on a configurable rolling window.
- **FR-2.3** Overlay release/deployment markers on the trend chart to correlate quality shifts with deployments.
- **FR-2.4** Surface anomaly detection: flag any single-day spike exceeding a configurable threshold (default: +20% day-over-day).

### FR-3: Open vs. Closed Ratio

- **FR-3.1** Calculate and display the ratio of open bugs to bugs closed within the selected time window.
- **FR-3.2** Show absolute counts alongside the ratio (e.g., 42 open / 18 closed = 2.3 : 1).
- **FR-3.3** Render a stacked bar or donut chart for visual proportion.
- **FR-3.4** Highlight in red when ratio exceeds a user-configurable threshold (default: 2 : 1).

### FR-4: Regression Rate

- **FR-4.1** Define a regression as a bug filed against a feature or component that was marked fixed/closed within the same or previous release cycle.
- **FR-4.2** Display regression rate as a percentage: `(regression bugs / total bugs filed in period) × 100`.
- **FR-4.3** Show regression rate per release tag and per sprint/iteration.
- **FR-4.4** Surface top-5 components with the highest regression concentration.
- **FR-4.5** Alert when regression rate for any release exceeds a configurable threshold (default: 10%).

### FR-5: Test Coverage

- **FR-5.1** Ingest coverage reports (LCOV, Cobertura, JaCoCo, Istanbul/NYC) from CI artifacts.
- **FR-5.2** Display overall line, branch, and function coverage percentages.
- **FR-5.3** Show per-module / per-package coverage breakdown in a sortable table, highlighting modules below a configurable floor (default: 80%).
- **FR-5.4** Render a trend line of overall coverage over time.
- **FR-5.5** Block (or warn on) pull requests when coverage delta drops below a configurable minimum change threshold (default: −2%).

### FR-6: Integrations

- **FR-6.1** Issue tracker connectors: GitHub Issues, Jira, Linear, Azure DevOps Boards.
- **FR-6.2** CI/CD connectors: GitHub Actions, GitLab CI, Jenkins, CircleCI, Buildkite.
- **FR-6.3** Provide a REST/webhook ingestion endpoint for custom or unsupported sources.
- **FR-6.4** OAuth 2.0 / API token authentication for all third-party connections.

### FR-7: Alerts & Notifications

- **FR-7.1** Support notification channels: email, Slack, Microsoft Teams, PagerDuty webhook.
- **FR-7.2** Allow per-metric threshold configuration at organization, project, and team level.
- **FR-7.3** Notifications must include metric name, current value, threshold breached, and a deep link to the relevant dashboard view.

### FR-8: Access & Permissions

- **FR-8.1** Role-based access: Admin (configure), Editor (annotate), Viewer (read-only).
- **FR-8.2** Project-level visibility scoping so teams only see their own data by default.
- **FR-8.3** SSO support via SAML 2.0 and OIDC.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Bug counts match the source issue tracker within one refresh cycle (≤15 min lag) | Automated data reconciliation test against live Jira/GitHub fixture |
| AC-2 | Trend indicator correctly classifies Improving / Stable / Worsening on a dataset with known outcomes | Unit test suite covering all three classifications and edge cases |
| AC-3 | Open/closed ratio turns red and triggers a notification when ratio exceeds configured threshold | Integration test; threshold set to 1.5:1 with simulated data breach |
| AC-4 | Regression rate calculation is accurate to ±0.1% against manually audited sample datasets | QA sign-off on three representative projects |
| AC-5 | Coverage ingestion parses LCOV, Cobertura, JaCoCo, and Istanbul reports without data loss | Fixture-based parser tests with known coverage percentages |
| AC-6 | PR coverage gate blocks merge when coverage drops more than configured delta | End-to-end test in GitHub Actions sandbox |
| AC-7 | Dashboard loads initial paint in ≤2 seconds on a dataset of 10,000 bugs (p95, broadband) | Lighthouse / k6 performance test |
| AC-8 | All charts render correctly on Chrome, Firefox, Safari (latest stable), and mobile viewport ≥375px | Cross-browser automated UI tests (Playwright) |
| AC-9 | RBAC prevents Viewer role from modifying thresholds or integrations | Permission test matrix, automated + manual review |
| AC-10 | Anomaly spike alert fires within one polling cycle of a simulated day-over-day spike >20% | Integration test with mocked data injection |

---

## Out of Scope

- **Root-cause analysis or AI-generated fix suggestions** — the dashboard reports metrics; it does not diagnose causes.
- **Test case management** (writing, organizing, or executing test plans) — coverage data is ingested, not managed.
- **Performance / load testing metrics** — latency, throughput, and error rates are out of scope for this quality health view.
- **Security vulnerability tracking** (CVEs, SAST/DAST findings) — handled by a separate Security Health dashboard.
- **Customer-facing status pages** — this is an internal engineering tool only.
- **Billing, seat management, or subscription tiers** — handled by platform infrastructure team.
- **Historical data migration** from pre-existing dashboards beyond a configurable lookback window (default: 12 months).

---

## Implementation Notes

— **Developer: Code Creator agent · task #297**

### Architecture Overview

This feature adds a **Quality Health** sub-domain to the existing Quality pillar. The current pillar (`api/src/application/quality/`) handles production error observability: error ingestion, fingerprint grouping, triage, and fix-with-agent dispatch. The new sub-domain is complementary and orthogonal — it tracks **bug inventory from issue trackers**, **test coverage from CI artifacts**, and derives **trend / ratio / regression metrics** from that data. No existing error-observability code is modified; new code lives alongside it and reuses the platform's chart primitives, caching layer, auth middleware, project-scoping context, and integration credential patterns.

Reusable assets:
- **Charts**: `TrendChart`, `DonutChart`, `BarChart`, `GaugeChart` (all hand-rolled SVG in `frontend/src/components/charts/`)
- **Caching**: `readThroughCache` with per-project version-token invalidation (as used by `qualityRoutes.ts`)
- **Auth**: `authMiddleware` (Hono) + `RoleGate` component
- **Project scoping**: `useProjectScope` context
- **Integration patterns**: `encryptCredentials`/`decryptCredentials` + per-provider webhook secret management (as in `qualityRoutes.ts` collector integrations)
- **UI patterns**: `QualityStatsPanel` (self-fetching, chart-driven summary), `QualityDashboard` (filterable paginated list), `dataTableStyles`, `Badge`, `SlideOutPanel`, `Select`, `ViewToggle`
- **Schema**: barrel re-export at `api/src/infrastructure/database/schema.ts` (split modules under `schema/`)

---

### Data Model (new tables)

All tables are tenant-scoped with `tenant_id INTEGER REFERENCES tenants(id)`. New migration file: `api/migrations/0260_quality_health.sql`.

| Table | Purpose | Key columns |
|---|---|---|
| `quality_bug_snapshots` | Periodic snapshots of bug counts from issue trackers — the time-series source for FR-1/FR-2/FR-3 | `tenant_id`, `project_id`, `source` (github_issues \| jira \| linear \| azure_devops \| custom), `source_issue_id`, `title`, `severity`, `status` (open \| closed), `component`, `assignee`, `labels` (jsonb), `milestone`, `release_tag`, `opened_at`, `closed_at`, `snapshot_at` |
| `quality_coverage_reports` | Per-commit coverage summaries ingested from CI artifacts (FR-5) | `tenant_id`, `project_id`, `commit_sha`, `report_format` (lcov \| cobertura \| jacoco \| istanbul), `line_pct`, `branch_pct`, `function_pct`, `module_breakdown` (jsonb → `[{name, linePct, branchPct, functionPct}]`), `ingested_at` |
| `quality_threshold_configs` | Per-entity threshold overrides for alerting (FR-7.2) | `tenant_id`, `scope_type` (org \| project \| team), `scope_id`, `metric_key` (open_closed_ratio \| regression_rate \| coverage_floor \| anomaly_spike_pct \| coverage_delta), `threshold_value`, `enabled` |
| `quality_integration_configs` | OAuth2 / API-token connections for issue trackers + CI systems (FR-6) | `tenant_id`, `project_id`, `provider` (github \| jira \| linear \| azure_devops \| github_actions \| gitlab_ci \| jenkins \| circleci \| buildkite), `credential_enc`, `credential_iv`, `config` (jsonb — base URLs, org/project mappings), `sync_schedule_minutes` (default 15) |
| `quality_regression_events` | Materialised regression classifications (FR-4) — a bug that was closed then re-opened or re-filed against the same component/release | `tenant_id`, `project_id`, `bug_snapshot_id` (FK to `quality_bug_snapshots`), `release_tag`, `component`, `classified_at` |
| `quality_alert_log` | Fired alert audit trail (FR-7.3) | `tenant_id`, `project_id`, `metric_key`, `current_value`, `threshold_value`, `channel` (email \| slack \| teams \| pagerduty), `fired_at`, `acknowledged_at` |

Add new Drizzle schema module: `api/src/infrastructure/database/schema/qualityHealth.ts`; re-exported from the barrel `schema.ts`.

---

### Backend implementation plan

#### 1. Ingestion layer — `api/src/application/qualityHealth/`

| File | Purpose |
|---|---|
| `ingestBugs.ts` | Poll issue tracker APIs (GitHub Issues, Jira, Linear, Azure DevOps), normalise to `quality_bug_snapshots` rows, store a snapshot per polling cycle. Uses the same credential-decrypt pattern as `qualityRoutes.ts` Sentry backfill. |
| `ingestCoverage.ts` | Parse LCOV / Cobertura / JaCoCo / Istanbul reports into `quality_coverage_reports`. Expose `parseCoverageReport(buffer, format)` — pure functions, fixture-testable (AC-5). |
| `classifyRegressions.ts` | For each bug marked closed in the window, check whether a new open bug references the same component + release tag. Writes `quality_regression_events`. Pure summary function `computeRegressionRate( bugs, regressions, windowDays )` for unit testing (AC-4). |
| `trendClassifier.ts` | Pure: `classifyTrend(snapshots: number[], windowDays: number, variancePct: number)` → `'improving' | 'stable' | 'worsening'`. Linear regression over the rolling window; ±variancePct threshold (default 5%). Unit-testable (AC-2). |
| `anomalyDetector.ts` | Pure: `detectAnomalies(dailyCounts: number[], thresholdPct: number)` → `[{day, count, pctChange}]`. Flags days where count exceeds previous day by >thresholdPct (default 20%). Unit-testable (AC-10). |
| `openClosedRatio.ts` | Pure: `computeRatio(open: number, closed: number)` → `{ratio, open, closed, exceedsThreshold}`. Trivial but extracted for testing (AC-3). |
| `qualityHealthInsights.ts` | Lens-style aggregator mirroring `qualityInsights.ts`: pure `summarizeQualityHealth(…)` + I/O `computeQualityHealthInsights(db, tenantId, projectId, windowDays)`. Returns bug counts by severity/component, trend classification, open/closed ratio, regression rate, coverage percentages, anomaly flags. |

#### 2. API routes — `api/src/presentation/routes/qualityHealthRoutes.ts`

New Hono router mounted at `/api/quality-health` (alongside existing `/api/quality`). Follows the exact pattern of `qualityRoutes.ts`: `authMiddleware`, per-tenant scoping, read-through cache with version tokens.

| Endpoint | FR | Notes |
|---|---|---|
| `GET /insights` | FR-1..5 aggregate | Query params: `projectId`, `windowDays` (7\|14\|30\|90), `component`, `assignee`, `milestone`. Cached. Returns the full `QualityHealthInsights` payload. |
| `GET /bugs` | FR-1.3 | Paginated bug list with filters: `severity`, `component`, `assignee`, `label`, `milestone`, `status`, `dateFrom`, `dateTo`. Keyset-paginated (mirrors `/api/quality/groups`). |
| `GET /trend` | FR-2 | Query params: `windowDays`, `rollup` (daily\|weekly). Returns `{points: [{date, count}], classification, anomalies: [{date, pctChange}]}`. |
| `GET /coverage` | FR-5.2/FR-5.3 | Returns `{latest: {line, branch, function}, trend: [{date, line}], modules: [{name, line, branch, function, belowFloor}]}`. |
| `GET /regressions` | FR-4.3/FR-4.4 | Returns `{rate, byRelease: [{tag, rate}], bySprint: [{name, rate}], topComponents: [{component, count}]}`. |
| `GET /ratio` | FR-3 | Returns `{open, closed, ratio, exceedsThreshold, windowDays}`. |
| `POST /ingest/coverage` | FR-5.1 | Accepts multipart upload of coverage report. Detects format from content, parses, stores. Also the webhook endpoint for CI systems that POST reports. |
| `GET /integrations` | FR-6 | List configured integrations for the tenant/project (no secrets). |
| `POST /integrations` | FR-6.4 | Attach/update an integration (stores encrypted credentials, mirroring `qualityRoutes.ts` POST `/collectors/:id/integrations`). |
| `DELETE /integrations/:id` | FR-6 | Detach an integration. |
| `GET /thresholds` | FR-7.2 | List threshold configs for the scoped entity. |
| `PUT /thresholds` | FR-7.2 | Upsert threshold configs (Admin only). |
| `GET /alerts` | FR-7.3 | Paginated alert log. |
| `POST /refresh` | FR-1.4 | Trigger immediate re-poll of issue tracker / CI data. Queues an async job and returns 202. |

#### 3. Threshold evaluator + alert dispatcher — `api/src/application/qualityHealth/alertEngine.ts`

Runs after every snapshot ingest (or on a cron). Evaluates each configured threshold against current metrics. When breached: writes `quality_alert_log`, sends notification via existing channel adapters (Slack webhook, email via the platform mailer, Teams webhook, PagerDuty). Follows the existing `dispatchCloudRunForTask` pattern for async dispatch.

#### 4. PR coverage gate — `api/src/application/qualityHealth/coverageGate.ts`

Called as a GitHub App / GitLab webhook on PR open/sync. Compares the PR's coverage delta against `coverage_delta` threshold. Returns a check-run status (pass / warning / block). The GH App integration already exists in the platform (`agent-runtime/` GitHub App), so this adds a new check-run type.

---

### Frontend implementation plan

#### New components — `frontend/src/components/qualityHealth/`

| File | FR | Notes |
|---|---|---|
| `QualityHealthDashboard.tsx` | All | Top-level dashboard page. Layout: summary cards row → trend chart → two-column grid (ratio donut + regression breakdown) → coverage table. Uses `useProjectScope` for project filtering and `windowDays` state with a `Select` for time-window picker (mirrors `QualityDashboard.tsx`). |
| `BugCountSummary.tsx` | FR-1 | Summary card: total open bugs, segmented by severity (colored badges). Click drills into filtered bug list. |
| `BugTrendPanel.tsx` | FR-2 | Wraps `TrendChart` with window selector (7d/14d/30d/90d). Renders the trend indicator badge (green Improving / amber Stable / red Worsening). Overlays release markers as vertical dashed lines. Anomaly spikes render as red dot markers on the chart. |
| `OpenClosedRatioPanel.tsx` | FR-3 | Renders `DonutChart` (open vs closed segments) + absolute count labels. Turns the ratio label red when above threshold. |
| `RegressionRatePanel.tsx` | FR-4 | Renders `BarChart` for per-release regression rate + a top-5 components table using `dataTableStyles`. Highlights rows above 10% threshold. |
| `CoveragePanel.tsx` | FR-5 | Overall coverage gauge (uses `GaugeChart` for line coverage). Per-module sortable table with red highlight on modules below 80% floor. Coverage trend via `TrendChart`. |
| `ThresholdConfigForm.tsx` | FR-7.2 | Admin-only form (gated by `RoleGate` with capability `qualityHealth.configureThresholds`). Per-metric slider/input with scope selector (org/project/team). |
| `IntegrationConfigPanel.tsx` | FR-6 | Lists configured integrations; add/remove via `SlideOutPanel` with provider selector (GitHub/Jira/Linear/etc.). Mirrors the `QualityCollectorsManager` pattern. |

#### Page entry point — `frontend/src/app/quality-health/page.tsx`

New Next.js App Router page. Thin wrapper that renders `<QualityHealthDashboard />` inside the project layout (reuses existing `QualityClient.tsx` pattern — `'use client'` boundary, suspense boundary for loading). Registered in the navigation alongside the existing Quality page.

#### Dashboard integration — `frontend/src/components/dashboard/`

Add `DashboardQualityHealthTab.tsx` as a companion to the existing `DashboardQualityTab.tsx`. Re-exports from `dashboard/index.ts`. This tab renders the summary-card view of QualityHealthDashboard (bug count, ratio, coverage, trend indicator) — the "at a glance" version for the main project dashboard.

#### i18n

Add translation keys under `qualityHealth` namespace in the existing `messages/` locale files. Key groups:
- `qualityHealth.title`, `qualityHealth.bugCount`, `qualityHealth.trend.*`, `qualityHealth.ratio.*`, `qualityHealth.regression.*`, `qualityHealth.coverage.*`
- `qualityHealth.thresholds.*`, `qualityHealth.integrations.*`, `qualityHealth.alerts.*`
- Chart labels, status badges, severity levels

---

### Integration connectors

Each connector follows the existing `qualitySourceCatalog.ts` pattern: a static catalog entry with `provider`, `label`, `supportsWebhook`, `supportsPull`, `authType`. Per-connector pull logic lives in `api/src/application/qualityHealth/connectors/`:

| File | Provider |
|---|---|
| `githubIssuesConnector.ts` | GitHub Issues — REST API v3, search/issues endpoint, label-based bug classification |
| `jiraConnector.ts` | Jira Cloud — REST API v3, JQL for issue type=Bug |
| `linearConnector.ts` | Linear — GraphQL API, issues query with bug label filter |
| `azureDevOpsConnector.ts` | Azure DevOps Boards — REST API, work items query |
| `githubActionsCoverage.ts` | GitHub Actions — downloads coverage artifact from workflow run, parses + ingests |
| `gitlabCiCoverage.ts` | GitLab CI — Pipeline artifacts API, coverage regex from `.gitlab-ci.yml` |
| `genericCoverageWebhook.ts` | Fallback: accepts multipart POST of coverage report body (FR-6.3) |

---

### Files changed / created summary

| Operation | Path | Notes |
|---|---|---|
| **MODIFY** | `PRD.md` | Author Implementation Notes (this section) |
| **CREATE** | `api/migrations/0260_quality_health.sql` | New tables: bug_snapshots, coverage_reports, threshold_configs, integration_configs, regression_events, alert_log |
| **CREATE** | `api/src/infrastructure/database/schema/qualityHealth.ts` | Drizzle schema for the above tables |
| **MODIFY** | `api/src/infrastructure/database/schema.ts` | Re-export qualityHealth module |
| **CREATE** | `api/src/application/qualityHealth/ingestBugs.ts` | Issue tracker poll + normalise |
| **CREATE** | `api/src/application/qualityHealth/ingestCoverage.ts` | Coverage report parsers (LCOV/Cobertura/JaCoCo/Istanbul) |
| **CREATE** | `api/src/application/qualityHealth/ingestCoverage.test.ts` | Fixture-based parser tests (AC-5) |
| **CREATE** | `api/src/application/qualityHealth/classifyRegressions.ts` | Regression detection + rate calculation |
| **CREATE** | `api/src/application/qualityHealth/classifyRegressions.test.ts` | Unit tests for regression rate (AC-4) |
| **CREATE** | `api/src/application/qualityHealth/trendClassifier.ts` | Improving/Stable/Worsening classification |
| **CREATE** | `api/src/application/qualityHealth/trendClassifier.test.ts` | Unit tests for trend classification (AC-2) |
| **CREATE** | `api/src/application/qualityHealth/anomalyDetector.ts` | Day-over-day spike detection |
| **CREATE** | `api/src/application/qualityHealth/anomalyDetector.test.ts` | Unit tests for anomaly detection (AC-10) |
| **CREATE** | `api/src/application/qualityHealth/openClosedRatio.ts` | Ratio computation + threshold check |
| **CREATE** | `api/src/application/qualityHealth/openClosedRatio.test.ts` | Unit tests for ratio (AC-3) |
| **CREATE** | `api/src/application/qualityHealth/qualityHealthInsights.ts` | Lens aggregator (pure + I/O) |
| **CREATE** | `api/src/application/qualityHealth/alertEngine.ts` | Threshold evaluator + notification dispatch |
| **CREATE** | `api/src/application/qualityHealth/coverageGate.ts` | PR coverage-delta check |
| **CREATE** | `api/src/application/qualityHealth/connectors/githubIssuesConnector.ts` | GitHub Issues pull connector |
| **CREATE** | `api/src/application/qualityHealth/connectors/jiraConnector.ts` | Jira Cloud pull connector |
| **CREATE** | `api/src/application/qualityHealth/connectors/linearConnector.ts` | Linear GraphQL pull connector |
| **CREATE** | `api/src/application/qualityHealth/connectors/azureDevOpsConnector.ts` | Azure DevOps Boards pull connector |
| **CREATE** | `api/src/application/qualityHealth/connectors/githubActionsCoverage.ts` | GH Actions coverage artifact pull |
| **CREATE** | `api/src/application/qualityHealth/connectors/gitlabCiCoverage.ts` | GitLab CI coverage pull |
| **CREATE** | `api/src/application/qualityHealth/connectors/genericCoverageWebhook.ts` | Generic webhook coverage ingest |
| **CREATE** | `api/src/presentation/routes/qualityHealthRoutes.ts` | `/api/quality-health` Hono router |
| **MODIFY** | `api/src/presentation/routes/index.ts` | Mount `qualityHealthRoutes` |
| **CREATE** | `frontend/src/app/quality-health/page.tsx` | Page entry point |
| **CREATE** | `frontend/src/components/qualityHealth/QualityHealthDashboard.tsx` | Main dashboard component |
| **CREATE** | `frontend/src/components/qualityHealth/BugCountSummary.tsx` | Bug count summary card (FR-1) |
| **CREATE** | `frontend/src/components/qualityHealth/BugTrendPanel.tsx` | Trend chart panel (FR-2) |
| **CREATE** | `frontend/src/components/qualityHealth/OpenClosedRatioPanel.tsx` | Ratio donut panel (FR-3) |
| **CREATE** | `frontend/src/components/qualityHealth/RegressionRatePanel.tsx` | Regression breakdown (FR-4) |
| **CREATE** | `frontend/src/components/qualityHealth/CoveragePanel.tsx` | Coverage gauge + table (FR-5) |
| **CREATE** | `frontend/src/components/qualityHealth/ThresholdConfigForm.tsx` | Threshold editor (FR-7.2) |
| **CREATE** | `frontend/src/components/qualityHealth/IntegrationConfigPanel.tsx` | Integration config UI (FR-6) |
| **CREATE** | `frontend/src/components/dashboard/DashboardQualityHealthTab.tsx` | Dashboard tab summary view |
| **MODIFY** | `frontend/src/components/dashboard/index.ts` | Export DashboardQualityHealthTab |
| **MODIFY** | `frontend/src/lib/builderforceApi.ts` | Add qualityHealth API client methods |
| **MODIFY** | `frontend/messages/en.json` (and other locales) | Add qualityHealth translation keys |

---

### Implementation order (dependency-ordered phases)

1. **Phase 1 — Data model + ingestion skeleton**: Migration, Drizzle schema, `ingestBugs.ts`, `ingestCoverage.ts`, `qualityHealthRoutes.ts` scaffold with `GET /insights` returning mock shapes.
2. **Phase 2 — Pure metric functions + tests**: `trendClassifier`, `anomalyDetector`, `openClosedRatio`, `classifyRegressions` — each with its test file. These are pure functions with no DB dependency, so they can be built and validated in isolation.
3. **Phase 3 — Lens aggregator + API**: `qualityHealthInsights.ts`, flesh out all `qualityHealthRoutes.ts` endpoints, wire the read-through cache.
4. **Phase 4 — Connectors**: One connector at a time, starting with GitHub Issues (most common) and GitHub Actions coverage. Each connector is testable against live sandbox projects.
5. **Phase 5 — Frontend dashboard**: Build all `qualityHealth/*` components, the page entry point, and the dashboard tab. Wire the API client methods in `builderforceApi.ts`.
6. **Phase 6 — Alert engine + coverage gate**: `alertEngine.ts`, `coverageGate.ts`, and `ThresholdConfigForm.tsx`.
7. **Phase 7 — Integration config UI + RBAC + i18n**: `IntegrationConfigPanel.tsx`, role capability definitions, translation keys.

### Key design decisions

- **Snapshots, not live queries**: Bug data is polled and snapshotted rather than queried live from issue trackers on every dashboard load. This avoids rate-limit issues, decouples dashboard performance from third-party API latency, and gives us a time-series history. The 15-minute default poll interval keeps data current within the AC-1 tolerance.
- **Pure core, I/O shell**: Every metric function (`trendClassifier`, `anomalyDetector`, `openClosedRatio`, `classifyRegressions`) is a pure function over arrays/numbers — no DB, no network. This makes them trivially unit-testable and lets us satisfy AC-2, AC-3, AC-4, AC-10 with fast deterministic tests.
- **Reuse chart primitives, don't import a charting library**: `TrendChart`, `DonutChart`, `BarChart`, `GaugeChart` are already hand-rolled SVG components used across the platform (cost reports, AI impact, quality stats). The Quality Health dashboard uses these exclusively — no new charting dependencies.
- **Mirror existing integration patterns exactly**: Credential storage uses the same `encryptCredentials`/`decryptCredentials` flow as Sentry/PostHog/LogRocket integrations in `qualityRoutes.ts`. The REST API follows the same Hono + authMiddleware + read-through-cache pattern. Frontend components follow the same `'use client'` + `useProjectScope` + `useTranslations` pattern as `QualityDashboard` / `QualityStatsPanel`.
- **Separate route mount, separate page**: `/api/quality-health` vs `/api/quality`, `/quality-health` vs `/quality`. The existing Quality pillar is about production errors; Quality Health is about engineering metrics. They share the platform layer (auth, caching, charts) but are separate domains. No existing route or page is modified.

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
