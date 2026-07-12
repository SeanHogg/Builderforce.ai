> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #333
> _Each agent that updates this PRD signs its change below._

# PRD: Data Completeness Score

## Problem & Goal

Data teams and platform engineers lack real-time visibility into whether their data pipelines are delivering all expected records. Silent data loss — where pipelines run without errors but drop rows, skip partitions, or miss source entities — goes undetected until downstream consumers report anomalies. The goal is to surface a **Data Completeness Score**: a normalized, continuously updated metric expressing what percentage of expected data is actually flowing through each monitored data asset.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Data Engineers** | Detect pipeline drops and missing partitions before SLA breach |
| **Analytics Engineers** | Validate model inputs are fully populated before scheduled runs |
| **Data Platform / Observability Leads** | Aggregate completeness health across all assets in one view |
| **Data Consumers (Analysts, PMs)** | Understand whether a dashboard or report is built on complete data |
| **Data Governance / Compliance Officers** | Audit and evidence data completeness for regulatory purposes |

---

## Scope

This document covers the definition, computation, storage, surfacing, and alerting of the Data Completeness Score for structured/semi-structured data assets (tables, topics, feeds). It applies to batch pipelines, near-real-time streaming assets, and API-ingested data sources.

---

## Functional Requirements

### 1. Completeness Score Definition

**FR-1.1** The system MUST compute a Completeness Score as:

```
Completeness Score (%) = (Observed Record Count / Expected Record Count) × 100
```

**FR-1.2** The system MUST support multiple strategies for deriving **Expected Record Count**:

- **Historical baseline** — rolling average/median of the same window over the past *N* periods (configurable, default: 28 days)
- **Source-declared volume** — row count provided by an upstream source manifest, API header, or CDC event log
- **Rule-based expectation** — user-defined static or formula-driven threshold (e.g., "at least 1 M rows daily")
- **Partition completeness** — expected vs. received partition keys within a time window

**FR-1.3** The system MUST allow a configurable **tolerance band** (default ±5%) before a score triggers a non-green status.

**FR-1.4** Scores MUST be computed at configurable granularities: per-table, per-partition, per-pipeline run, and per-source system.

---

### 2. Data Collection & Instrumentation

**FR-2.1** The system MUST integrate with common metadata and pipeline sources to collect observed counts:
- Data warehouse query logs and `INFORMATION_SCHEMA` row counts (BigQuery, Snowflake, Redshift, Databricks)
- Streaming brokers (Kafka consumer group lag + offset arithmetic)
- Orchestration run logs (Airflow, dbt, Prefect, Dagster task output metadata)
- REST/GraphQL API response metadata (pagination totals, `X-Total-Count` headers)

**FR-2.2** The system MUST support agent-based (push) and agentless (pull via connector) collection modes.

**FR-2.3** Observed counts MUST be timestamped with both **event time** and **ingestion time** to support late-arriving data analysis.

**FR-2.4** The system MUST record the **expectation strategy** used for each score calculation as part of the audit trail.

---

### 3. Score Aggregation & Rollups

**FR-3.1** The system MUST compute scores at multiple time granularities: per-run, hourly, daily, weekly.

**FR-3.2** The system MUST support hierarchical rollup:
- Asset-level score → Pipeline-level score → Domain/team score → Platform-wide score

**FR-3.3** Rollup aggregation method MUST be configurable: weighted average (by row volume), simple average, or worst-case (min score in group).

**FR-3.4** The system MUST track a **30-day trailing completeness trend** per asset to distinguish chronic vs. transient issues.

---

### 4. Status Classification

**FR-4.1** Each computed score MUST be mapped to a status tier:

| Status | Score Range (default) | Meaning |
|---|---|---|
| ✅ **Healthy** | 95–105% | Within tolerance |
| ⚠️ **Degraded** | 80–94% or 106–120% | Partial loss or unexpected surplus |
| 🔴 **Critical** | < 80% or > 120% | Significant completeness failure |
| ⬜ **Unknown** | — | Expectation baseline not yet established |

**FR-4.2** Status thresholds MUST be overridable per asset or per domain.

**FR-4.3** Scores above 100% (surplus) MUST be flagged and treated as anomalies (potential duplication or wrong baseline), not silently capped.

---

### 5. Alerting & Notifications

**FR-5.1** The system MUST trigger alerts when an asset's score drops below the configured **Critical** or **Degraded** threshold for a user-defined consecutive-run count (default: 1 for Critical, 2 for Degraded).

**FR-5.2** Alert payloads MUST include: asset name, current score, expected count, observed count, expectation strategy, time window, and a direct link to the asset detail view.

**FR-5.3** The system MUST support alert routing to: email, Slack, PagerDuty, MS Teams, and generic webhook.

**FR-5.4** The system MUST support **alert suppression** windows (e.g., during known maintenance or backfill operations) configured via API or UI.

**FR-5.5** The system MUST provide a **no-data alert**: if no observation is received within the expected schedule window + configurable grace period, treat observed count as 0 and fire a Critical alert.

---

### 6. User Interface

**FR-6.1** A **Completeness Dashboard** MUST display:
- Platform-wide completeness health summary (% of assets in each status tier)
- Asset-level list view sortable by score, trend, domain, and last-updated time
- Per-asset detail view showing score history, expected vs. observed count chart, and run-level breakdown

**FR-6.2** The dashboard MUST support filtering by: domain/team, data source type, pipeline/orchestrator, time range, and status tier.

**FR-6.3** Users MUST be able to annotate specific score dips with a free-text explanation (e.g., "known upstream outage") visible in the history chart.

**FR-6.4** The UI MUST display the **expectation strategy** and its parameters for each asset so users understand how the expected count is derived.

---

### 7. API

**FR-7.1** The system MUST expose a REST API to:
- `GET /assets/{id}/completeness` — retrieve current and historical scores
- `GET /completeness/summary` — retrieve platform/domain rollup scores
- `POST /assets/{id}/expectations` — create or update expectation rules
- `POST /assets/{id}/suppress` — create suppression windows
- `GET /completeness/incidents` — list all active completeness violations

**FR-7.2** API responses MUST include the score value, status tier, expectation strategy metadata, and confidence level where a statistical baseline is used.

**FR-7.3** The API MUST support filtering by time range, status, and domain on all list endpoints.

---

### 8. Baseline Learning & Confidence

**FR-8.1** When using the historical baseline strategy, the system MUST require a **minimum observation window** (default: 14 days) before publishing a score; prior to this the status MUST be **Unknown**.

**FR-8.2** The system MUST report a **confidence indicator** (Low / Medium / High) based on variance in the historical baseline.

**FR-8.3** The system MUST automatically detect and exclude known anomalous historical periods (e.g., prior outages) from baseline computation via outlier filtering (default: IQR-based).

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a table with a known daily row count, the system computes a score within 60 seconds of the ingestion window closing and the score is accurate to within ±0.1% of the manually verified value. |
| AC-2 | Given an asset whose observed count falls below the Critical threshold, an alert is delivered to the configured Slack channel within 5 minutes of the score computation. |
| AC-3 | Given an asset with fewer than 14 days of history, the UI and API return status = **Unknown** and no alert is fired for threshold breaches. |
| AC-4 | Given a user sets a rule-based expectation of 1 M rows/day and 800 K rows arrive, the score displays as 80% with status **Critical**. |
| AC-5 | Given a suppression window is active, no alerts are fired for the suppressed asset during that window, and the suppression is visible in the asset detail view. |
| AC-6 | Given a surplus score of 115%, the system flags the asset as **Degraded** (not Healthy) and includes it in the anomaly list. |
| AC-7 | The platform-wide rollup score reflects all asset scores within 5 minutes of any individual asset score update. |
| AC-8 | The REST API returns a valid completeness response for any monitored asset with p99 latency < 500 ms under normal load. |
| AC-9 | Historical score data is retained and queryable for a minimum of 13 months. |
| AC-10 | A user with Viewer permissions can see scores and history but cannot modify expectations or suppression windows. |

---

## Out of Scope

- **Schema completeness** (missing columns, null rates, data type conformance) — covered by a separate Data Quality dimension
- **Data freshness / timeliness scoring** — tracked in the Freshness Score module
- **Referential integrity checks** (foreign key completeness across tables) — separate reconciliation feature
- **Unstructured data assets** (documents, images, video) — v1 covers structured/semi-structured only
- **Auto-remediation** of pipeline failures that cause incompleteness — this system observes and alerts; remediation is owned by orchestration tooling
- **Cost attribution** of incomplete runs — future analytics capability
- **Real-time row-level lineage** to identify which specific rows are missing — out of scope for v1 scoring layer
- **Custom ML-based anomaly models** beyond IQR outlier filtering for baseline — considered for v2