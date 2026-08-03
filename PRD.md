> **PRD** — drafted by Ada (Sr. Product Mgr) · task #568
> _Each agent that updates this PRD signs its change below._
> - **2025-07-17 · Business Analyst** — authored the Requirements section (traceable, testable reqs derived from the already-specified functional requirements, acceptance criteria, scope, and out-of-scope).

# WIP Product Requirements Document: Per-Test-Case Verdict (Pass/Fail/Blocked)

## Problem & Goal
Testers currently cannot mark individual test cases as Blocked during execution. The binary Pass/Fail model does not capture scenarios where a test cannot be executed due to external dependencies (e.g., environment unavailability, missing data, blocked user story). This leads to inaccurate test run summaries, reduces visibility into true blocker impact, and forces testers to use workarounds (e.g., marking as Fail with a comment). 

We will introduce a three-state verdict (Pass, Fail, Blocked) selectable per test case during test execution, enabling accurate tracking, reporting, and faster root-cause identification of testing impediments.

## Target Users / ICP Roles
- **Manual QA Engineers** – primary users; they execute test cases and need to log the correct verdict.
- **Test Leads / Managers** – rely on accurate pass/fail/blocked metrics for release readiness reports.
- **SDETs / Automation Engineers** (optional consumer) – may consume verdict data for automated reporting; not the primary user for manual verdict assignment.

## Scope
- Extend the test execution UI to support a third verdict option: `Blocked`, alongside existing `Pass` and `Fail`.
- Store the selected verdict as a distinct field on the test case result record.
- Update all test-run-level summary calculations to reflect Blocked counts and percentages.
- Expose verdict filter (`Pass`, `Fail`, `Blocked`) in the test run details view.
- Retrofit existing reports/dashboards (where applicable) to display Blocked verdict data.
- Ensure backward compatibility: historical test results with only Pass/Fail remain unchanged; Blocked is an allowed new value.

## Functional Requirements
1. **Verdict Selection UI**: 
   - In the test case execution panel, display three radio buttons or a dropdown: Pass, Fail, Blocked.
   - Blocked must be visually distinct (e.g., orange icon/color) to differentiate from Fail.
   - Selecting Blocked optionally enables a mandatory “Blocked reason” field with a predefined list (e.g., “Environment”, “Data Issue”, “Dependency Unavailable”) and a free-text note (max 500 chars).
2. **Verdict Semantics**:
   - `Pass`: Test completed successfully, no defects found.
   - `Fail`: Test executed, but the actual result deviates from expected.
   - `Blocked`: Test could not be executed (or a critical precondition failed), preventing a Pass/Fail assessment.
3. **Permissions**:
   - Any role authorized to execute tests can set any of the three verdicts. No new permission required.
4. **Data Model**:
   - Test case result record extended with `verdict` enum (PASS, FAIL, BLOCKED) and `blocked_reason` (string, nullable).
   - Migration script to fill `verdict` for existing results based on current pass/fail flag; no existing record forced to Blocked.
5. **Aggregations**:
   - Test run totals: count of Pass, Fail, Blocked, Not Executed.
   - Pass rate = Pass / (Pass + Fail) – Blocked excluded from pass rate denominator.
   - Blocked rate = Blocked / Total test cases.
   - Test run status: “Blocked” if any test is Blocked and no failures; “Failed” if any Fail; “Passed” only if all are Pass.
6. **Filtering**:
   - In test run list, allow filtering by verdict with multi-select (Pass, Fail, Blocked, Not Executed).

## Acceptance Criteria
- Testers can select Blocked verdict for any test case during execution.
- After selection, the test case result is marked Blocked in the UI and database.
- Blocked test cases are excluded from the pass rate calculation.
- Test run summary box shows accurate counts for Pass, Fail, Blocked, and Not Executed.
- Attempting to save a Blocked verdict without a blocked reason (if mandatory) shows a validation error.
- Filters in the test run details correctly show/hide test cases based on selected verdicts.
- Existing test runs with historical data are unaffected and display correctly with the new schema.

## Out of Scope
- Automated assignment of Blocked status (e.g., via CI/CD pipeline hooks).
- Blocked reason workflow automation (e.g., automatically opening a ticket).
- Custom verdicts beyond Pass/Fail/Blocked.
- Impact on downstream defect-tracking integration (e.g., Jira) – will be handled in a follow-up epic.
- Merging Blocked with other test statuses like “Skipped” or “Not Applicable”.

## Requirements

### R1 — Verdict Enum & Data Model

**R1.1** The `qa_findings` table (or its equivalent test-case-result record) SHALL be extended with two new columns:
- `verdict` — a non-nullable enum of `'PASS'`, `'FAIL'`, `'BLOCKED'`. The column SHALL default to `'FAIL'` for rows where the existing pass/fail flag is `false`, and `'PASS'` where it is `true`. This default covers the backfill migration (R5.1).
- `blocked_reason` — a nullable `varchar(500)`. This column SHALL be `NULL` when `verdict` is `'PASS'` or `'FAIL'`. It SHALL be required (non-null, non-empty) when `verdict` is `'BLOCKED'`, enforced at the application layer.

**R1.2** The existing boolean pass/fail column SHALL be preserved to avoid breaking downstream consumers that do not yet consume `verdict`. The column is considered deprecated and SHALL be kept in sync with `verdict` on write (PASS → true, FAIL/BLOCKED → false) until removed in a future migration.

**R1.3** A `blocked_reason_category` enum SHALL be defined with the following initial values: `'ENVIRONMENT'`, `'DATA_ISSUE'`, `'DEPENDENCY_UNAVAILABLE'`, `'TEST_CASE_DEFECT'`, `'OTHER'`. This field is nullable, non-null when verdict is BLOCKED, and drives the predefined-list UI.

### R2 — Verdict Selection UI

**R2.1** The test-case execution panel SHALL render three mutually-exclusive verdict controls (radio buttons or a segmented button group): Pass, Fail, Blocked.

**R2.2** The Blocked option SHALL be visually distinct from Fail, using an orange/amber color treatment (icon, border, or background) consistent with the platform's existing status color system.

**R2.3** When the tester selects Blocked, two additional fields SHALL appear inline below the verdict control:
- `blocked_reason_category` (required dropdown, values per R1.3).
- `blocked_reason` (required free-text, max 500 chars).

**R2.4** Attempting to save/submit a Blocked verdict with an empty `blocked_reason_category` or `blocked_reason` SHALL trigger a client-side validation error preventing submission. The error SHALL highlight the empty required field(s) with an inline message.

**R2.5** Switching from Blocked back to Pass or Fail SHALL clear the `blocked_reason` and `blocked_reason_category` fields and hide them.

**R2.6** The verdict control SHALL be enabled only when the test case is in an executable state (not in a "Not Executed" terminal state, unless the tester is explicitly logging a skip).

### R3 — Test Run Aggregation

**R3.1** Every test-run summary SHALL compute and display four counts: Pass, Fail, Blocked, and Not Executed. "Not Executed" is the count of test cases assigned to the run for which no verdict has been recorded.

**R3.2** Pass rate SHALL be calculated as:

```
passRate = passCount / (passCount + failCount)
```

Blocked test cases SHALL be excluded from the denominator. When `passCount + failCount == 0`, the pass rate SHALL be displayed as "N/A" (not zero).

**R3.3** Blocked rate SHALL be calculated as:

```
blockedRate = blockedCount / totalTestCases
```

where `totalTestCases` is the count of all test cases assigned to the run.

**R3.4** The derived test-run status SHALL follow the precedence rules below (evaluated top-to-bottom):
1. If any test case is `FAIL` → run status is **"Failed"**.
2. Else if any test case is `BLOCKED` → run status is **"Blocked"**.
3. Else if all test cases are `PASS` → run status is **"Passed"**.
4. Else (all Not Executed) → run status is **"Not Started"**.

**R3.5** When a test run's status changes, the event SHALL be recorded in the audit/activity log with the previous and new status, the acting user, and a timestamp.

### R4 — Verdict Filtering

**R4.1** The test-run details view SHALL include a multi-select verdict filter with options: Pass, Fail, Blocked, Not Executed.

**R4.2** The filter SHALL default to "All" (all four options selected).

**R4.3** Filter state SHALL be preserved in the URL query string so that sharing or refreshing the page retains the filter selection.

**R4.4** The test-case list SHALL reactively update to show or hide rows based on selected verdict filters without a full page reload.

### R5 — Data Migration & Backward Compatibility

**R5.1** A database migration SHALL be authored that:
- Adds the `verdict` column (non-nullable enum: PASS, FAIL, BLOCKED) with a default of `'FAIL'`.
- Adds the `blocked_reason` column (nullable varchar(500)).
- Adds the `blocked_reason_category` column (nullable enum per R1.3).
- Backfills `verdict` for all existing rows: `'PASS'` where the existing pass/fail boolean is `true`, `'FAIL'` otherwise.
- After backfill, alters the `verdict` column default to `NULL` so new inserts must explicitly set it.

**R5.2** No existing row SHALL be assigned `verdict = 'BLOCKED'` by the migration. Blocked is a new status that can only be set by a tester at execution time.

**R5.3** The migration SHALL be idempotent (safe to re-run) and SHALL be placed in the `api/migrations/` directory following the existing numeric-prefix naming convention.

### R6 — API Endpoints

**R6.1** The `PATCH /api/test-cases/:id/verdict` endpoint (or the existing test-case-result upsert endpoint) SHALL accept the new `verdict`, `blocked_reason`, and `blocked_reason_category` fields in the request body and persist them.

**R6.2** The endpoint SHALL reject requests where `verdict = 'BLOCKED'` and `blocked_reason_category` is missing or empty, returning HTTP 422 with a structured error body.

**R6.3** The test-run summary endpoint (e.g., `GET /api/test-runs/:id/summary`) SHALL include `passCount`, `failCount`, `blockedCount`, `notExecutedCount`, `passRate`, `blockedRate`, and the derived run status in its response payload.

**R6.4** The test-case list endpoint SHALL accept an optional `verdict` query parameter (comma-separated values: `pass,fail,blocked,not_executed`) to support server-side filtering.

### R7 — Reporting & Dashboards

**R7.1** Any existing report or dashboard that displays pass/fail counts per test run SHALL be updated to also include Blocked counts. At minimum, this covers:
- The test-run details summary panel.
- The project-level quality-insights lens (if it surfaces test-run data).
- Any exported tabular report that includes test-case verdicts.

**R7.2** A new "Blocked Reasons Breakdown" summary SHALL be displayed on the test-run details page: a simple table or bar chart counting Blocked test cases grouped by `blocked_reason_category`.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
