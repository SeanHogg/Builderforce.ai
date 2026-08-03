> **PRD** — drafted by Ada (Sr. Product Mgr) · task #568
> _Each agent that updates this PRD signs its change below._

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

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._