> **PRD** — drafted by Ada (Sr. Product Mgr) · task #580
> _Each agent that updates this PRD signs its change below._

# PRD: Test Cases Execution Module

## Problem & Goal
QA teams lack a single interface to execute test cases, capture real-time results, and monitor progress. This leads to scattered status updates and delayed release decisions.

**Goal**: Provide a test execution workspace where testers can run assigned tests step-by-step, log outcomes with evidence, and enable managers to track execution metrics and readiness via dashboards and reports.

## Target Users / ICP Roles
- **QA Testers**: Execute test cases, record step results, attach evidence.
- **QA Leads / Managers**: Plan test runs, assign work, monitor execution progress, export reports.
- **Developers**: View failed test details for debugging (read-only access to execution logs).

## Scope
- Create test runs from existing test suites.
- Assign runs to testers.
- Step-by-step execution interface with real-time status updates.
- Capture pass/fail/blocked per step, with optional comments and file attachments.
- Auto-derive test case result from step outcomes (override permitted).
- Execution progress dashboard (percent complete, pass/fail/blocked counts).
- Summary report generation (PDF export).
- REST API to programmatically submit results (for automated tests).

## Functional Requirements
1. **Test Run Creation**  
   - User can select test cases from one or more suites to form a new test run.  
   - Support a maximum of 500 test cases per run.  
   - Assign one or more testers to the run.

2. **Execution Workspace**  
   - Tester sees assigned test runs and can open an execution view.  
   - Each test case displays its steps one at a time.  
   - For each step, tester logs result: Pass, Fail, or Blocked.  
   - Add free-text comment per step.  
   - Upload attachments (screenshots, logs) per step (max 10 MB per file).  
   - Step result updates instantly in the UI; any change recalculates the test case result in real time.  
   - Overall test case result auto-calculated:  
     - Fail if any step fails.  
     - Blocked if any step is blocked and no step fails.  
     - Pass if all steps are pass or none are fail/blocked.  
   - Tester can manually override the final test case result with a reason.

3. **Progress & Monitoring**  
   - Dashboard per test run showing:  
     - % executed  
     - Pass/Fail/Blocked counts  
     - Testers' individual progress  
   - Refresh on demand.

4. **Reporting**  
   - Generate a PDF summary report including run metadata, execution statistics, and per-case details (results, comments, attachments).  
   - Report generation must complete within 10 seconds for runs with 500 test cases.

5. **API**  
   - REST endpoint to accept a test run result payload (test case ID, step results) from external automated frameworks.  
   - Response must return within 2 seconds.

## Acceptance Criteria
- Create a test run with 500 test cases without error.  
- Tester loads an assigned test case; step data and controls render in under 3 seconds.  
- Changing a step result immediately updates the per-case result indicator without page reload.  
- Attachment upload of a 10 MB file succeeds and is viewable in the execution log.  
- Dashboard metrics update when a tester completes a test case.  
- PDF summary report for a 500-case run is generated and downloadable within 10 seconds.  
- API can ingest 100 test results per second without data loss.

## Out of Scope
- Creation, editing, or versioning of test cases (managed in existing Test Case module).  
- Built-in integration with bug trackers (Jira, etc.) – planned for future phase.  
- Real-time collaboration features (simultaneous execution by multiple testers on the same run).  
- Automated test execution triggers or CI orchestration; the API only accepts results.  
- Performance/load testing capabilities.

## Requirements

> **Author**: Business Analyst · task #580

### REQ-1: Core Domain Model

#### REQ-1.1: Test Run Entity
A **Test Run** represents a single execution cycle — a planned session where one or more testers execute a curated set of test cases.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier. |
| `title` | String (255) | Yes | Human-readable name, e.g. "Sprint 14 Regression — iOS". |
| `description` | Text | No | Optional context for the run (goal, environment, build version). |
| `status` | Enum | Yes | `draft`, `in_progress`, `completed`, `archived`. Runs start as `draft` until the first result is logged, then transition to `in_progress`. |
| `sourceSuiteIds` | UUID[] | Yes | References to one or more existing test suites (read-only — suites managed externally). |
| `assignedTesterIds` | UUID[] | Yes | One or more tester user IDs. |
| `maxCases` | Integer | Yes | Constraint: ≤ 500 (enforced at creation). |
| `createdBy` | UUID | Yes | User who created the run. |
| `createdAt` | Timestamp | Yes | Auto-set. |
| `updatedAt` | Timestamp | Yes | Auto-set. |
| `completedAt` | Timestamp | No | Set when status transitions to `completed`. |

**Rules:**
- REQ-1.1.1: A run must reference at least 1 and at most 500 test cases.
- REQ-1.1.2: A run must have at least one assigned tester.
- REQ-1.1.3: `sourceSuiteIds` are validated at creation time; suites must exist and be active.
- REQ-1.1.4: Deleting a suite does not cascade-delete its runs; historical run data is preserved.

#### REQ-1.2: Test Case Result Entity
A **Test Case Result** captures the execution outcome of one test case within a run.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier. |
| `testRunId` | UUID | Yes | FK to Test Run. |
| `testCaseId` | UUID | Yes | FK to the externally-managed test case. |
| `executedBy` | UUID | No | Tester who last executed this case. |
| `status` | Enum | Yes | `not_executed`, `pass`, `fail`, `blocked`, `skipped`. Defaults to `not_executed`. |
| `overrideStatus` | Enum | No | Manual override of auto-calculated result: `pass`, `fail`, `blocked`. |
| `overrideReason` | Text | No | Required when `overrideStatus` is set. |
| `executionOrder` | Integer | No | Sequence within the run (default: insertion order). |
| `startedAt` | Timestamp | No | When execution began for this case. |
| `completedAt` | Timestamp | No | When the final step result was logged. |

**Rules:**
- REQ-1.2.1: The `status` field is normally auto-calculated from step results (see REQ-3.3). When `overrideStatus` is set, the displayed result is the override value and `status` retains the calculated value for audit.
- REQ-1.2.2: Override requires a non-empty `overrideReason`.
- REQ-1.2.3: A test case result is considered "executed" once at least one step has a logged result.

#### REQ-1.3: Step Result Entity
A **Step Result** captures the outcome of a single step within a test case execution.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier. |
| `testCaseResultId` | UUID | Yes | FK to Test Case Result. |
| `stepNumber` | Integer | Yes | 1-based step position within the test case. |
| `expectedBehavior` | Text | Yes | Copied from the test case step at execution time (immutable snapshot). |
| `result` | Enum | Yes | `pass`, `fail`, `blocked`, `not_executed`. |
| `comment` | Text | No | Free-text notes from the tester. |
| `attachments` | Attachment[] | No | Zero or more file attachments. |
| `loggedBy` | UUID | Yes | Tester who recorded this result. |
| `loggedAt` | Timestamp | Yes | Auto-set. |
| `updatedAt` | Timestamp | Yes | Auto-set on edit. |

**Rules:**
- REQ-1.3.1: `expectedBehavior` is snapshotted from the test case at the time the step result is first created. Changes to the source test case after execution do not retroactively alter logged results.
- REQ-1.3.2: Each attachment must be ≤ 10 MB. The system must validate file size before upload.
- REQ-1.3.3: Supported attachment types: PNG, JPEG, GIF, BMP, WEBP, MP4 (≤ 30s), TXT, LOG, CSV, JSON, XML, PDF, ZIP. Reject all other types.

#### REQ-1.4: Attachment Entity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier. |
| `stepResultId` | UUID | Yes | FK to Step Result. |
| `fileName` | String (255) | Yes | Original file name. |
| `fileSize` | Integer | Yes | Bytes. |
| `contentType` | String | Yes | MIME type. |
| `storagePath` | String | Yes | Object storage key. |
| `uploadedBy` | UUID | Yes | Uploader. |
| `uploadedAt` | Timestamp | Yes | Auto-set. |

### REQ-2: Test Run Lifecycle & Workflows

#### REQ-2.1: Run Creation Workflow
1. **QA Lead** navigates to the "New Test Run" screen.
2. Selects one or more test suites from a searchable, filterable list.
3. The system displays a preview of the selected test cases (title, priority, estimated duration) with a count. The UI must show a warning if the selection exceeds 500 cases and disable creation.
4. The lead can de-select individual cases within the chosen suites.
5. Assigns one or more testers from the team roster (searchable, with current workload indicators).
6. Provides a title and optional description.
7. On submit, the system creates the Test Run with status `draft` and the selected Test Case Results (all `not_executed`).
8. The lead is redirected to the run detail page.

**Edge Cases:**
- REQ-2.1.1: If a selected suite is archived between selection and submission, show a validation error and allow the user to remove it.
- REQ-2.1.2: If all selected testers are deactivated, reject creation with an error.
- REQ-2.1.3: Duplicate test cases across selected suites must be deduplicated (by test case ID), keeping the first occurrence.

#### REQ-2.2: Run Status Transitions
```
draft ──(first result logged)──▶ in_progress ──(all cases executed)──▶ completed
  │                                    │
  └──(manual archive)──▶ archived      └──(manual archive, all-or-nothing)──▶ archived
```
- REQ-2.2.1: A `completed` run can be re-opened (transition back to `in_progress`) by the QA Lead.
- REQ-2.2.2: Only runs in `draft` or `completed` can be archived.
- REQ-2.2.3: Archiving is reversible by the QA Lead.

#### REQ-2.3: Tester Assignment Changes
- REQ-2.3.1: QA Lead can add or remove testers from a run at any status except `archived`.
- REQ-2.3.2: Removing a tester does not delete their logged results.
- REQ-2.3.3: When a tester is added mid-run, they see all unexecuted cases.

### REQ-3: Execution Workspace (Tester Experience)

#### REQ-3.1: My Assignments View
- REQ-3.1.1: Tester lands on a dashboard showing all runs assigned to them, grouped by status (in_progress first, then draft, then completed).
- REQ-3.1.2: Each run card shows: title, % executed, pass/fail/blocked counts (own contribution), and overall run progress.
- REQ-3.1.3: Clicking a run opens the execution workspace.

#### REQ-3.2: Execution View Layout
- REQ-3.2.1: Split-pane layout:
  - **Left panel**: List of test cases in the run, color-coded by status (grey=not_executed, green=pass, red=fail, amber=blocked). Current case is highlighted.
  - **Right panel**: The active test case with its steps displayed sequentially.
- REQ-3.2.2: Tester navigates between cases via the left panel or "Next Case" / "Previous Case" buttons.
- REQ-3.2.3: The system remembers the last case the tester was on and returns to it on re-entry.

#### REQ-3.3: Step Execution Flow
1. Tester selects a test case (or the system auto-advances).
2. The system displays step 1 with its expected behavior and result controls.
3. Tester selects: **Pass**, **Fail**, or **Blocked**.
4. Optional: add a comment and/or upload attachments.
5. System auto-saves the step result (no explicit "Save" button per step — optimistic save with debounce).
6. The next step is revealed. Steps are shown one at a time but previously-logged steps remain visible as a scrollable log below the current step.
7. After the last step is logged, the case result auto-calculates:
   - **Fail** if ANY step = Fail.
   - **Blocked** if ANY step = Blocked AND NO step = Fail.
   - **Pass** otherwise (all steps Pass, or mixed Pass/not_executed).
8. The UI shows the calculated result prominently with a "Mark as Complete" button.
9. Tester can override the result via an "Override" action, requiring a reason.

**Edge Cases:**
- REQ-3.3.1: Tester can revisit and change any previously-logged step at any time; changing a step result triggers recalculation of the case result.
- REQ-3.3.2: If a tester marks a step as Blocked, the UI prompts "Continue or return later?" — they can skip remaining steps or proceed.
- REQ-3.3.3: Attachments are uploaded asynchronously; the step result saves immediately with a placeholder that resolves when the upload completes.

#### REQ-3.4: Real-Time Result Calculation
- REQ-3.4.1: Step result changes must propagate to the case result indicator in under 500ms (client-side calculation preferred; server reconciliation on save).
- REQ-3.4.2: Case result changes must propagate to the run dashboard within 2 seconds of the server acknowledging the change (websocket or polling).
- REQ-3.4.3: No page reload is required for any result update.

### REQ-4: Progress Dashboard (QA Lead View)

#### REQ-4.1: Run-Level Dashboard
- REQ-4.1.1: Single-run dashboard accessible from the runs list.
- REQ-4.1.2: Displays:
  - **Progress bar**: % executed (cases with at least one logged step / total cases).
  - **Result breakdown**: Pass count, Fail count, Blocked count, Not Executed count.
  - **Pass rate**: Pass / (Pass + Fail) × 100%.
  - **Elapsed time**: Since the run moved to `in_progress`.
- REQ-4.1.3: **Per-tester breakdown table**: Tester name, cases assigned, cases executed, pass/fail/blocked counts, % complete.

#### REQ-4.2: Aggregate Dashboard
- REQ-4.2.1: Across all active runs: total cases, % executed, pass rate, runs by status.
- REQ-4.2.2: Filter by date range, suite, tester, or status.

#### REQ-4.3: Refresh Behavior
- REQ-4.3.1: Manual refresh button; data re-fetches from the server on click.
- REQ-4.3.2: Optional auto-refresh toggle (30s interval); disabled by default.

### REQ-5: Reporting

#### REQ-5.1: PDF Report Content
- REQ-5.1.1: Cover page: run title, description, creator, dates, overall stats.
- REQ-5.1.2: Summary section: pass/fail/blocked/not-executed counts, pass rate, per-tester stats.
- REQ-5.1.3: Per-case detail: test case ID, title, final result, execution time, each step with expected behavior, actual result, comment, and attachment thumbnails (linked to the stored file).
- REQ-5.1.4: Footer on every page: report generation timestamp, page number, confidentiality notice.

#### REQ-5.2: Generation Constraints
- REQ-5.2.1: Must complete within 10 seconds for a 500-case run (asynchronous generation acceptable; user can download once ready).
- REQ-5.2.2: The system queues report generation jobs; a run can have at most one pending generation at a time.
- REQ-5.2.3: Generated reports are stored for 30 days, then purged.

### REQ-6: REST API

#### REQ-6.1: Submit Results Endpoint
- REQ-6.1.1: `POST /api/v1/test-runs/{runId}/results`
- REQ-6.1.2: Request body:

```json
{
  "testCaseId": "uuid",
  "steps": [
    {
      "stepNumber": 1,
      "result": "pass",
      "comment": "optional"
    }
  ],
  "overrideStatus": "pass",
  "overrideReason": "optional"
}
```

- REQ-6.1.3: Authentication: API key (header `X-Api-Key`) or bearer token. Each key is scoped to specific runs.
- REQ-6.1.4: The endpoint must respond within 2 seconds (202 Accepted with a job ID is acceptable for attachment-heavy payloads; 200 OK for results-only payloads).
- REQ-6.1.5: Rate limiting: 100 requests/second per API key. Requests beyond the limit receive 429 with `Retry-After` header.

#### REQ-6.2: API Key Management
- REQ-6.2.1: QA Leads can generate, revoke, and scope API keys.
- REQ-6.2.2: API keys are shown once at creation; the system stores only a hash.
- REQ-6.2.3: Each key has an optional expiry date.

#### REQ-6.3: Idempotency
- REQ-6.3.1: API requests include an optional `Idempotency-Key` header. Duplicate submissions with the same key within 24 hours return the original response.

### REQ-7: Non-Functional Requirements

#### REQ-7.1: Performance
| Metric | Target |
|--------|--------|
| Step result save (save → UI confirmation) | < 1s |
| Execution view load (click case → steps rendered) | < 3s |
| Dashboard load (run-level) | < 2s |
| PDF generation (500-case run) | < 10s |
| API response (results-only) | < 2s |
| API throughput | ≥ 100 results/s |

#### REQ-7.2: Availability
- REQ-7.2.1: 99.5% uptime during business hours (08:00–20:00 local, Mon–Fri).
- REQ-7.2.2: Planned maintenance windows: Saturday 02:00–06:00.

#### REQ-7.3: Data Integrity
- REQ-7.3.1: Step results must never be lost once acknowledged by the server. All writes are durable (write-ahead log or equivalent).
- REQ-7.3.2: Attachment uploads use multipart upload with checksum verification.
- REQ-7.3.3: Test run results are retained indefinitely unless explicitly archived and purged (minimum 2-year retention for audit).

#### REQ-7.4: Security
- REQ-7.4.1: All endpoints require authentication.
- REQ-7.4.2: Role-based access: QA Tester (execute assigned runs, view own results), QA Lead (create/manage runs, view all results, generate reports, manage API keys), Developer (read-only view of execution logs for failed cases).
- REQ-7.4.3: Attachments are scanned for malware on upload (reject infected files before storage).
- REQ-7.4.4: All data in transit uses TLS 1.3.
- REQ-7.4.5: Audit log captures: who created/edited/archived a run, who logged/changed each step result, who generated/downloaded a report, who created/revoked an API key.

#### REQ-7.5: Accessibility
- REQ-7.5.1: WCAG 2.1 Level AA compliance.
- REQ-7.5.2: All result indicators use both color and icon/shape (not color alone).
- REQ-7.5.3: Keyboard-navigable execution workspace (Tab through steps, Enter to log result, Space to toggle).

#### REQ-7.6: Browser Support
- REQ-7.6.1: Latest two major versions of Chrome, Firefox, Safari, and Edge.

### REQ-8: Error Handling & Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Network interruption during step save | Retry up to 3 times with exponential backoff; show offline indicator; queue results locally if persistent. |
| Attachment exceeds 10 MB | Reject before upload with clear error message showing file size and limit. |
| Concurrent step edits (two tabs) | Last-write-wins with a conflict warning toast in the stale tab. |
| Test case deleted from source suite mid-run | The test case result row is preserved with a "source deleted" flag; the case is excluded from progress calculation. |
| Run with 0 executable cases (all source-deleted) | Allow the run to be archived immediately. |
| PDF generation failure | Notify the requester; allow retry; log the failure for ops. |
| API key compromised | Revoke immediately; all in-flight requests with that key return 401. |

### REQ-9: Integration Points

- REQ-9.1: **Test Case Module** (existing, external): Read-only access to test cases, suites, and step definitions. The execution module does not modify test cases.
- REQ-9.2: **User Directory / IAM**: User lookup, role resolution, and authentication tokens.
- REQ-9.3: **Object Storage**: Attachment persistence (S3-compatible API).
- REQ-9.4: **Notification Service**: Email/in-app notifications for run assignment, run completion, and report readiness.
- REQ-9.5: **CI/CD Pipelines** (future): Results submission via the REST API (REQ-6).

### REQ-10: Constraints & Assumptions

- REQ-10.1: Test cases and suites already exist and are accessible via a read API. The execution module does not own test case CRUD.
- REQ-10.2: Users and roles are managed by an existing IAM system; the execution module consumes role claims from the auth token.
- REQ-10.3: Object storage (S3-compatible) is available and provisioned before this module is deployed.
- REQ-10.4: A message queue or job system exists for asynchronous work (report generation, attachment scanning).
- REQ-10.5: The system clock is synchronized across all services (NTP).
- REQ-10.6: Step result "instant" UI updates assume a network round-trip under 200ms; offline support (REQ-8) covers degraded conditions.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
