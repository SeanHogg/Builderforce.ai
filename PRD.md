> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #298
> _Each agent that updates this PRD signs its change below._

# PRD: Budget Health Dashboard

## Problem & Goal

Engineering and product teams using AI-assisted workflows have no unified view of planned versus actual spend, making it impossible to detect budget overruns early, understand token/AI cost efficiency, or forecast whether a project will complete within budget. This results in surprise invoices, wasted spend, and poor resource allocation decisions.

**Goal:** Deliver a Budget Health module that gives stakeholders real-time visibility into planned vs. actual spend, burn rate trends, forecasted completion cost, and token/AI spend efficiency — enabling proactive budget management rather than reactive damage control.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Monitor team-level AI spend and catch overruns before sprint end |
| Product Manager | Track feature/project budget health against roadmap commitments |
| FinOps / Finance Analyst | Audit AI cost allocations, generate reports for finance reviews |
| CTO / VP Engineering | Executive summary of org-wide AI spend efficiency and forecast risk |
| Individual Contributor (IC) | Understand personal token usage and stay within allocated budget |

---

## Scope

This PRD covers the **Budget Health** feature as a self-contained module within the existing platform dashboard. It addresses ingestion of cost and usage data, computation of derived metrics, visualization, alerting, and export. It does not address billing infrastructure or provider contract negotiation.

---

## Functional Requirements

### FR-1: Planned vs. Actual Spend

- Users can define a **planned budget** per project, team, or time period (daily / weekly / monthly / per-sprint / custom range).
- The system ingests **actual spend** from connected AI providers (OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, etc.) and internal cost allocation tags.
- A comparison view displays planned budget, actual spend to date, remaining budget, and variance (absolute and percentage) in real time or near-real time (≤ 15-minute data freshness).
- Variance is color-coded: green (≤ 80% of budget consumed), amber (81–99%), red (≥ 100% / overrun).

### FR-2: Burn Rate

- The system calculates **burn rate** as spend per unit time (hourly, daily, weekly) using a configurable rolling window (default: trailing 7 days).
- A burn rate trend chart (time-series line chart) visualizes acceleration or deceleration of spend.
- The system detects **burn rate anomalies** — spikes exceeding 2× the trailing average — and surfaces them as inline warnings.
- Burn rate is segmentable by project, team, model, and environment (dev / staging / production).

### FR-3: Forecast Completion Cost

- Using current burn rate and remaining scope (time or task units), the system produces a **forecasted total cost at completion (EAC — Estimate at Completion)**.
- Forecast methodology: linear projection by default; optional exponential smoothing for volatile spend patterns.
- EAC is displayed alongside the original planned budget with a confidence interval band (p10 / p50 / p90).
- If EAC exceeds planned budget, the system highlights the **forecasted overrun amount and date** at which budget will be exhausted at current burn rate.
- Forecast recalculates automatically when new actuals arrive.

### FR-4: Token / AI Spend Efficiency

- The system computes efficiency metrics per model and per task type:
  - **Cost per successful output** (e.g., cost per accepted completion, cost per resolved task)
  - **Token utilization ratio**: tokens used in output / tokens consumed in total (input + output + cached)
  - **Waste ratio**: retries, failed calls, and unused cached tokens as a percentage of total spend
  - **Model cost efficiency score**: normalized composite of cost-per-output and success rate, enabling model-to-model comparison
- Efficiency metrics are displayed in a sortable table and a scatter plot (cost vs. quality/success rate).
- Users can set **efficiency thresholds**; breaching a threshold triggers an alert.

### FR-5: Alerting & Notifications

- Users configure alert rules on any tracked metric: spend threshold (absolute or %), burn rate spike, EAC overrun risk, or efficiency degradation.
- Alert delivery channels: in-app notification, email, Slack webhook, PagerDuty (optional / configurable).
- Alerts include contextual detail: metric name, current value, threshold, responsible project/team, and a deep link to the relevant dashboard view.
- Alert history is retained for 90 days.

### FR-6: Budget Management

- Admins and managers can create, edit, and archive budget entries via UI and API.
- Budget entries support hierarchical allocation: org → team → project → task.
- Budget entries support currency selection (USD default) and are stored with the FX rate at time of entry.
- Rollover rules: unused budget can be configured to roll over to the next period or expire.

### FR-7: Reporting & Export

- Users can export any view as CSV, Excel, or PDF.
- Scheduled reports (daily / weekly / monthly) delivered via email to configured recipients.
- API endpoints expose all Budget Health data for integration with external BI tools (Tableau, Looker, Power BI).

---

## Acceptance Criteria

### AC-1: Planned vs. Actual Spend
- [ ] A user can create a budget of $X for a project and see actual spend update within 15 minutes of a provider invoice event.
- [ ] Variance percentage matches `(actual − planned) / planned × 100` to two decimal places.
- [ ] Color-coding thresholds render correctly at exactly 80% and 100% of budget consumed.

### AC-2: Burn Rate
- [ ] Burn rate recalculates correctly when the rolling window is changed (e.g., 7-day vs. 30-day).
- [ ] An anomaly warning appears within one data refresh cycle when a single-period spend exceeds 2× the trailing rolling average.
- [ ] Burn rate chart renders with no data gaps for periods where spend is $0 (displays as zero, not missing).

### AC-3: Forecast Completion Cost
- [ ] EAC using linear projection equals `actual_to_date + (burn_rate × remaining_days)` within a 0.1% rounding tolerance.
- [ ] p10/p50/p90 confidence bands are visually distinct and labeled on the chart.
- [ ] The "budget exhaustion date" displayed is accurate within ±1 day based on current burn rate.
- [ ] Forecast updates automatically within one refresh cycle of new actuals being ingested.

### AC-4: Token / AI Spend Efficiency
- [ ] Cost-per-output metric is computed only for calls with a recorded success/acceptance signal; failed calls are excluded from the numerator.
- [ ] Waste ratio correctly reflects retried and failed API calls as a share of total spend.
- [ ] Model efficiency scores are normalized 0–100 and ranked correctly in the comparison table.
- [ ] A user-defined efficiency threshold, when breached, triggers an alert within 15 minutes.

### AC-5: Alerting
- [ ] An alert fires ≤ 15 minutes after a threshold condition is met.
- [ ] Alert payload contains: metric name, current value, threshold, project/team, timestamp, and deep link.
- [ ] Slack webhook delivers a correctly formatted message when configured; a failed delivery is logged and retried up to 3 times.

### AC-6: Budget Management
- [ ] A budget entry created via API is immediately visible in the UI.
- [ ] Hierarchical rollup correctly sums child budgets into parent totals with no double-counting.
- [ ] Archived budget entries do not appear in active views but remain accessible in audit history.

### AC-7: Reporting & Export
- [ ] CSV export contains all columns visible in the current filtered view, including computed metrics.
- [ ] A scheduled weekly report is delivered within a 5-minute window of its configured send time.
- [ ] API response for budget health data conforms to the documented OpenAPI schema with no missing required fields.

---

## Out of Scope

- **Billing infrastructure**: Payment processing, invoice generation, and provider contract management are handled by existing billing systems and are not modified by this feature.
- **Cost optimization recommendations**: Automated suggestions to switch models or restructure prompts are a separate AI Optimization feature.
- **Non-AI spend**: Infrastructure costs (compute, storage, networking) outside of token/AI API spend are excluded from this module.
- **Real-time streaming (< 1-minute latency)**: Sub-minute data freshness is not required; ≤ 15-minute refresh is the SLA.
- **Multi-currency conversion at reporting time**: All spend is normalized to a single base currency at ingestion; live FX conversion in reports is not supported in v1.
- **Mobile native app**: Budget Health is web-only in v1; mobile-responsive web is required but native iOS/Android apps are out of scope.
- **Predictive ML models beyond linear/exponential smoothing**: Advanced forecasting models (ARIMA, neural nets) are deferred to a future release.
- **User-level granular billing chargebacks**: Chargeback reporting below the team level is deferred to v2.