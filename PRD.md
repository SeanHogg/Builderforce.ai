> **PRD** — drafted by Ada (Sr. Product Mgr) · task #669
> _Each agent that updates this PRD signs its change below._

# PRD: Unit and Integration Tests for Progress Breakdown

## Problem & Goal

The progress breakdown feature has been implemented (logic + endpoint) but lacks automated test coverage. Without tests, regressions are undetected, edge cases are undocumented, and future contributors cannot safely refactor. The goal is to achieve comprehensive, reliable test coverage for all progress breakdown logic and the associated API endpoint, establishing a safety net and serving as living documentation.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Backend Engineers** | Confidence when modifying breakdown logic or endpoint handlers |
| **QA / Release Engineers** | Automated gate in CI that prevents shipping regressions |
| **Future Contributors** | Clear examples of expected behavior for edge cases |

---

## Scope

Coverage targets the progress breakdown subsystem only:

- **Unit tests** – pure business-logic functions (calculation, aggregation, normalization)
- **Integration tests** – HTTP endpoint behavior (routing, serialization, auth, error paths)
- **Fixture / factory helpers** – reusable test data builders shared across both layers

Out-of-scope items are listed at the bottom of this document.

---

## Functional Requirements

### FR-1 Unit Tests — Breakdown Calculation Logic

| ID | Requirement |
|---|---|
| FR-1.1 | Test that total progress is correctly computed as the weighted sum of all sub-components when all values are present. |
| FR-1.2 | Test that a sub-component with `0` weight contributes nothing to the total. |
| FR-1.3 | Test that missing / `null` sub-component values are treated as `0` (or the defined default) without throwing. |
| FR-1.4 | Test that progress values are clamped to `[0, 100]`; values below `0` floor to `0`, values above `100` cap to `100`. |
| FR-1.5 | Test that percentage breakdowns across all categories sum to `100 %` (within floating-point tolerance ±0.01). |
| FR-1.6 | Test that an empty input (no sub-components) returns a well-defined zero-state object rather than an error. |
| FR-1.7 | Test that each sub-component label is correctly mapped from its internal key to the human-readable display name. |
| FR-1.8 | Test that the `lastUpdated` timestamp on the breakdown reflects the most-recently-modified sub-component. |

### FR-2 Unit Tests — Aggregation & Normalization Helpers

| ID | Requirement |
|---|---|
| FR-2.1 | Test that the normalization function scales raw scores to the `[0, 100]` range given known min/max bounds. |
| FR-2.2 | Test normalization when `min === max` (division-by-zero guard) returns `0` or `100` as per spec. |
| FR-2.3 | Test the aggregation reducer with a single record, multiple records, and duplicate keys (last-write-wins or sum, per spec). |
| FR-2.4 | Test that sorting helpers return breakdown items in descending progress order. |
| FR-2.5 | Test that filtering helpers correctly exclude sub-components marked `hidden: true`. |

### FR-3 Integration Tests — GET `/progress/breakdown` Endpoint

| ID | Requirement |
|---|---|
| FR-3.1 | `200 OK` with a valid, authenticated request returns a JSON body matching the progress breakdown schema. |
| FR-3.2 | Response body contains `total`, `breakdown` array, and `lastUpdated` fields at minimum. |
| FR-3.3 | Each item in `breakdown` contains `id`, `label`, `value` (number), and `weight` (number). |
| FR-3.4 | `401 Unauthorized` is returned when the request carries no auth token. |
| FR-3.5 | `403 Forbidden` is returned when the authenticated user lacks permission to view the requested resource. |
| FR-3.6 | `404 Not Found` is returned when the target entity (user/project/course) does not exist. |
| FR-3.7 | `200 OK` with an entity that has no progress data returns the zero-state schema (no `500` error). |
| FR-3.8 | Query parameter `?include_hidden=true` causes hidden sub-components to appear in the response. |
| FR-3.9 | Response includes correct `Content-Type: application/json` header. |
| FR-3.10 | End-to-end latency for the integration test (real DB or test double) is under 500 ms. |

### FR-4 Edge-Case & Boundary Tests

| ID | Requirement |
|---|---|
| FR-4.1 | All sub-components at `100` → total is `100`. |
| FR-4.2 | All sub-components at `0` → total is `0`. |
| FR-4.3 | Exactly one sub-component exists with weight `1.0` → total equals that component's value. |
| FR-4.4 | Floating-point inputs (e.g., `33.333…`) do not cause serialization errors or unexpected rounding beyond 2 decimal places. |
| FR-4.5 | Very large number of sub-components (e.g., 1 000) does not degrade correctness or performance beyond thresholds. |

### FR-5 Test Infrastructure

| ID | Requirement |
|---|---|
| FR-5.1 | A factory/builder function creates a valid default `ProgressBreakdown` object, accepting optional overrides. |
| FR-5.2 | A factory/builder function creates a valid `SubComponent` object with sensible defaults. |
| FR-5.3 | Integration tests use a dedicated test database or an in-memory/transactional fixture — no shared mutable state between tests. |
| FR-5.4 | All tests are deterministic: no reliance on wall-clock time or random seeds without explicit seeding. |
| FR-5.5 | Tests are runnable in CI via a single command (e.g., `npm test` / `pytest` / `go test ./...`). |

---

## Acceptance Criteria

1. **Coverage gate** — Statement/line coverage for the progress breakdown module is ≥ 90 %; branch coverage is ≥ 80 %. CI enforces these thresholds and fails the build on violation.
2. **All FR tests pass** — Every test case enumerated in FR-1 through FR-4 has a corresponding automated test that passes on `main`.
3. **No external side effects** — Tests do not write to production databases, send real HTTP requests outside the test server, or mutate global state visible to other test suites.
4. **Isolation** — Each test is independently runnable; no test depends on execution order.
5. **Clear failure messages** — A failing assertion names the failing scenario and the expected vs. actual value without requiring test-source inspection.
6. **CI integration** — The test suite runs on every pull request; a failing suite blocks merge.
7. **Documentation** — A brief comment block at the top of each test file describes what subsystem is under test and which FR IDs it covers.

---

## Out of Scope

- Tests for **other** endpoints or modules not involved in progress breakdown.
- Performance / load testing beyond the single latency guard in FR-3.10.
- UI / frontend tests for progress breakdown visualizations.
- Mutation testing or property-based fuzzing (may be added in a follow-up).
- Changes to the production breakdown logic, schema, or endpoint behavior — tests must reflect the existing spec, not drive new features.
- Test coverage for authentication middleware itself (covered in its own test suite).

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