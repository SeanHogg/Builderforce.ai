> **PRD** — drafted by Ada (Sr. Product Mgr) · task #581
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Test Case Verdict Assignment

## Problem & Goal
Testers executing test cases currently lack a standardized, low-friction mechanism to record the result of a test execution as Pass, Fail, or Blocked. This leads to inconsistent status reporting, difficulty in tracking test progress, and unreliable quality metrics. The goal is to enable testers to assign a clear verdict (Pass / Fail / Blocked) to each test case during or after execution, providing a reliable signal for release readiness and defect triage.

## Target Users / ICP Roles
- **Manual Testers**: Primary users executing test cases and recording results.
- **QA Leads / Managers**: Rely on aggregated verdicts for test run health and reporting.
- **Automation Engineers** (secondary): May push automated verdicts through an API.

## Scope
- Allow a tester to set exactly one verdict per test case execution: `Pass`, `Fail`, or `Blocked`.
- Support verdict assignment both inline (within a test run list) and on a test case detail view.
- Include an optional free‑text comment and, for `Blocked`, a mandatory reason selector (e.g., environment, missing data, dependency).
- Make verdicts immediately visible in dashboard and reporting views.
- Prevent verdict changes if the test run has been finalized/closed (controlled by run state).

## Functional Requirements
1. **Verdict Options**  
   - Present three mutually exclusive verdict buttons/dropdown: **Pass**, **Fail**, **Blocked**.  
   - A test case initially has no verdict (unset). Once set, it can be changed until the run is finalized.

2. **Blocked Reason**  
   - When `Blocked` is selected, a reason must be provided from a predefined list: `Environment Unavailable`, `Test Data Missing`, `Dependency Failed`, `Other`.  
   - `Other` allows an optional free‑text clarification.

3. **Comments**  
   - Allow an optional text comment (max 2000 chars) for any verdict, useful for failure details or blocking context.

4. **Run Finalization**  
   - Verdicts cannot be modified after the test run is marked as “Closed” or “Finalized”. An attempt should show an informative tooltip.

5. **Bulk Update (optional quick‑action)**  
   - From the test run list view, allow selecting multiple test cases and applying the same verdict (excludes `Blocked` because reason is missing). Bulk `Blocked` is disallowed; user must set individually.

6. **Audit Log**  
   - Record timestamp, user, old verdict, new verdict, and comment for every change (accessible through an activity log).

7. **API Support**  
   - Provide a REST endpoint `PATCH /test-runs/{runId}/test-cases/{testCaseId}` with body `{ "verdict": "pass", "comment": "...", "blockedReason": "..." }` to allow automation frameworks to push results.

## Acceptance Criteria
- Tester can click **Pass** on a test case; the verdict updates immediately and a success feedback (e.g., green checkmark) appears.
- Tester clicks **Fail**; verdict changes to Fail with a red cross. No additional required fields.
- Tester clicks **Blocked**; a modal prompts for reason selection. On confirm, verdict shows Blocked (grey/blocked icon) and the reason is stored.
- Changing from Pass to Fail on an open run is allowed; audit log captures the transition.
- Attempting to change verdict on a finalized run shows an error message “Run is finalized; verdicts cannot be modified.”
- Bulk marking three test cases as Pass succeeds; bulk Blocked option is not offered.
- API call with valid payload updates verdict and returns 200; invalid payload (missing blocked reason when verdict=blocked) returns 422 with descriptive error.

## Out of Scope
- Custom verdicts beyond Pass, Fail, Blocked (e.g., Skipped, Not Applicable) — these will be handled in a future iteration.
- Linking verdicts automatically to bug tickets (manual linking remains an external workflow).
- Workflow rules that automatically advance test case status based on verdict (e.g., auto-assign bugs to developers).
- Conditional logic for verdict availability based on test case type or traceability.

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