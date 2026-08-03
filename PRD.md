> **PRD** — drafted by Ada (Sr. Product Mgr) · task #567
> _Each agent that updates this PRD signs its change below._
> **Requirements** — authored by Business Analyst (task #567, backlog lane)

# PRD: Test Case Execution

## Problem & Goal
QA teams lack a unified interface to execute test cases and track results, leading to fragmented reporting and delayed quality insights.
**Goal**: Provide a centralized engine to execute manual and automated test cases and surface real-time pass/fail data.

## Target users / ICP roles
- QA Engineers (primary) – executing tests, analyzing failures
- Test Leads – reviewing suite progress and coverage
- Developers – running smoke/regression tests pre-merge

## Scope
- Define, organize, and version test cases
- Trigger executions manually or via API/script
- Record and persist execution outcomes (pass, fail, blocked, skipped)
- View execution history with filtering
- Visualize aggregate execution metrics (pass rate, failure trends)

## Functional requirements
- **Test case management**: CRUD operations on test cases (title, steps, expected results, tags, priority, suite association)
- **Manual execution**: User picks a test case, marks each step status, optionally adds notes/screenshots, submits final verdict
- **Automated execution trigger**: REST endpoint accepts test case ID + result payload (pass/fail/skipped/blocked, log, duration, artifact links)
- **Execution history**: List view with columns for test case ID, suite, status, timestamp, executor; filterable by date range, status, suite, executor
- **Execution details**: Click-through on any history row shows step-by-step results, logs, and attachments
- **Dashboard**: Widgets for pass %, failures last 7 days, top failing test cases, execution count over time; data refreshed on page load

## Acceptance criteria
1.  A user can navigate to a test case, click "Run", sequentially mark each step as pass/fail/blocked/skipped, and submit; the final status is recorded and visible in execution history immediately.
2.  A script can POST valid execution results to the API endpoint; the system correctly stores the status and associated metadata and makes it queryable.
3.  The execution history list displays only records matching applied filters (e.g., suite = "Login", status = "failed", date = last 24h).
4.  The dashboard shows a pass rate that matches (passed executions / total executions) for the selected period.
5.  Clicking a history entry opens a detail view containing step-wise outcomes and any attached logs or images.

## Out of scope
- Full CI/CD pipeline integration (webhook triggers, status reporting back to PRs) – limited to API layer
- Test case versioning with branching/merging
- Advanced analytics (flakiness detection, trend forecasting)
- Native mobile app execution
- Integration with third-party test management suites (only import/export via CSV later)

## Requirements

### Domain Model

**Test Case** — the definition of a single test.
| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID / string | yes | System-generated, immutable |
| title | string (≤ 255 chars) | yes | Unique within a suite |
| description | text | no | Free-form overview of what the test verifies |
| steps | ordered array of Step | yes | At least one step required |
| expected results | string | no | Overall expected outcome summary |
| tags | string[] | no | Arbitrary labels for categorization (e.g. "smoke", "regression", "login") |
| priority | enum: critical / high / medium / low | yes | Default: medium |
| suiteId | UUID / string ref | yes | Each test case belongs to exactly one suite |
| createdAt | ISO-8601 timestamp | yes | |
| updatedAt | ISO-8601 timestamp | yes | |

**Step** — one action within a test case.
| Field | Type | Required |
|---|---|---|
| order | integer (1-based) | yes |
| instruction | string | yes |
| expectedResult | string | no |

**Test Suite** — a logical grouping of test cases.
| Field | Type | Required |
|---|---|---|
| id | UUID / string | yes |
| name | string (≤ 255 chars) | yes |
| description | text | no |
| parentSuiteId | UUID / string | no | Enables hierarchical suite nesting |
| createdAt / updatedAt | timestamp | yes | |

**Execution** — one run of a test case.
| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID / string | yes | |
| testCaseId | UUID / string ref | yes | The test case that was executed |
| status | enum: pass / fail / blocked / skipped | yes | Overall verdict |
| stepResults | ordered array of StepResult | yes | One-per-step outcome |
| executor | string | yes | User id or "api" / "system" for automated runs |
| durationMs | integer (≥ 0) | no | Total execution time in milliseconds |
| log | text | no | Free-form log output |
| artifactUrls | string[] | no | Links to screenshots, videos, HAR files, etc. |
| notes | text | no | Human-readable comment (e.g. reason for blocking) |
| startedAt | ISO-8601 timestamp | yes | |
| completedAt | ISO-8601 timestamp | yes | |

**StepResult** — outcome of one step inside an execution.
| Field | Type | Required |
|---|---|---|
| stepOrder | integer | yes |
| status | enum: pass / fail / blocked / skipped | yes |
| notes | text | no |
| attachmentUrls | string[] | no |

---

### Data Integrity Constraints
- **R1** Deleting a suite must either fail (409 Conflict) if it still has test cases, or cascade-delete all contained test cases and their execution history, based on a user-facing configuration toggle per suite.
- **R2** Execution status is derived from step results per these rules: `blocked` if any step is blocked, else `fail` if any step is failed, else `skipped` if all steps are skipped, else `pass`. The API MUST enforce this; it MUST NOT accept a final status that contradicts the step outcomes.
- **R3** Test case title must be unique within its suite; the title alone does not need global uniqueness.
- **R4** Step `order` values within a test case must be a contiguous 1-based sequence with no gaps.

---

### API Endpoints

#### Test Cases (`/api/test-cases`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/test-cases` | Create a test case |
| GET | `/api/test-cases` | List test cases (query params: suiteId, tags, priority, search, page, pageSize) |
| GET | `/api/test-cases/:id` | Get a single test case with steps |
| PUT | `/api/test-cases/:id` | Full update (overwrite) |
| PATCH | `/api/test-cases/:id` | Partial update |
| DELETE | `/api/test-cases/:id` | Delete (cascade-deletes executions; 409 if executions exist and `?force=false`) |

#### Test Suites (`/api/suites`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/suites` | Create a suite |
| GET | `/api/suites` | List suites (query params: parentSuiteId, search) |
| GET | `/api/suites/:id` | Get suite detail + test-case count |
| PUT / PATCH | `/api/suites/:id` | Update |
| DELETE | `/api/suites/:id` | Delete (cascade-control per R1) |

#### Executions (`/api/executions`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/executions` | Submit an execution result (automated path; payload includes stepResults, status validated per R2) |
| GET | `/api/executions` | List execution history (filters: testCaseId, suiteId, status, executor, startedAt.from, startedAt.to, page, pageSize) |
| GET | `/api/executions/:id` | Detail view including stepResults, log, artifactUrls |
| POST | `/api/executions/manual` | Initiate a manual run: returns the test case with step list and a pending execution id; client submits step-by-step |
| PATCH | `/api/executions/:id/steps` | Update individual step results during a manual run |
| POST | `/api/executions/:id/complete` | Submit final verdict for a manual run; server validates per R2 |

#### Dashboard (`/api/dashboard`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dashboard/summary` | Aggregates: passRate, totalExecutions, passCount, failCount, blockedCount, skippedCount |
| GET | `/api/dashboard/failures` | Top N failing test cases in period |
| GET | `/api/dashboard/trend` | Execution count grouped by day for trend chart |
| Query params for all dashboard endpoints: `periodStart`, `periodEnd` (ISO-8601; default last 7 days), `suiteId` (optional filter). |

---

### Manual Execution Flow (UX)
1. User opens a test case detail view and clicks **Run**.
2. The client calls `POST /api/executions/manual` (body: `{ testCaseId }`) → receives a pending execution object with an `id` and the ordered list of steps.
3. The UI presents one step at a time (step 1 of N). User selects pass / fail / blocked / skipped, optionally adds notes and attaches screenshots, then clicks **Next**.
4. After completing the last step, the user sees a summary of all step outcomes and may edit any before clicking **Submit**.
5. The client calls `POST /api/executions/:id/complete`. The server computes the final status from step results (per R2) and persists the execution.
6. The UI navigates to the execution detail view, showing the just-recorded result.
7. At any point before submitting, the user may **Save & Exit** — the partial execution is persisted as in-progress and can be resumed later.

---

### Non-Functional Requirements
- **NFR1 — Performance**: Dashboard summary queries must return within 500 ms for up to 100,000 execution records. List endpoints must return within 200 ms for typical page sizes (≤ 50 rows).
- **NFR2 — Concurrency**: The system must correctly handle ≥ 50 concurrent automated-result POSTs without data loss or duplicate execution records.
- **NFR3 — Authentication & Authorization**: All endpoints require authentication. RBAC with at minimum two roles: `qa_engineer` (CRUD test cases, manual execution), `viewer` (read-only access to test cases, suites, executions, and dashboard). API-key auth must be supported for automated execution endpoints.
- **NFR4 — Audit Trail**: Every execution record must carry an immutable `executor` and timestamp. Updates to test cases must log who changed what and when (at minimum: `updatedAt`, `updatedBy`).
- **NFR5 — Error Handling**: The API must return structured JSON error responses with `error.code`, `error.message`, and optional `error.details` array. 400 for validation errors, 404 for missing resources, 409 for constraint violations, 500 for internal errors.
- **NFR6 — Pagination**: All list endpoints must support cursor-based or offset pagination with `page` and `pageSize` params and return `total` count and `hasMore` in the response.

---

### Permissions Matrix
| Action | qa_engineer | viewer |
|---|---|---|
| Create / edit / delete test cases | ✓ | ✗ |
| Create / edit / delete suites | ✓ | ✗ |
| View test cases & suites | ✓ | ✓ |
| Submit manual execution | ✓ | ✗ |
| Submit automated execution (API key) | ✓ | ✗ |
| View execution history & details | ✓ | ✓ |
| View dashboard | ✓ | ✓ |

---

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
