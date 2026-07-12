> **PRD** — drafted by Ada (Sr. Product Mgr) · task #668
> _Each agent that updates this PRD signs its change below._

# PRD: Progress Breakdown Object Structure

## Problem & Goal

Progress tracking data is currently inconsistent across backend and frontend — field names, data types, and nesting structures differ between API responses and UI consumption, leading to rendering bugs, fragile data transformations, and difficult-to-maintain code. The goal is to define a canonical, versioned schema for the **progress breakdown object** and enforce its consistent implementation end-to-end.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Backend Engineers** | Authoritative schema to serialize and validate against |
| **Frontend Engineers** | Predictable, typed contract for UI rendering and state management |
| **QA / Test Engineers** | Acceptance criteria and fixture data for test coverage |
| **Product & Design** | Accurate, real-time progress visualization for end users |

---

## Scope

This work covers the **definition, validation, and consistent delivery** of the progress breakdown object from the point of persistence through API response to frontend consumption. It does not cover the business logic that generates the underlying progress values.

---

## Functional Requirements

### FR-1: Canonical Schema Definition

Define the progress breakdown object with the following top-level structure:

```json
{
  "progressBreakdown": {
    "overallPercent": 72,
    "status": "in_progress",
    "breakdown": [
      {
        "id": "string",
        "label": "string",
        "completedUnits": 18,
        "totalUnits": 25,
        "percent": 72,
        "status": "in_progress",
        "metadata": {}
      }
    ],
    "lastUpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

**Field contracts:**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `overallPercent` | `integer` | Yes | 0–100 inclusive |
| `status` | `enum` | Yes | `not_started`, `in_progress`, `completed`, `blocked` |
| `breakdown` | `array` | Yes | Min length 0; ordered by natural task order |
| `breakdown[].id` | `string` | Yes | Stable, unique identifier per breakdown item |
| `breakdown[].label` | `string` | Yes | Human-readable display name; max 120 chars |
| `breakdown[].completedUnits` | `integer` | Yes | ≥ 0; ≤ `totalUnits` |
| `breakdown[].totalUnits` | `integer` | Yes | ≥ 1 |
| `breakdown[].percent` | `integer` | Yes | 0–100; must equal `floor(completedUnits / totalUnits * 100)` |
| `breakdown[].status` | `enum` | Yes | Same enum as top-level `status` |
| `breakdown[].metadata` | `object` | No | Arbitrary key-value pairs; serializable to JSON |
| `lastUpdatedAt` | `ISO 8601 string` | Yes | UTC timestamp of most recent progress change |

---

### FR-2: Backend Implementation

- **FR-2.1** — Implement a shared serializer / DTO (Data Transfer Object) that maps internal persistence models to the canonical schema.
- **FR-2.2** — Apply JSON Schema or equivalent validation (e.g., Zod, Pydantic, Joi) on the object before it is written to any response payload.
- **FR-2.3** — All API endpoints that return progress data must embed the `progressBreakdown` key at a consistent path in their response envelope.
- **FR-2.4** — Computed field `percent` at both the item and top level must be derived server-side; clients must not be required to compute it.
- **FR-2.5** — Backward-compatible versioning: if a breaking change to the schema is required, increment the API version; do not mutate existing field names in place.

---

### FR-3: Frontend Implementation

- **FR-3.1** — Define a TypeScript interface (`ProgressBreakdown`) mirroring the canonical schema; all components consuming progress data must reference this type.
- **FR-3.2** — A single, reusable data-access layer function (e.g., `fetchProgressBreakdown`) is responsible for fetching and returning a typed `ProgressBreakdown` object; raw API responses must not be spread directly into component state.
- **FR-3.3** — The UI must render all fields present in `breakdown[]`; unknown or missing optional fields must degrade gracefully without crashing.
- **FR-3.4** — `lastUpdatedAt` must be displayed in the user's local timezone using a shared formatting utility.
- **FR-3.5** — Loading, error, and empty (`breakdown.length === 0`) states must be explicitly handled in every component that renders progress breakdown data.

---

### FR-4: Shared Fixtures and Contract Tests

- **FR-4.1** — Provide a set of canonical JSON fixture files covering: fully populated object, empty breakdown array, all four status values, boundary values (0% and 100%).
- **FR-4.2** — Backend contract tests must assert that serialized output matches fixture files byte-for-byte on relevant fields.
- **FR-4.3** — Frontend snapshot or unit tests must use the same fixture files, not hand-authored inline mocks.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Schema document (JSON Schema or equivalent) is committed to the repository as the single source of truth | Code review / repo check |
| AC-2 | All existing API endpoints returning progress data emit a response that validates against the schema with zero errors | Automated contract tests in CI |
| AC-3 | `percent` values in API responses always equal `floor(completedUnits / totalUnits * 100)` | Unit test on serializer |
| AC-4 | TypeScript interface compiles with strict mode enabled and covers every field in the schema | `tsc --strict` in CI |
| AC-5 | Frontend renders correctly when `breakdown` is an empty array | Automated UI test with empty-array fixture |
| AC-6 | Frontend renders correctly when `metadata` is absent on a breakdown item | Automated UI test with fixture omitting `metadata` |
| AC-7 | `lastUpdatedAt` is displayed in local timezone across supported browsers | Manual QA + automated test |
| AC-8 | No component directly accesses raw API response shape; all access is through the typed data-access function | Code review / linting rule |
| AC-9 | CI pipeline fails if a new endpoint returns progress data that does not include `progressBreakdown` at the defined path | Contract test suite |
| AC-10 | All four fixture files exist and are used by both backend and frontend test suites | Repo check + CI |

---

## Out of Scope

- **Business logic for computing progress values** — how `completedUnits` and `totalUnits` are calculated remains the responsibility of existing domain services; this PRD only governs the shape in which those values are exposed.
- **Real-time / websocket delivery** — streaming or push-based progress updates are a separate workstream; this PRD covers the object structure only, not the transport mechanism.
- **Historical progress timelines** — tracking progress over time or surfacing trend data is explicitly excluded.
- **Role-based field filtering** — all authenticated users receive the full schema; field-level access control is a future concern.
- **Internationalisation of `label` strings** — i18n of display labels is deferred; this PRD treats `label` as a single-locale string.
- **Schema migration tooling** — automated migration of existing stored data to match the new schema is out of scope; the serializer layer absorbs any legacy field mapping.

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