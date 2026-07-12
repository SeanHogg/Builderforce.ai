> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #314
> _Each agent that updates this PRD signs its change below._

# PRD: Anomaly Detection & Surface Ingested Data in Diagnostic Report

## Problem & Goal

Diagnostic reports currently display raw metrics without historical context, making it difficult for users to distinguish normal variance from meaningful anomalies. Engineers and team leads must manually cross-reference historical data to determine whether a metric is concerning, which is slow, error-prone, and inconsistent across teams.

**Goal:** Automatically surface ingested data within the diagnostic report and flag statistical anomalies inline — providing immediate, context-aware signals (e.g., *"Bug count is 2× the 30-day average"*) so users can prioritize issues without manual investigation.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Leads** | Quickly identify project health regressions during sprint reviews or incident triage |
| **QA Engineers** | Spot defect-rate spikes relative to historical norms without querying separate dashboards |
| **Site Reliability Engineers (SREs)** | Detect operational anomalies (error rates, latency, failure counts) inline during postmortems |
| **Product Managers** | Understand metric deviations in plain language without requiring SQL or BI tool access |

---

## Scope

This release covers:
- Ingestion of historical metric baselines into the diagnostic report pipeline
- Inline anomaly detection against configurable comparison windows (default: 30-day rolling average)
- Human-readable anomaly flags rendered directly within the diagnostic report output
- Support for the metric types already captured by the existing ingestion layer (bug counts, error rates, build failures, test pass rates)

---

## Functional Requirements

### FR-1 — Baseline Data Ingestion & Storage
- The system must ingest and persist historical metric snapshots on a rolling basis
- Baselines must be available for comparison windows of **7 days, 30 days, and 90 days**
- Baseline data must be queryable per metric type, per project/entity, and per time window at report-generation time
- Ingested data must be refreshed at minimum every **24 hours** or on each report generation trigger, whichever is more frequent

### FR-2 — Anomaly Detection Engine
- For each metric in the report, the engine must compute the deviation of the current value from the baseline mean for the selected comparison window
- Anomaly thresholds must be configurable per metric type with the following defaults:

  | Severity | Default Threshold |
  |---|---|
  | **Warning** | ≥ 1.5× baseline average |
  | **Critical** | ≥ 2× baseline average |
  | **Positive** | ≤ 0.5× baseline average (favorable drop) |

- The engine must also flag metrics where the current value is **outside 2 standard deviations** of the baseline mean as an alternative detection mode (configurable)
- Anomaly detection must run for all numeric metrics present in the report unless explicitly excluded via configuration

### FR-3 — Inline Report Surfacing
- Each metric row/section in the diagnostic report must display:
  - The **current value**
  - The **baseline average** for the active comparison window
  - The **deviation** expressed as a multiplier or percentage (e.g., *"2× the 30-day average"* or *"+112% vs. 30-day avg"*)
  - A **severity badge or label** (Warning / Critical / Normal / Improved)
- Anomaly flags must render in both the human-readable report format (HTML/Markdown) and structured data output (JSON)
- Flagged anomalies must appear **prominently at the top of the report** in a dedicated *Anomaly Summary* section, in addition to their inline position

### FR-4 — Anomaly Flag Copy & Formatting
- Flag messages must follow a consistent natural-language template:  
  `"[Metric name] is [multiplier]× the [window]-day average ([current value] vs. avg [baseline value])"`  
  Example: *"Bug count is 2× the 30-day average (42 vs. avg 21)"*
- Messages must adapt gracefully when baseline data is insufficient (< 7 days of history):  
  `"[Metric name]: Insufficient history for baseline comparison"`

### FR-5 — Configuration & Overrides
- Teams must be able to configure per-metric:
  - Active comparison window (7 / 30 / 90 days)
  - Warning and Critical multiplier thresholds
  - Whether to include or exclude a metric from anomaly detection
- Configuration must be expressible as a YAML/JSON config file committed alongside project configuration

### FR-6 — No-Regression Guarantee on Missing Data
- If historical baseline data is unavailable for a metric, the report must still render the current value without error
- Missing baseline must surface as an informational note, not block report generation

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a metric whose current value is ≥ 2× the 30-day average, the report displays a **Critical** anomaly flag with a message matching the template in FR-4 |
| AC-2 | Given a metric whose current value is ≥ 1.5× and < 2× the 30-day average, the report displays a **Warning** anomaly flag |
| AC-3 | Given a metric whose current value is ≤ 0.5× the 30-day average, the report displays an **Improved** flag |
| AC-4 | Given a metric with no historical data, the report renders the current value with an informational note and does **not** error or omit the metric |
| AC-5 | The *Anomaly Summary* section at the top of the report lists all flagged metrics (Warning, Critical, Improved) with links/anchors to their inline position |
| AC-6 | The structured JSON output includes an `anomalies` array containing each flagged metric with fields: `metric_name`, `current_value`, `baseline_value`, `window_days`, `multiplier`, `severity` |
| AC-7 | Configuring a custom threshold via YAML overrides the default thresholds for that metric in the next generated report |
| AC-8 | Baseline data refreshes are confirmed to have occurred within the last 25 hours before a report is generated; a stale-data warning is shown if not |
| AC-9 | All anomaly calculations and flags complete within **2 seconds** of added latency to existing report generation time (p95, measured in staging) |
| AC-10 | The comparison window displayed in each flag message matches the window configured or defaulted for that metric |

---

## Out of Scope

- **Predictive / ML-based anomaly detection** — thresholds are statistical and rule-based only in this release
- **Alerting or notification delivery** (email, Slack, PagerDuty) — report surfacing only; alerting integration is a future phase
- **Non-numeric / categorical metric anomaly detection** (e.g., status changes, label changes)
- **Custom baseline periods** beyond the three supported windows (7 / 30 / 90 days)
- **Real-time / streaming ingestion** — batch refresh on a ≥ 24-hour cadence only
- **User-facing UI for editing thresholds** — configuration is file-based only in this release
- **Multi-project cross-comparison** — anomalies are computed per project/entity in isolation
- **Retroactive re-scoring of historical reports** with new thresholds