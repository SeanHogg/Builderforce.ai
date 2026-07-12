> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #313
> _Each agent that updates this PRD signs its change below._

# PRD: Diagnostic Question Category Mapping

## Problem & Goal

Ingested raw data signals (metrics, counts, events, and textual fields) arrive without semantic labels that connect them to the structured diagnostic framework used downstream for analysis and reporting. Without a reliable mapping layer, agents and consumers cannot determine which diagnostic question category a given data point answers, leading to incomplete diagnostics, duplicated logic, and brittle ad-hoc lookups scattered across the codebase.

**Goal:** Build a deterministic, maintainable mapping layer that assigns every ingested data field or metric to one canonical diagnostic question category, enabling all downstream agents to query, aggregate, and reason over data by category without re-implementing mapping logic.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Diagnostic Analysis Agent** | Consume categorized data to generate structured health assessments |
| **Reporting Agent** | Aggregate metrics per category for dashboards and summaries |
| **Data Ingestion Agent** | Tag incoming records at ingest time so downstream consumers receive pre-labeled data |
| **Product / Engineering Teams** | Inspect and extend the category registry when new data sources or categories are introduced |

---

## Scope

### In Scope
- Definition of the canonical set of diagnostic question categories
- A mapping registry that links each known data field / metric key to exactly one category
- Mapping logic applied at ingest time to annotate each record with its category
- Fallback / unknown handling for unmapped fields
- A validation mechanism to detect unmapped or ambiguously mapped fields
- Unit-tested mapping functions covering all defined categories

### Out of Scope
- Changes to upstream data ingestion pipelines beyond adding the category annotation step
- UI or dashboard rendering of categorized data
- Machine-learning-based auto-categorization (rule-based mapping only in this iteration)
- Cross-category aggregation or scoring logic (handled by downstream agents)

---

## Canonical Diagnostic Question Categories

The following categories constitute the initial registry. Each category answers a specific diagnostic question about product or engineering health.

| Category ID | Category Name | Diagnostic Question Answered |
|---|---|---|
| `quality_bugs` | Quality & Bugs | How many defects exist, and what is their severity distribution? |
| `velocity` | Delivery Velocity | How fast is the team delivering work? |
| `tech_debt` | Technical Debt | How much accumulated debt is slowing progress? |
| `test_coverage` | Test Coverage | How well is the codebase covered by automated tests? |
| `reliability` | Reliability & Stability | How stable and available is the system in production? |
| `security` | Security & Compliance | Are there known vulnerabilities or compliance gaps? |
| `dev_experience` | Developer Experience | How efficient and unblocked is the engineering workflow? |
| `customer_impact` | Customer Impact | How are defects or incidents affecting end users? |
| `process_health` | Process Health | Are team processes (reviews, retros, planning) functioning well? |
| `dependencies` | Dependency Health | Are third-party and internal dependencies up to date and low risk? |

---

## Functional Requirements

### FR-1 Category Registry
- A single source-of-truth registry (e.g., a structured config file or database table) MUST define all valid category IDs and their human-readable names.
- The registry MUST be versioned so that changes are auditable.
- Adding a new category MUST require only a registry update and corresponding mapping rule addition, with no changes to core mapping logic.

### FR-2 Field-to-Category Mapping Rules
- Each mapping rule MUST specify: `source_field_key`, `source_system` (optional), and `category_id`.
- Mapping rules MUST support exact field-name matching as the default strategy.
- Mapping rules MUST support pattern/prefix matching (e.g., `bug_*` → `quality_bugs`) for dynamic or enumerated field families.
- A given `source_field_key` from a given `source_system` MUST map to exactly one `category_id` (no ambiguity).
- Conflicts detected at registry load time MUST raise an error and halt the process.

**Example Mapping Entries:**

| Source Field Key | Source System | Category ID |
|---|---|---|
| `bug_count` | Jira | `quality_bugs` |
| `open_bugs_critical` | Jira | `quality_bugs` |
| `story_points_completed` | Jira | `velocity` |
| `cycle_time_days` | LinearB | `velocity` |
| `tech_debt_hours` | SonarQube | `tech_debt` |
| `code_coverage_pct` | SonarQube | `test_coverage` |
| `p1_incident_count` | PagerDuty | `reliability` |
| `mttr_minutes` | PagerDuty | `reliability` |
| `critical_vuln_count` | Snyk | `security` |
| `pr_review_cycle_hours` | GitHub | `dev_experience` |
| `customers_affected` | Zendesk | `customer_impact` |
| `retrospective_action_completion_rate` | Notion | `process_health` |
| `outdated_dependency_count` | Dependabot | `dependencies` |

### FR-3 Annotation at Ingest Time
- The mapping layer MUST annotate each ingested record with a `diagnostic_category` field before the record is written to the processed data store.
- The annotated record MUST preserve all original fields unchanged.
- Annotation MUST be idempotent: re-processing the same record MUST produce the same `diagnostic_category` value.

### FR-4 Fallback Handling
- If a field key does not match any rule, the record MUST be annotated with `diagnostic_category: "unknown"`.
- All `unknown`-categorized records MUST be written to a dedicated quarantine log for review.
- The system MUST expose a count metric `unmapped_fields_total` for monitoring.

### FR-5 Validation & Integrity Checks
- At registry load time, the system MUST validate:
  - No duplicate `(source_field_key, source_system)` combinations exist.
  - All referenced `category_id` values exist in the category registry.
  - No circular or self-referential rules exist.
- A CLI validation command (`validate-mapping-registry`) MUST be provided to run these checks on demand.

### FR-6 Extensibility Interface
- A documented interface (function signature or API contract) MUST exist for adding new mapping rules programmatically.
- New rules added via the interface MUST be subject to the same conflict-detection logic as static registry rules.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | All fields listed in FR-2 (example mapping entries) are correctly mapped to their specified `category_id` in automated tests. |
| AC-2 | A field key with no matching rule is annotated `diagnostic_category: "unknown"` and appears in the quarantine log. |
| AC-3 | Introducing a duplicate mapping rule causes the registry loader to raise an error with a descriptive message identifying the conflicting rule. |
| AC-4 | Re-processing an already-annotated record produces the same `diagnostic_category` value (idempotency test passes). |
| AC-5 | The `validate-mapping-registry` CLI command exits with code `0` on a valid registry and non-zero on a registry with conflicts or invalid references. |
| AC-6 | `unmapped_fields_total` metric increments by 1 for each record annotated as `unknown` (verified via metric assertion in integration test). |
| AC-7 | Adding a new category to the registry and a corresponding mapping rule requires no changes outside the registry config and rule set (confirmed by code review checklist). |
| AC-8 | Pattern-based rules (e.g., `bug_*`) correctly match all fields conforming to the pattern and map them to the intended category. |
| AC-9 | All ten canonical categories have at least one mapping rule and at least one passing unit test exercising that rule. |
| AC-10 | End-to-end test: a batch of 50 synthetic ingested records spanning all categories is processed; 100% of mappable records receive the correct category annotation with zero data loss on original fields. |

---

## Out of Scope

- **Auto-discovery of new fields:** The system will not automatically infer mappings for unrecognized fields using ML or heuristics.
- **Cross-category scoring or weighting:** Combining category signals into a composite health score is handled by a separate scoring agent.
- **UI for managing the registry:** Registry edits are made directly in configuration files or via the programmatic interface; no admin GUI is included in this iteration.
- **Retroactive re-categorization of historical data:** Only records processed after deployment are in scope; historical backfill is a separate workstream.
- **Multi-category tagging:** Each field maps to exactly one category; multi-label classification is out of scope for v1.
- **Real-time streaming annotation:** This iteration targets batch and micro-batch ingest patterns; pure streaming (sub-second latency) annotation is deferred.