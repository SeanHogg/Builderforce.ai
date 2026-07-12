> **PRD** — drafted by Ada (Sr. Product Mgr) · task #221
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: PRD Backlog Analysis Tool

## Problem & Goal

Product and engineering teams accumulate PRDs in various states of completeness across wikis, project management tools, and shared documents. There is no systematic way to evaluate which draft PRDs have met a "ready" threshold, causing sprint planning delays, misaligned prioritization, and wasted grooming time debating incomplete specs.

**Goal:** Build an automated analysis tool that ingests a backlog of PRDs, evaluates each against a configurable readiness rubric, and produces a prioritized report identifying which specs are ready to move forward and what gaps remain in those that are not.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Product Manager** | Quickly identify which PRDs can be handed to engineering without further clarification |
| **Engineering Lead / Tech Lead** | Know before sprint planning which specs are actionable and unambiguous |
| **Program / Delivery Manager** | Maintain pipeline health by tracking draft-to-ready conversion rate over time |
| **Head of Product / CPO** | Visibility into backlog readiness as a leading indicator of delivery capacity |

---

## Scope

### In Scope

- Ingestion of PRDs stored in supported formats and sources (Markdown files, Confluence pages, Notion documents, Linear descriptions, plain text)
- Automated scoring of each PRD against a readiness rubric
- Classification of each PRD as **Draft**, **Near-Ready**, or **Ready**
- Gap report per PRD listing which rubric dimensions are incomplete or ambiguous
- Ranked output list of Near-Ready PRDs with the smallest delta to Ready
- Human-reviewable summary report (Markdown and JSON output)
- Configurable rubric weights per organization

### Out of Scope

- Authoring or rewriting PRD content
- Integration with ticketing systems (Jira, Linear ticket creation) — Phase 2
- Real-time collaborative editing
- Enforcement or workflow automation (e.g., blocking PRDs from sprint boards)

---

## Functional Requirements

### FR-1: PRD Ingestion

- **FR-1.1** The system must accept a directory of Markdown files as input via CLI.
- **FR-1.2** The system must accept a Confluence space URL and API token to fetch pages from a specified space or label.
- **FR-1.3** The system must accept a Notion database ID and integration token to fetch pages from a Notion database.
- **FR-1.4** Each ingested document must be assigned a unique identifier and stored with its source metadata (title, URL or file path, last-modified date, author if available).
- **FR-1.5** Documents under 100 words must be flagged as **Stub** and excluded from scoring.

### FR-2: Readiness Rubric Evaluation

Each PRD is scored across the following dimensions. Scores are 0 (absent), 1 (partial), or 2 (complete).

| Dimension | Description |
|---|---|
| **Problem Statement** | A clear articulation of the user problem or business opportunity |
| **Goal / Success Metric** | At least one measurable outcome defined |
| **Target User** | User role, persona, or segment identified |
| **Functional Requirements** | At least three discrete, testable requirements present |
| **Acceptance Criteria** | Explicit pass/fail conditions tied to requirements |
| **Out of Scope** | Explicit exclusions documented |
| **Dependencies** | External systems, teams, or conditions noted (or explicitly stated as none) |
| **Open Questions** | Outstanding decisions tracked (or explicitly stated as none) |

- **FR-2.1** The system must evaluate all eight rubric dimensions for every non-Stub PRD.
- **FR-2.2** Rubric dimension weights must be configurable via a YAML config file. Default weights are equal.
- **FR-2.3** A weighted total score must be computed and normalized to a 0–100 scale.

### FR-3: Classification

- **FR-3.1** PRDs scoring **80–100** are classified **Ready**.
- **FR-3.2** PRDs scoring **50–79** are classified **Near-Ready**.
- **FR-3.3** PRDs scoring **0–49** are classified **Draft**.
- **FR-3.4** Classification thresholds must be configurable via the YAML config file.

### FR-4: Gap Reporting

- **FR-4.1** For every PRD not classified Ready, the system must output which specific rubric dimensions scored 0 or 1.
- **FR-4.2** For each gap, the system must output a plain-English description of what is missing or incomplete.
- **FR-4.3** Near-Ready PRDs must include an estimated effort label (Low / Medium / High) to reach Ready, based on the number and weight of remaining gaps.

### FR-5: Ranked Output

- **FR-5.1** The system must output a ranked list of all Near-Ready PRDs sorted by ascending gap-to-Ready score (easiest to promote first).
- **FR-5.2** The ranked list must include: PRD title, current score, missing dimensions, estimated effort to Ready.
- **FR-5.3** The system must separately list all Ready PRDs sorted by descending score.

### FR-6: Report Generation

- **FR-6.1** The system must generate a Markdown summary report (`readiness-report.md`) containing the ranked lists and per-PRD gap summaries.
- **FR-6.2** The system must generate a machine-readable JSON file (`readiness-report.json`) with the full scoring data for downstream tooling.
- **FR-6.3** Report generation must complete in under 60 seconds for a backlog of up to 200 PRDs.

### FR-7: Configuration

- **FR-7.1** A `rubric-config.yaml` file must support overriding: dimension weights, classification thresholds, minimum word count for Stub detection, and output file paths.
- **FR-7.2** The system must validate the config file on startup and exit with a descriptive error if the config is invalid.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-1** | Given a directory of 10 Markdown PRDs with known scores, the tool classifies each correctly per the rubric with ≥ 95% dimension-level accuracy compared to a human-reviewed ground-truth set. |
| **AC-2** | Given a PRD with no Problem Statement and no Acceptance Criteria, the gap report lists both dimensions with plain-English descriptions of what is missing. |
| **AC-3** | Given a PRD scoring 72, the tool classifies it as Near-Ready and lists it in the ranked output with estimated effort to Ready. |
| **AC-4** | Given a custom `rubric-config.yaml` that sets the Ready threshold to 90, PRDs scoring 80–89 are reclassified as Near-Ready. |
| **AC-5** | Given a Confluence space with 50 pages, all pages are ingested, de-duplicated by URL, and appear in the output report. |
| **AC-6** | Given a document of 80 words, the tool flags it as Stub and excludes it from scoring and ranked lists. |
| **AC-7** | The Markdown report and JSON report are generated and written to the configured output paths after every run. |
| **AC-8** | A backlog of 200 PRDs completes analysis and report generation in under 60 seconds on standard laptop hardware (2020 or later, 8 GB RAM). |
| **AC-9** | An invalid `rubric-config.yaml` (e.g., weights that do not sum to 1.0) causes the tool to exit with a non-zero status code and a descriptive error message before processing any documents. |

---

## Out of Scope

- **PRD authoring assistance** — the tool analyzes existing content; it does not suggest replacement text or rewrite sections.
- **Ticketing system integration** — creating or updating Jira issues, Linear tickets, or GitHub Issues is deferred to Phase 2.
- **Real-time or streaming ingestion** — the tool operates as a batch process triggered manually or via CI; webhook-driven continuous analysis is not included.
- **Access control and multi-tenant support** — all users running the tool share the same config and output; role-based access is not implemented.
- **Historical trending dashboards** — comparing readiness scores across runs over time is deferred to Phase 2.
- **Natural language generation of missing PRD sections** — using LLMs to auto-complete gaps is explicitly out of scope for this phase.
- **Support for binary document formats** — DOCX, PDF, and PowerPoint ingestion are not supported in this phase.