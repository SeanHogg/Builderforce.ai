> **PRD** — drafted by Ada (Sr. Product Mgr) · task #190
> _Each agent that updates this PRD signs its change below._

# PRD: CI/CD Pipeline Failure Scanner

## Problem & Goal

Engineering teams lose significant time manually triaging CI/CD failures across pipeline runs, test suites, and build logs. Failures are siloed across multiple tools (GitHub Actions, Jenkins, CircleCI, build artifact stores), forcing engineers to context-switch and manually correlate errors. The goal is to build an automated scanner that continuously ingests pipeline results, test reports, and build logs, surfaces failures with structured context, and accelerates root-cause identification.

---

## Target Users / ICP Roles

| Role | Pain Point |
|---|---|
| **Software Engineer** | Spends 20–40 min per failed build manually reading raw logs |
| **DevOps / Platform Engineer** | Lacks a unified view across multiple CI systems and environments |
| **Engineering Manager** | Cannot track failure trends or flaky test patterns over time |
| **QA Engineer** | Cannot quickly distinguish infrastructure failures from test logic failures |

---

## Scope

### In Scope

- Scanning CI/CD pipeline run results (pass/fail/cancelled/timed-out)
- Parsing structured and unstructured build logs to extract failure signals
- Ingesting test suite reports (JUnit XML, pytest, Jest, etc.)
- Classifying and categorizing failure types
- Surfacing structured failure summaries with relevant log excerpts
- Storing scan results for trend analysis and querying

### Out of Scope

*(See dedicated section below)*

---

## Functional Requirements

### FR-1: Data Ingestion

- **FR-1.1** Connect to at least the following CI providers via API or webhook: GitHub Actions, GitLab CI, Jenkins, CircleCI.
- **FR-1.2** Accept test report uploads in JUnit XML format; additionally parse pytest JSON, Jest JSON output natively.
- **FR-1.3** Ingest raw build log files (plain text, gzipped) up to 500 MB per artifact.
- **FR-1.4** Support triggered (webhook/event-driven) and scheduled (polling) ingestion modes.
- **FR-1.5** Deduplicate pipeline run events; do not double-process the same run ID.

### FR-2: Failure Detection & Parsing

- **FR-2.1** Identify failed, errored, timed-out, and cancelled pipeline jobs and steps.
- **FR-2.2** Extract from build logs: error messages, stack traces, assertion failures, out-of-memory signals, network timeout indicators, and compilation errors using configurable pattern matching (regex + ML-assisted extraction).
- **FR-2.3** Parse test suite reports to enumerate: total tests run, passed, failed, skipped, errored; per-test duration; and failure messages with stack traces.
- **FR-2.4** Detect flaky tests by comparing failure/pass history for the same test identifier across the last N runs (configurable, default N=10).
- **FR-2.5** Assign a failure category to each detected failure from a defined taxonomy: `BUILD_COMPILE`, `TEST_ASSERTION`, `TEST_TIMEOUT`, `INFRA_NETWORK`, `INFRA_OOM`, `DEPENDENCY_MISSING`, `CONFIG_ERROR`, `UNKNOWN`.

### FR-3: Failure Classification & Enrichment

- **FR-3.1** Tag each failure with: repository, branch, commit SHA, pipeline/job/step name, timestamp, environment, and triggering actor.
- **FR-3.2** Extract and surface the 30-line window surrounding each detected error in the raw log (15 lines before, 15 lines after).
- **FR-3.3** Link test failures back to the source file and line number where available from test report metadata.
- **FR-3.4** Score each failure by estimated impact: `CRITICAL` (blocks merge/deploy), `HIGH` (fails required check), `MEDIUM` (non-required check fails), `LOW` (flaky/intermittent).
- **FR-3.5** Group repeated identical failures across jobs in the same pipeline run to avoid redundant reporting.

### FR-4: Storage & Querying

- **FR-4.1** Persist structured scan results (failure records) in a queryable data store with a defined schema.
- **FR-4.2** Retain raw log artifacts for a configurable retention window (default: 30 days).
- **FR-4.3** Expose a query API supporting filters on: repo, branch, date range, failure category, impact score, test name, and flakiness flag.
- **FR-4.4** Provide aggregate metrics per query: total failures, failure rate, most-failing test names, most-failing pipeline steps, mean time to failure recurrence.

### FR-5: Output & Reporting

- **FR-5.1** Produce a structured JSON failure report per pipeline scan containing all detected failures, categories, impact scores, and log excerpts.
- **FR-5.2** Produce a human-readable Markdown summary suitable for posting as a PR/MR comment or Slack message.
- **FR-5.3** Expose a REST API endpoint (`GET /scans/{run_id}`) to retrieve scan results for a given pipeline run.
- **FR-5.4** Optionally post failure summaries to configured notification channels (Slack webhook, GitHub PR comment, email) on scan completion.
- **FR-5.5** Emit trend reports (daily/weekly) showing failure frequency, flaky test lists, and top error categories across selected repositories.

### FR-6: Configuration

- **FR-6.1** All CI provider credentials, polling intervals, log retention, flakiness window (N), and notification targets must be configurable via a version-controlled config file (YAML) and environment variables.
- **FR-6.2** Support per-repository and per-branch inclusion/exclusion filter rules.
- **FR-6.3** Allow custom failure pattern definitions (regex) to extend the default taxonomy.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-1** | Given a completed GitHub Actions workflow run with at least one failed job, the scanner ingests the result within 2 minutes of the webhook event and produces a structured failure report. |
| **AC-2** | Given a JUnit XML test report with 5 failed tests, the scanner correctly extracts all 5 failure records including test name, class, failure message, and stack trace. |
| **AC-3** | Given a 200 MB raw build log containing a Go compilation error, the scanner identifies the error, assigns category `BUILD_COMPILE`, and surfaces the 30-line context window around the error. |
| **AC-4** | Given the same test has failed in 7 of the last 10 runs, the scanner flags it with `flaky: true` in the output. |
| **AC-5** | The `GET /scans/{run_id}` API responds within 500 ms for any stored scan result. |
| **AC-6** | Failure reports are deduplicated: re-processing the same pipeline run ID produces no duplicate failure records in the data store. |
| **AC-7** | The Markdown summary for a failed run renders correctly as a GitHub PR comment and includes: failure count, top 3 failure categories, and at least one log excerpt. |
| **AC-8** | A weekly trend report is generated and delivered to configured notification channels listing the top 5 flaky tests and top 3 failure categories for that week. |
| **AC-9** | All sensitive credentials (CI tokens, webhook secrets) are read from environment variables and never appear in logs or scan output. |
| **AC-10** | The scanner processes a pipeline run with 50 parallel jobs and 10,000 total log lines in under 60 seconds end-to-end. |

---

## Out of Scope

- **Automatic remediation or auto-retry** of failed pipeline jobs — the scanner surfaces failures only; it does not trigger reruns.
- **Source code analysis or static analysis** — failures are detected from runtime artifacts (logs, reports), not from code scanning.
- **Security vulnerability scanning** — CVE detection and SAST/DAST tooling are separate concerns.
- **Cost/billing analytics** for CI compute usage.
- **IDE plugins or local developer tooling** — the scanner operates on pipeline artifacts, not local builds.
- **Support for proprietary/internal CI systems** beyond the four listed providers in FR-1.1 (extensibility is planned but not in this release).
- **Real-time log streaming** — the scanner processes completed or flushed log artifacts, not live streaming log tails.
- **User authentication and role-based access control (RBAC)** — assumed to be handled by an external API gateway in this release.