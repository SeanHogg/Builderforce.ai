> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #242
> _Each agent that updates this PRD signs its change below._

# PRD: Cost Projection with Budget Comparison

## Problem & Goal

Finance teams, project managers, and business owners struggle to forecast future costs against approved budgets using fragmented tools — typically spreadsheets that lack automation, real-time data integration, and visual alerting. The result is late discovery of budget overruns, poor resource allocation decisions, and reactive rather than proactive financial management.

**Goal:** Build a cost projection engine with budget comparison capabilities that enables users to forecast spending trajectories, compare projections against budgets at multiple time horizons, and receive actionable alerts when variances exceed defined thresholds.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Finance Analyst | Accurate multi-period cost forecasts; exportable reports |
| Project Manager | Per-project budget vs. actuals + forecast view |
| Department Head | Rolled-up budget health across teams and cost centers |
| CFO / Finance Director | Executive summary; variance trends; drill-down capability |
| Operations Manager | Resource-linked cost projections tied to headcount or usage |

---

## Scope

### In Scope
- Ingestion of historical actuals (manual upload and API integration)
- Budget definition at project, department, and cost-center levels
- Automated cost projection using configurable forecasting models
- Budget vs. projection comparison views (tabular and visual)
- Variance calculation, categorization, and threshold-based alerting
- Time-period granularity: weekly, monthly, quarterly, annual
- Role-based access control (RBAC) for budget visibility
- Export to CSV, Excel, and PDF

### Out of Scope
- Accounts payable / invoice processing
- General ledger or ERP replacement
- Payroll processing
- Real-time stock or commodity price feeds
- Tax calculation or compliance reporting

---

## Functional Requirements

### FR-1: Budget Management
- **FR-1.1** Users can create and edit budgets at three hierarchy levels: Cost Center → Department → Project.
- **FR-1.2** Budgets can be defined for any contiguous date range and broken into sub-periods (weekly / monthly / quarterly).
- **FR-1.3** Budget versions (draft, approved, revised) must be tracked with timestamps and author metadata.
- **FR-1.4** Bulk budget import via CSV template with field validation and error reporting.

### FR-2: Actuals Ingestion
- **FR-2.1** Manual upload of actuals via CSV/Excel with column-mapping UI.
- **FR-2.2** Scheduled API pull from supported connectors (QuickBooks, Xero, NetSuite, Salesforce, custom REST endpoint).
- **FR-2.3** Actuals are tagged with cost category, cost center, project, and GL code.
- **FR-2.4** Duplicate detection and conflict resolution on re-import.

### FR-3: Cost Projection Engine
- **FR-3.1** System supports at minimum three forecasting methods selectable per budget line:
  - **Linear extrapolation** — trend line from trailing N periods.
  - **Seasonal decomposition** — applies historical seasonality indices.
  - **Run-rate** — current period actuals annualized or period-scaled.
- **FR-3.2** Users can apply manual override values to any projected period; overrides are visually distinguished from model-generated values.
- **FR-3.3** Projections are recalculated automatically when new actuals are ingested.
- **FR-3.4** Confidence interval bands (P10 / P50 / P90) are displayed for statistical models.
- **FR-3.5** Projection horizon configurable from 1 month to 36 months.

### FR-4: Budget vs. Projection Comparison
- **FR-4.1** Side-by-side comparison of budget, actuals-to-date, remaining budget, projection-to-complete, and projected final cost.
- **FR-4.2** Variance is calculated as both absolute (currency) and relative (%) values.
- **FR-4.3** Variance is color-coded: green (within threshold), amber (approaching threshold), red (threshold breached).
- **FR-4.4** Waterfall chart showing budget baseline, favorable variances, unfavorable variances, and projected end state.
- **FR-4.5** Trend sparklines per budget line item showing actuals + projection on a single axis.

### FR-5: Alerting & Notifications
- **FR-5.1** Users can configure variance alert rules per budget (e.g., "alert when projected overrun > 10%").
- **FR-5.2** Alerts are delivered via in-app notification, email, and optionally Slack/Teams webhook.
- **FR-5.3** Alert cadence options: real-time (on ingestion), daily digest, weekly summary.
- **FR-5.4** Alert history log retained for 12 months.

### FR-6: Reporting & Export
- **FR-6.1** Pre-built report templates: Budget Health Summary, Variance Detail, Projection Trend, Period-over-Period.
- **FR-6.2** Custom report builder allowing users to select dimensions, metrics, and filters.
- **FR-6.3** Scheduled report delivery via email (PDF or Excel attachment).
- **FR-6.4** All tabular views exportable to CSV and Excel on demand.

### FR-7: Access Control
- **FR-7.1** RBAC with four system roles: Viewer, Analyst, Budget Owner, Admin.
- **FR-7.2** Row-level security: users see only cost centers / projects they are granted access to.
- **FR-7.3** Audit log of all budget edits, manual overrides, and permission changes.

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-01 | A budget with 50 line items loads and renders in < 2 seconds on a standard broadband connection. | Performance test |
| AC-02 | Projection recalculation completes within 5 seconds of new actuals being saved. | Automated integration test |
| AC-03 | Variance figures match manual calculation to within ±0.01% (rounding tolerance). | QA data validation script |
| AC-04 | CSV import of 10,000 actuals rows processes without error in < 30 seconds. | Load test |
| AC-05 | A Viewer-role user cannot view cost centers outside their assigned scope. | Security penetration test |
| AC-06 | Alert email is delivered within 5 minutes of a threshold breach being detected. | End-to-end test with mail spy |
| AC-07 | All three forecasting models produce documented, reproducible outputs against a reference dataset. | Model validation report |
| AC-08 | Exported PDF report renders all charts and tables correctly across Chrome, Firefox, and Safari. | Cross-browser QA |
| AC-09 | Budget version history shows all changes with correct author and timestamp. | Manual audit trail review |
| AC-10 | System remains available (≥ 99.5% uptime) during scheduled data ingestion jobs. | Synthetic monitoring over 30-day period |

---

## Out of Scope

- **Invoice & AP workflow** — no purchase order creation, approval routing, or payment scheduling.
- **ERP / GL replacement** — system consumes data from source-of-truth financial systems; it does not replace them.
- **Payroll & compensation planning** — headcount costs may be imported as actuals but salary modeling is not performed.
- **Tax, audit, or statutory compliance** — no SOX control documentation or tax jurisdiction logic.
- **Real-time market data** — commodity prices, FX rate live feeds, or index-linked cost adjustments.
- **Capital expenditure (CapEx) depreciation schedules** — only OpEx budget tracking in v1.
- **Mobile native apps** — responsive web only in v1; native iOS/Android deferred to a future release.
- **Multi-currency conversion engine** — single base currency per workspace in v1; multi-currency support is a future milestone.