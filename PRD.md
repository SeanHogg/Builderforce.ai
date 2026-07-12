> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #335
> _Each agent that updates this PRD signs its change below._

# PRD: Data Completeness Scoring

## Problem & Goal

Data consumers across analytics, sales, and operations workflows encounter records with missing, null, or partially populated fields, leading to unreliable reporting, failed automations, and poor decision-making. There is no consistent, programmatic way to quantify how "complete" a record or dataset is.

**Goal:** Build a reusable data completeness scoring engine that assigns a numeric score (0–100%) to any record or dataset, surfacing gaps clearly so downstream agents, users, and systems can act on them.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Data Engineers | Embed scoring into pipelines; monitor dataset health over time |
| Data Analysts | Quickly identify incomplete records before analysis |
| Business/Ops Managers | Understand data quality at a glance via dashboards |
| Downstream AI/Automation Agents | Gate or weight decisions based on completeness threshold |

---

## Scope

The scoring engine covers:
- Single records (row-level scoring)
- Collections of records (dataset-level aggregate scoring)
- Configurable field weighting (not all fields are equally important)
- Multiple data formats: JSON objects, CSV rows, relational table rows

---

## Functional Requirements

### FR-1 · Field Presence Check
The system MUST detect and flag fields that are:
- `null` / `None`
- Empty string (`""`)
- Whitespace-only strings
- Placeholder values (configurable list, e.g., `"N/A"`, `"unknown"`, `"-"`)

### FR-2 · Per-Record Score Calculation
The system MUST calculate a completeness score per record using the formula:

```
score = (Σ weight_i × present_i) / (Σ weight_i) × 100
```

Where:
- `weight_i` = configured weight for field `i` (default: 1.0 for all fields)
- `present_i` = 1 if field has a valid value, 0 if missing/empty/placeholder

### FR-3 · Field Weight Configuration
Users MUST be able to define per-field weights via a configuration schema (JSON or YAML). Fields not listed in the config default to weight `1.0`. Fields explicitly set to weight `0` are excluded from scoring.

### FR-4 · Dataset-Level Aggregate Score
The system MUST compute an aggregate completeness score for a dataset as the mean of all per-record scores, and MUST also report:
- Minimum record score
- Maximum record score
- Standard deviation
- Per-field completeness rate (% of records where that field is populated)

### FR-5 · Missing Field Report
For every scored record or dataset, the system MUST produce a structured report listing:
- Fields that are missing and their configured weights
- The fields contributing most to score reduction (ranked)

### FR-6 · Threshold & Alerting Rules
The system MUST support configurable thresholds:
- `critical` (default: < 50%)
- `warning` (default: 50–79%)
- `passing` (default: ≥ 80%)

Each scored record and dataset MUST be tagged with the appropriate threshold tier.

### FR-7 · API / Callable Interface
The scoring engine MUST expose:
- A programmatic function/method callable by other agents or pipeline steps
- Input: record(s) + optional weight config
- Output: score, tier, missing-field report (structured dict/JSON)

### FR-8 · Batch Processing
The engine MUST support batch scoring of up to **1 million records** without loading the entire dataset into memory simultaneously (streaming or chunked processing).

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A record with all fields populated returns a score of exactly 100. |
| AC-2 | A record with all fields empty/null returns a score of exactly 0. |
| AC-3 | A record missing only fields with weight 0 returns a score of 100. |
| AC-4 | Weighted scoring: a record missing only a field with weight 2 (all others weight 1, 5 total fields) returns a score of `(1+1+1+1)/(1+1+1+1+2) × 100 = 66.67%`. |
| AC-5 | Placeholder values defined in config (e.g., `"N/A"`) are treated as missing. |
| AC-6 | Dataset aggregate score equals the arithmetic mean of all per-record scores ± 0.01%. |
| AC-7 | Per-field completeness rates in the dataset report are accurate to ± 0.1%. |
| AC-8 | A batch of 1,000,000 records completes scoring in ≤ 60 seconds on a standard 4-core machine. |
| AC-9 | Records scoring below the `critical` threshold are tagged `"critical"` in output. |
| AC-10 | The callable API returns valid structured JSON for both single-record and batch inputs. |
| AC-11 | Missing config for a field defaults weight to 1.0 without error. |
| AC-12 | Unit test coverage ≥ 90% across scoring logic modules. |

---

## Out of Scope

- **Data repair / imputation** — the engine scores completeness; it does not fill missing values.
- **Schema inference** — field definitions and expected fields must be supplied explicitly; the engine does not auto-detect expected schema from data alone.
- **Data type validation** — a field containing a value of the wrong type (e.g., string where integer expected) is considered *present* unless it matches a placeholder pattern; type validation is a separate concern.
- **Deduplication** — duplicate records are scored independently; de-duplication is out of scope.
- **UI / dashboard** — visualisation layers are downstream consumers of the API output and are not part of this engine.
- **PII detection or masking** — handling of sensitive fields is managed externally.
- **Real-time streaming ingestion** — batch and on-demand invocation only; native Kafka/Flink stream processing is not in scope for v1.