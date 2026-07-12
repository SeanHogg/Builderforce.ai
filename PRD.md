> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #287
> _Each agent that updates this PRD signs its change below._

# PRD: Budget vs. Actual Spend Visibility Feature

## Problem & Goal

Finance stakeholders and project managers currently lack a fast, reliable way to compare approved budgets against actual expenditures in real time. This forces manual reconciliation across spreadsheets, ERP exports, and accounting systems, leading to delayed decisions, cost overruns going undetected, and inconsistent reporting across teams.

**Goal:** Deliver a single, authoritative view that surfaces current budget vs. actual spend — by period, department, project, or cost category — so decision-makers can act before variances become critical.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| CFO / VP Finance | Executive summary of total budget health; variance alerts |
| Finance Analysts | Drill-down into line-item variances; export for audits |
| Project / Program Managers | Real-time spend against project budgets |
| Department Heads | Self-service view of their own budget utilization |
| Procurement Officers | PO commitments vs. remaining budget |

---

## Scope

### In Scope
- Ingestion of approved budget data (annual, quarterly, project-level)
- Integration with actuals from connected financial systems (ERP, GL, expense platforms)
- Real-time or near-real-time (≤ 24 hr refresh) variance calculation
- Dashboard and tabular views with filtering and drill-down
- Variance alerting (threshold-based notifications)
- CSV/Excel export of any view

### Out of Scope
- Budget *creation* or *approval* workflows
- Forecasting / predictive spend modeling
- Payroll or headcount planning
- Multi-currency conversion (Phase 1)
- Third-party vendor billing reconciliation

---

## Functional Requirements

### FR-1 Data Ingestion & Sync
- **FR-1.1** Connect to at least one ERP/GL source (e.g., NetSuite, SAP, QuickBooks) via API or scheduled file import.
- **FR-1.2** Accept budget uploads via structured CSV/Excel template.
- **FR-1.3** Sync actuals on a configurable schedule (minimum daily; real-time webhook support optional).
- **FR-1.4** Flag and surface data ingestion errors with actionable error messages.

### FR-2 Budget vs. Actual Calculation Engine
- **FR-2.1** Calculate variance in absolute ($) and percentage (%) terms: `Variance = Budget − Actual`.
- **FR-2.2** Support aggregation by: fiscal period (month/quarter/year), department, cost center, project, and GL account.
- **FR-2.3** Support committed spend (open POs/encumbrances) as a distinct line alongside actuals.
- **FR-2.4** Handle mid-year budget amendments with full audit trail.

### FR-3 Dashboard & Reporting UI
- **FR-3.1** Summary dashboard showing total budget, total actuals, variance, and % utilized.
- **FR-3.2** Filterable table view: filter by date range, department, project, cost category.
- **FR-3.3** Drill-down from summary → department → cost center → individual transaction.
- **FR-3.4** Visual indicators (RAG status): Green < 90% utilized, Amber 90–100%, Red > 100%.
- **FR-3.5** Trend chart: monthly budget vs. actuals over the selected fiscal period.

### FR-4 Alerting & Notifications
- **FR-4.1** User-configurable thresholds (e.g., alert at 80%, 90%, 100% of budget consumed).
- **FR-4.2** Notifications delivered via in-app alert and email.
- **FR-4.3** Alerts scoped per department/project so managers only receive relevant notifications.

### FR-5 Access Control
- **FR-5.1** Role-based access: Executive (all departments), Manager (own department/projects only), Analyst (assigned scope + export).
- **FR-5.2** All data access logged for audit purposes.

### FR-6 Export
- **FR-6.1** Export any filtered view to CSV and Excel (.xlsx).
- **FR-6.2** Export includes all visible columns plus metadata (export timestamp, filters applied, data-as-of timestamp).

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a connected ERP, actuals data refreshes within 24 hours of a transaction posting; timestamp of last sync is visible on the dashboard. |
| AC-2 | Budget vs. actual variance matches hand-calculated figures from source data to within $0.01 (rounding tolerance). |
| AC-3 | A department head filtered to their department sees zero data from other departments. |
| AC-4 | When actual spend crosses a configured threshold, the responsible manager receives an in-app and email notification within 15 minutes. |
| AC-5 | Drill-down from summary to individual transaction completes in ≤ 3 seconds on a dataset of 500k transactions. |
| AC-6 | CSV/Excel export of a 10,000-row result set completes in ≤ 30 seconds. |
| AC-7 | A mid-year budget amendment is reflected in the dashboard within one sync cycle and the prior budget value is preserved in the audit trail. |
| AC-8 | RAG indicators display correctly: Green when utilization < 90%, Amber 90–100%, Red > 100%. |
| AC-9 | All ingestion errors surface a human-readable message identifying the affected record and the reason for failure. |

---

## Out of Scope

- Budget request, approval, and versioning workflows
- Forecasting, predictive analytics, or "spend to complete" projections
- Payroll, headcount, or workforce cost planning
- Multi-currency and foreign exchange conversion (deferred to Phase 2)
- Accounts payable / invoice matching
- Integration with procurement marketplaces or vendor portals
- Mobile native application (web-responsive only in Phase 1)