> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #248
> _Each agent that updates this PRD signs its change below._

# PRD: BurnRateOS

## Problem & Goal

Engineering and finance teams at venture-backed startups lack a unified, real-time operating system for tracking cash burn. Spreadsheets are manually updated, lag by days or weeks, and fail to surface actionable signals before they become crises. The goal is to build **BurnRateOS** — a purpose-built burn-rate intelligence platform that ingests live financial data, models runway scenarios, and delivers proactive alerts so founders and CFOs can make faster, better-informed capital decisions.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Founder / CEO | High-level runway visibility; scenario planning before board meetings |
| CFO / Head of Finance | Granular departmental burn breakdown; variance analysis vs. plan |
| VP Engineering | Headcount cost attribution; hiring plan impact modeling |
| Investor / Board Member | Read-only dashboard access; month-over-month trend reporting |

**ICP:** Seed-to-Series-B SaaS startups, 10–200 employees, burning $200K–$5M/month, using cloud accounting software (QuickBooks Online, Xero, NetSuite).

---

## Scope

### In Scope (v1.0)

- Bank and accounting system data ingestion (read-only)
- Real-time burn rate calculation (gross and net)
- Runway projection engine with multi-scenario modeling
- Departmental cost attribution and drill-down
- Alerting and notification system (thresholds, anomalies)
- Role-based access control (RBAC)
- Web application dashboard (responsive)
- REST API for internal consumption

### Out of Scope (v1.0)

- Payments, bill pay, or any write transactions to financial systems
- Mobile native apps (iOS / Android)
- Equity / cap table management
- Tax preparation or compliance reporting
- Investor CRM or fundraising pipeline tooling
- ERP modules beyond accounting integrations

---

## Functional Requirements

### FR-1 — Data Ingestion & Integrations

- **FR-1.1** OAuth 2.0 connections to QuickBooks Online, Xero, and NetSuite (read-only scopes).
- **FR-1.2** Bank feed ingestion via Plaid (checking, savings, money-market accounts).
- **FR-1.3** Manual CSV upload fallback for unsupported sources.
- **FR-1.4** Sync frequency: automatic refresh every 4 hours; manual refresh on demand.
- **FR-1.5** Sync status indicator with last-updated timestamp visible on all dashboards.

### FR-2 — Burn Rate Calculation Engine

- **FR-2.1** Calculate **gross burn** (total cash out per period) and **net burn** (cash out minus cash in) at daily, weekly, and monthly granularity.
- **FR-2.2** Trailing 3-month and 6-month rolling averages displayed alongside current-period burn.
- **FR-2.3** Revenue categorization engine distinguishing operating revenue from financing events (fundraising, loans) to prevent runway inflation.
- **FR-2.4** Burn figures update within 60 seconds of a completed sync.

### FR-3 — Runway Projection Engine

- **FR-3.1** Default runway calculation: `Current Cash Balance ÷ Average Net Burn (trailing 3-month)`.
- **FR-3.2** Scenario builder supporting up to 5 named scenarios with adjustable variables: burn growth rate (%), one-time expenses, expected revenue ramp, and planned fundraise close date + amount.
- **FR-3.3** Visual runway chart (line graph) rendering all active scenarios on a single axis with a clearly marked "zero cash" line.
- **FR-3.4** Scenarios persist per-user and are shareable via unique URL with view-only permission.

### FR-4 — Departmental Cost Attribution

- **FR-4.1** Map accounting chart-of-accounts categories to configurable internal departments.
- **FR-4.2** Display burn by department as absolute values and percentage of total burn per period.
- **FR-4.3** Headcount cost module: pull employee count per department (manual input v1); calculate fully-loaded cost per head using a configurable burden rate multiplier.
- **FR-4.4** Period-over-period variance table (MoM and vs. annual plan) with green/red delta indicators.

### FR-5 — Alerting & Notifications

- **FR-5.1** Users configure runway threshold alerts (e.g., "alert me when runway drops below 9 months").
- **FR-5.2** Anomaly detection flags any single expense line exceeding 150% of its trailing 3-month average.
- **FR-5.3** Monthly burn summary digest emailed automatically on the 1st of each month.
- **FR-5.4** Alert delivery channels: in-app notification center, email; Slack webhook (optional configuration).
- **FR-5.5** Alert history log retained for 12 months.

### FR-6 — Access Control & Permissions

- **FR-6.1** RBAC with four roles: **Admin**, **Editor**, **Viewer**, **Board Observer**.
- **FR-6.2** Board Observer role: read-only access to summary dashboard and runway chart only; no access to transaction-level data.
- **FR-6.3** Admin can invite users via email; invitations expire after 72 hours.
- **FR-6.4** All sessions enforce MFA (TOTP or email OTP).
- **FR-6.5** Audit log of all login events and permission changes retained for 24 months.

### FR-7 — Reporting & Export

- **FR-7.1** Export burn summary and departmental breakdown to PDF and CSV.
- **FR-7.2** Scheduled email report delivery (weekly or monthly) configurable per user.
- **FR-7.3** API endpoint `GET /v1/reports/burn-summary` returning JSON for the requested period.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A newly connected QuickBooks account populates gross and net burn figures within 10 minutes of OAuth completion. |
| AC-2 | Runway projection recalculates and re-renders in under 3 seconds when a scenario variable is adjusted. |
| AC-3 | A runway-threshold alert is delivered (in-app + email) within 5 minutes of the triggering sync completing. |
| AC-4 | Board Observer role cannot navigate to or API-fetch any transaction-level endpoint; returns HTTP 403. |
| AC-5 | CSV export for a 12-month period completes in under 10 seconds for an account with up to 50,000 transactions. |
| AC-6 | All dashboard pages achieve Lighthouse Performance score ≥ 85 on desktop. |
| AC-7 | Gross burn figures match source accounting system totals within ±0.01% after each sync (reconciliation test suite passes). |
| AC-8 | Manual CSV upload correctly parses and ingests files up to 10 MB without error. |
| AC-9 | MFA enforcement blocks dashboard access for any user who has not completed MFA setup after 24-hour grace period. |
| AC-10 | Scenario share URLs render correctly in view-only mode without requiring the viewer to have an account. |

---

## Out of Scope

- Write-back or mutation of any transaction data in connected financial systems
- Native iOS or Android applications
- Cap table, equity, or option pool management
- Payroll processing or direct HRIS integrations (v1 uses manual headcount input)
- Accounts payable / receivable workflow automation
- Multi-currency consolidation (single operating currency per workspace in v1)
- AI-generated narrative commentary on financial results
- Fundraising pipeline or investor relationship management
- SOC 2 Type II certification (targeted post-v1)