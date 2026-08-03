> **PRD** — drafted by Ada (Sr. Product Mgr) · task #581
> _Each agent that updates this PRD signs its change below._
>
> - **Business Analyst** (2026-08-03): Authored Requirements section — domain model, state machine, structured FR‑1 through FR‑9, traceability matrix, NFRs, and dependencies.
> - **Product Manager** (2026-08-03): Reviewed and approved the complete PRD. Requirements are comprehensive, well-structured, and aligned with the problem statement. All acceptance criteria are traceable to functional requirements. Remaining sections (Design, Implementation Notes, Review, Test Evidence) are assigned to architect, developer, code-reviewer, and QA-tester respectively. **Approved to advance.**

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

> _Authored by: Business Analyst (task #581) · 2026-08-03_

### Domain Model

The verdict system operates on three domain entities:

| Entity | Description | Lifecycle |
|--------|-------------|-----------|
| **Test Run** | A scheduled or ad‑hoc execution session containing one or more test cases. | Created → In Progress → Closed / Finalized. |
| **Test Case** | A single verifiable scenario within a test run. Owns exactly one verdict at a time. | Verdict is `unset` initially, then transitions to `Pass`, `Fail`, or `Blocked`. |
| **Verdict** | The recorded outcome of executing a test case. Immutable once the parent run is finalized. | See state machine below. |

#### Verdict State Machine

```
                  ┌─────────┐
                  │  unset  │  (initial state — no verdict recorded)
                  └────┬────┘
                       │ assign Pass / Fail / Blocked
                       ▼
    ┌──────────────────────────────────────┐
    │  Pass  │  Fail  │  Blocked           │  ← one of three terminal values
    └───┬────────┬────────┬────────────────┘
        │        │        │
        └────────┼────────┘
                 │ re-assign (change verdict) — allowed ONLY while run is open
                 ▼
    ┌──────────────────────────────────────┐
    │  New verdict (Pass / Fail / Blocked) │
    └──────────────────────────────────────┘
                 │
                 │ run finalized → all verdicts frozen; further changes rejected
                 ▼
              [LOCKED]
```

### Functional Requirements (Structured)

#### FR‑1: Verdict Data Shape

Each test-case verdict record SHALL carry:

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `verdict` | enum: `pass` \| `fail` \| `blocked` | Yes (once set) | Mutually exclusive; exactly one active value. |
| `blockedReason` | enum: `environment_unavailable` \| `test_data_missing` \| `dependency_failed` \| `other` | **Yes** when `verdict = blocked`; absent otherwise | Predefined closed list. |
| `blockedReasonDetail` | string (max 500 chars) | No | Free‑text clarification, meaningful only when `blockedReason = other`. |
| `comment` | string (max 2000 chars) | No | Free‑text; carried for any verdict value. |
| `assignedBy` | user ID (UUID) | Yes | Populated automatically from the authenticated session. |
| `assignedAt` | ISO‑8601 timestamp | Yes | Set on creation; updated on every verdict change. |
| `runId` | FK → test run | Yes | The parent test run this case belongs to. |
| `testCaseId` | FK → test case | Yes | The test case this verdict is for. |

**Rationale**: `blockedReason` is a separate field from `comment` because the reason drives reporting aggregation (e.g., "40% of blocked cases are due to Environment Unavailable"), while `comment` is free‑form narrative.

#### FR‑2: Verdict Assignment — Inline (Test Run List View)

1. The test run list view SHALL render every test case row with three mutually exclusive verdict buttons: **Pass** (green), **Fail** (red), **Blocked** (grey).
2. The currently active verdict SHALL be visually distinguished (filled/pressed state) from the inactive options.
3. Clicking **Pass** or **Fail** on an unset case SHALL:
   - Immediately persist the verdict (optimistic update with rollback on failure).
   - Show a brief success indicator (green checkmark for Pass, red cross for Fail) adjacent to the row for 2 seconds.
4. Clicking **Pass** or **Fail** when a DIFFERENT verdict is already set SHALL:
   - Immediately replace the verdict.
   - Log the transition to the audit log (see FR‑7).
5. Clicking **Blocked** SHALL:
   - Open a modal dialog (not navigate away).
   - Require selection of a `blockedReason` from the predefined list.
   - If `Other` is selected, display a text input for `blockedReasonDetail`.
   - On confirm, persist the verdict and close the modal.
   - On cancel, revert to the previous verdict (no change).

#### FR‑3: Verdict Assignment — Detail View

1. The test case detail view SHALL display the current verdict prominently at the top of the page.
2. The same three verdict buttons SHALL be present, with identical behavior to FR‑2.
3. A full‑width comment text area SHALL be available below the verdict buttons (max 2000 characters, with a live character counter).
4. Saving a comment without changing the verdict SHALL update the `comment` field and log the change (distinct from a verdict change in the audit log).

#### FR‑4: Run Finalization Guard

1. When a test run's status is `closed` or `finalized`:
   - All verdict buttons SHALL be disabled (greyed out, not clickable).
   - Hovering a disabled button SHALL show a tooltip: _"Run is finalized; verdicts cannot be modified."_
   - The comment text area SHALL be read‑only.
2. The API SHALL reject any `PATCH` to a verdict on a finalized run with HTTP `409 Conflict` and body `{ "error": "Run is finalized; verdicts cannot be modified." }`.
3. A test run SHALL transition to `finalized` only via an explicit user action (a "Finalize Run" button with a confirmation dialog). This action is NOT part of the verdict feature itself, but the verdict system MUST respect the run's finalized state.

#### FR‑5: Bulk Verdict Update

1. The test run list view SHALL support multi‑select of test cases via checkboxes.
2. When one or more test cases are selected, a bulk‑action toolbar SHALL appear with two buttons: **Bulk Pass** and **Bulk Fail**.
3. **Bulk Blocked** SHALL NOT be offered (rationale: `blockedReason` is mandatory and per‑case, making bulk assignment semantically ambiguous).
4. Bulk Pass / Bulk Fail SHALL:
   - Apply the selected verdict to every checked test case.
   - Skip any case whose parent run is finalized (log a warning per skipped case; do NOT fail the entire batch).
   - Return a summary response: `{ "updated": N, "skipped": M, "skippedIds": [...] }`.
5. Bulk operations SHALL be atomic per test case: each case succeeds or fails independently (partial-success semantics).

#### FR‑6: Verdict Constraints & Validation

1. The `verdict` field MUST be one of exactly three values: `pass`, `fail`, `blocked` (lowercase).
2. When `verdict = blocked`, `blockedReason` MUST be present and MUST be one of the four enumerated values.
3. When `verdict != blocked`, `blockedReason` MUST be absent or `null` — the API SHALL reject a payload that sets `blockedReason` for a Pass or Fail verdict with HTTP `422 Unprocessable Entity`.
4. `comment` MUST NOT exceed 2000 characters when UTF‑8 encoded.
5. Verdict transitions to the SAME value (e.g., Pass → Pass) SHALL be accepted as idempotent (no‑op, no audit entry).

#### FR‑7: Audit Log

1. Every verdict change SHALL produce an audit event with the following shape:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO‑8601 instant the change was persisted. |
| `userId` | Authenticated user who made the change. |
| `testRunId` | Parent test run. |
| `testCaseId` | The test case. |
| `oldVerdict` | Previous verdict value, or `null` if this was the first assignment. |
| `newVerdict` | New verdict value. |
| `oldBlockedReason` | Previous blocked reason, or `null`. |
| `newBlockedReason` | New blocked reason, or `null`. |
| `comment` | The comment associated with this change (may be empty). |

2. Audit events SHALL be append‑only (never mutated or deleted).
3. The activity log SHALL be accessible from the test case detail view as a reverse‑chronological feed.
4. The activity log SHALL be accessible at the test run level, filtered to that run's cases, for QA Lead review.

#### FR‑8: API Contract

**Endpoint**: `PATCH /api/test-runs/:runId/test-cases/:testCaseId`

**Request Body** (JSON):

```json
{
  "verdict": "pass" | "fail" | "blocked",
  "blockedReason": "environment_unavailable" | "test_data_missing" | "dependency_failed" | "other",
  "blockedReasonDetail": "string (optional, max 500 chars)",
  "comment": "string (optional, max 2000 chars)"
}
```

**Success Response** (`200 OK`):

```json
{
  "testCaseId": 42,
  "verdict": "pass",
  "blockedReason": null,
  "blockedReasonDetail": null,
  "comment": "All checks passed on retry.",
  "assignedBy": "uuid-of-user",
  "assignedAt": "2026-08-03T12:00:00Z"
}
```

**Error Responses**:

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | `verdict` is missing or not a recognized value. | `{ "error": "verdict must be one of: pass, fail, blocked" }` |
| `404 Not Found` | `runId` or `testCaseId` does not exist or does not belong to the tenant. | `{ "error": "Test case not found in this run" }` |
| `409 Conflict` | The parent test run is finalized. | `{ "error": "Run is finalized; verdicts cannot be modified." }` |
| `422 Unprocessable Entity` | `verdict = blocked` but `blockedReason` is missing or invalid. | `{ "error": "blockedReason is required when verdict is blocked", "validValues": ["environment_unavailable", "test_data_missing", "dependency_failed", "other"] }` |
| `422 Unprocessable Entity` | `blockedReason` is present but `verdict` is NOT `blocked`. | `{ "error": "blockedReason is only valid when verdict is blocked" }` |
| `422 Unprocessable Entity` | `comment` exceeds 2000 characters. | `{ "error": "comment must not exceed 2000 characters" }` |

#### FR‑9: Dashboard & Reporting Visibility

1. The test run summary SHALL display aggregate verdict counts: _X Passed, Y Failed, Z Blocked, N Unset_.
2. These counts SHALL update in real time (or near‑real time, ≤5 seconds after a verdict change) without requiring a full page refresh.
3. The Quality / Testing dashboard SHALL include a "Verdicts Over Time" chart showing the running pass rate per test run.
4. Blocked cases SHALL be break‑downable by `blockedReason` in the dashboard (stacked bar or pie chart).

### Traceability Matrix

| Requirement | Acceptance Criteria | Priority |
|-------------|---------------------|----------|
| FR‑1 (Data Shape) | All ACs (data foundation) | P0 — Blocking |
| FR‑2 (Inline Assignment) | AC‑1 (Pass click), AC‑2 (Fail click), AC‑3 (Blocked modal) | P0 — Blocking |
| FR‑3 (Detail View) | AC‑1, AC‑2, AC‑3 (mirrors inline) | P1 — High |
| FR‑4 (Finalization Guard) | AC‑5 (finalized run rejection) | P0 — Blocking |
| FR‑5 (Bulk Update) | AC‑6 (bulk Pass succeeds, bulk Blocked not offered) | P2 — Medium |
| FR‑6 (Validation) | AC‑7 (API validation) | P0 — Blocking |
| FR‑7 (Audit Log) | AC‑4 (transition captured) | P1 — High |
| FR‑8 (API Contract) | AC‑7 (valid payload → 200, invalid → 422) | P0 — Blocking |
| FR‑9 (Dashboard) | Implicit (verdicts immediately visible) | P1 — High |

### Non‑Functional Requirements

| NFR | Criterion |
|-----|-----------|
| **Performance** | Verdict save (click → persisted + feedback) SHALL complete in under 500ms p95. Audit log retrieval for a single test case (up to 200 entries) SHALL return in under 300ms p95. |
| **Concurrency** | Two simultaneous verdict updates for the SAME test case SHALL be resolved via optimistic locking (last‑write‑wins with a version token); no lost updates. |
| **Multi‑Tenancy** | All verdict data SHALL be scoped to the authenticated user's tenant. Cross‑tenant access SHALL be impossible — the API MUST resolve `runId` → tenant before accepting any mutation. |
| **Accessibility** | Verdict buttons SHALL be keyboard‑navigable (Tab / Enter). The Blocked modal SHALL trap focus and support Escape to cancel. Color MUST NOT be the sole differentiator (Pass/Fail/Blocked icons MUST be distinct shapes). |
| **Observability** | Every verdict mutation SHALL emit a structured log line (level: INFO) with `testRunId`, `testCaseId`, `oldVerdict`, `newVerdict`, `userId`, and `tenantId`. |

### Dependencies & Assumptions

1. **Test Run and Test Case entities** already exist in the platform's data model (or will be created as a prerequisite). This feature does NOT create those entities — it extends them with verdict capability.
2. **Authentication** is provided by the existing auth middleware (`authMiddleware` in `api/src/presentation/middleware/authMiddleware.ts`); the `assignedBy` field is populated from the JWT session.
3. **Audit infrastructure** already exists (`AuditService` in `api/src/application/audit/AuditService.ts`); the verdict audit log integrates with this service rather than building a parallel mechanism.
4. **Run finalization** is an existing capability on the Test Run entity; the verdict system reads `finalized` state but does not own the finalization action itself.

### Out of Scope (re‑stated for clarity)

| Item | Reason |
|------|--------|
| Custom verdicts (Skipped, Not Applicable, etc.) | Future iteration — requires schema migration and UI changes. |
| Automatic bug‑ticket creation from Failed verdicts | Manual linking remains the workflow; automation evaluated post‑MVP. |
| Workflow automation (e.g., auto‑assign developer on Fail) | Adds complexity without validated user need. |
| Verdict availability conditioned on test case type or traceability | Premature; revisit when the test case type taxonomy stabilizes. |
| Verdict export / reporting PDF generation | Reporting views are in‑app only for MVP; export handled separately. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._