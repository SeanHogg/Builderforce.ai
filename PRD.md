> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #279
> _Each agent that updates this PRD signs its change below._

# PRD: Budget & Resources Tracking — Human + AI Resource Intelligence

## Problem & Goal

Project stakeholders currently lack a unified, real-time view of whether spending is on track and whether human and AI resources are being allocated optimally. Budget data lives in spreadsheets, AI usage costs are scattered across vendor dashboards, and human capacity is tracked separately in project management tools. This fragmentation causes overspend surprises, under-utilization of AI capabilities, and reactive rather than proactive resource decisions.

**Goal:** Deliver a consolidated Budget & Resources module that surfaces live budget variance, forecasts burn rate to completion, and provides a unified view of human headcount needs alongside AI resource consumption — enabling stakeholders to course-correct early and confidently answer *"Are we on track?"* at any point in the project lifecycle.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Project / Program Manager | Daily budget status, variance alerts, reforecast triggers |
| Engineering Lead | AI compute quota visibility, team capacity gaps |
| Finance Business Partner | Actuals vs. plan reconciliation, EAC (Estimate at Completion) |
| Executive Sponsor | One-glance health signal, escalation flags |
| AI/ML Ops Lead | Token usage, API cost attribution, model efficiency metrics |

---

## Scope

This PRD covers the **Budget & Resources** work-stream within the broader project intelligence platform. It spans:

- Budget plan ingestion and actuals tracking
- Human resource capacity planning and gap detection
- AI resource usage monitoring and cost attribution
- Variance analysis, forecasting, and alerting
- Reporting surfaces (dashboard, digest, export)

---

## Functional Requirements

### 1. Budget Tracking

**FR-B1 — Plan Ingestion**
The system must ingest an approved budget baseline (CSV, spreadsheet, or API) broken into cost categories: personnel, AI/cloud services, tooling, contractors, and contingency.

**FR-B2 — Actuals Integration**
The system must pull actuals from at minimum one financial source (e.g., ERP, expense tool, or manual entry) on a configurable cadence (daily default, near-real-time optional).

**FR-B3 — Variance Calculation**
The system must calculate and display:
- Spend to date vs. plan to date (period variance)
- Forecast spend to completion (EAC) vs. total approved budget (ETC variance)
- Percentage consumed vs. percentage of timeline elapsed

**FR-B4 — Burn Rate Forecasting**
The system must extrapolate current burn rate using a rolling 2-week average and project remaining runway. It must flag when projected EAC exceeds budget by configurable thresholds (default: 5%, 10%, 15%).

**FR-B5 — Category Drill-Down**
Users must be able to drill from total budget into individual cost categories and, where data permits, into line-item detail.

---

### 2. Human Resource Tracking

**FR-H1 — Headcount Plan vs. Actuals**
The system must maintain a roster of planned roles, planned FTE allocation (%), and actual allocation sourced from timesheets or project management tool integration (e.g., Jira, Asana, Linear).

**FR-H2 — Capacity Gap Detection**
The system must identify roles that are:
- **Over-allocated** (>100% across projects)
- **Under-allocated** (allocated < 50% of planned)
- **Unfilled** (planned role with no assigned person)

**FR-H3 — Resource Demand Forecast**
Based on the project schedule and open tasks, the system must project human resource demand for the next 2, 4, and 8 weeks by role type.

**FR-H4 — Contractor vs. FTE Split**
The system must separately track and cost contractor spend vs. internal FTE loaded cost to support build/buy/borrow decisions.

---

### 3. AI Resource Tracking

**FR-A1 — AI Cost Attribution**
The system must ingest usage data from AI/LLM providers (OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, GCP Vertex — configurable) and attribute token consumption and API cost to project, team, or feature area.

**FR-A2 — Quota & Limit Monitoring**
The system must surface current usage against any configured rate limits, monthly spend caps, or token quotas, with alerts before limits are breached (default: at 70% and 90% of limit).

**FR-A3 — AI vs. Human Cost Comparison**
The system must provide a side-by-side view of tasks where AI is substituting or augmenting human effort, showing relative cost and throughput where measurable.

**FR-A4 — Model Efficiency Tracking**
For teams using multiple models, the system must track cost-per-task or cost-per-output-unit by model to support optimization decisions.

---

### 4. Alerting & Notifications

**FR-N1 — Threshold Alerts**
Configurable alerts (email, Slack, in-app) must fire when:
- Budget variance exceeds defined thresholds
- AI spend quota reaches warning levels
- A planned role remains unfilled within N days of its needed-by date
- Burn rate trajectory projects overrun within the current period

**FR-N2 — Weekly Digest**
The system must auto-generate a weekly Budget & Resources digest summarizing status, top variances, and recommended actions, delivered to configured stakeholders.

---

### 5. Reporting & Export

**FR-R1 — Executive Dashboard**
A single-screen summary view showing: overall budget RAG status, headcount RAG status, AI resource RAG status, and top 3 risks.

**FR-R2 — Detailed Reports**
Exportable reports (PDF, CSV) for budget actuals, resource utilization, and AI cost attribution covering any selectable date range.

**FR-R3 — Audit Trail**
All budget baseline changes and reforecasts must be logged with timestamp, actor, and reason.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Budget actuals refresh within 24 hours of source system update (daily cadence) | Integration test with mock ERP data |
| AC-2 | EAC variance calculation matches finance team manual calculation within ±0.5% | UAT with Finance BP using 3 test datasets |
| AC-3 | AI cost attribution covers 100% of API spend with no unattributed remainder | End-to-end test across all configured providers |
| AC-4 | Capacity gap alerts fire within 15 minutes of threshold breach | Automated alert regression test |
| AC-5 | Executive dashboard loads in < 3 seconds on 90th-percentile connection | Performance test |
| AC-6 | Weekly digest delivered by 08:00 local time every Monday | Scheduled job validation over 4-week period |
| AC-7 | All budget baseline changes appear in audit trail with correct metadata | Manual audit log review |
| AC-8 | Exported CSV reconciles to dashboard figures exactly | Data integrity test |
| AC-9 | Threshold percentages are configurable by project admin without code change | Config UI walkthrough |
| AC-10 | AI vs. Human cost comparison renders for projects with both resource types active | UAT with mixed-resource test project |

---

## Out of Scope

- **Procurement workflows** — purchase order creation or vendor contract management are not included.
- **Payroll processing** — the system reads loaded cost rates but does not process or modify payroll.
- **Portfolio-level budget roll-up** — this module covers a single project; cross-project aggregation is a future phase.
- **ROI / business value attribution** — measuring business outcomes delivered per dollar spent is out of scope for v1.
- **Real-time (sub-minute) financial streaming** — near-real-time is stretch; daily cadence is the committed baseline.
- **AI model fine-tuning cost tracking** — training job costs are excluded; only inference costs are tracked.
- **Carbon / sustainability accounting** of AI compute resources.
- **Headcount hiring workflow** — detecting a gap may trigger a notification but the system does not manage requisitions or ATS integration.