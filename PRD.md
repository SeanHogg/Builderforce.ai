> **PRD** — drafted by John Coder ((V2) (Durable)) · task #741
> _Each agent that updates this PRD signs its change below._

# PRD: Capabilities Data Model & API

## Problem & Goal
**Problem:**
Project teams lack a unified, programmatic way to track and visualize project capabilities. Critical information (e.g., status, priority, categorization) is scattered across tools or missing entirely, hindering strategic planning and execution visibility.

**Goal:**
Build a scalable backend data model and RESTful API for project capabilities, enabling:
- Structured creation, retrieval, and updates of capabilities.
- Aggregated rollup views (e.g., counts by status) and a quantitative "health score" for projects.
- Foundation for future visualization dashboards and integrations.

## Target Users / ICP Roles
- **Product Managers:** Define and track capabilities for roadmap planning.
- **Engineering Leads:** Monitor progress and prioritize work against capability status.
- **Program Managers:** Aggregate cross-project insights for stakeholder reporting.
- **Data Analysts:** Consume capability data for custom reporting needs.

## Scope
### In Scope
- **Data Model:**
  - Design and implement a `Capability` entity with specified fields.
- **API Endpoints:**
  - Full CRUD operations for capabilities, scoped to projects.
  - Rollup endpoint aggregating counts by status and calculating health score.
- **Validation:**
  - Input validation for fields (e.g., status enum, priority range).
- **Testing:**
  - Unit tests for data model and business logic.
  - Integration tests for API endpoints.
- **Documentation:**
  - API spec (e.g., OpenAPI) for downstream consumers.

### Out of Scope
- Frontend visualization or UI components.
- Authentication/authorization (assume handled by gateway).
- Historical snapshots or change tracking for capabilities.
- Pagination/filtering for `/capabilities` lists (v2).
- Bulk operations (e.g., POST/PATCH multiple capabilities at once).
- Analytics beyond the specified health score formula.

## Functional Requirements

### Data Model
| Field         | Type          | Description                                                                 | Constraints/Notes                          |
|---------------|---------------|-----------------------------------------------------------------------------|--------------------------------------------|
| `id`          | UUID          | Unique identifier for the capability.                                       | Auto-generated.                            |
| `projectId`   | UUID          | Foreign key to the associated project.                                      | Required; immutable.                       |
| `title`       | String        | Human-readable name of the capability.                                      | Required; max 100 characters.              |
| `description` | String        | Detailed explanation of the capability.                                     | Optional; max 1000 characters.             |
| `category`    | String        | High-level grouping (e.g., "UX", "Infrastructure").                         | Optional; max 50 characters.               |
| `status`      | Enum          | Current state of the capability.                                            | Required; `planned`, `in_progress`, `shipped`. |
| `priority`    | Integer       | Relative importance (1-5, 5 = highest).                                     | Required; range 1-5.                       |
| `tags`        | String[]      | Keywords for filtering/searching.                                           | Optional; max 5 tags, 20 chars each.       |

### API Endpoints
#### `GET /api/projects/:id/capabilities`
- **Description:** List all capabilities for a project.
- **Query Params:** None (filtering v2).
- **Response:** Array of `Capability` objects.
- **Status Codes:** `200 OK`, `404 Not Found` (if project missing).

#### `POST /api/projects/:id/capabilities`
- **Description:** Create a new capability for a project.
- **Request Body:** Partial `Capability` object (excludes `id`).
- **Response:** Created `Capability` object with `id`.
- **Status Codes:** `201 Created`, `400 Bad Request` (validation), `404 Not Found` (project).

#### `PATCH /api/capabilities/:id`
- **Description:** Update fields for a capability (e.g., status, priority).
- **Request Body:** Partial `Capability` object (only updatable fields).
- **Response:** Updated `Capability` object.
- **Status Codes:** `200 OK`, `400 Bad Request`, `404 Not Found` (capability).

#### `GET /api/projects/:id/capabilities/rollup`
- **Description:** Aggregated counts and health score for a project’s capabilities.
- **Query Params:** None.
- **Response Schema:**
  ```json
  {
    "counts": {
      "planned": 3,
      "in_progress": 2,
      "shipped": 4
    },
    "total": 9,
    "healthScore": 58.3
  }
  ```
- **Status Codes:** `200 OK`, `404 Not Found` (project).

### Health Score Formula
```
(shipped * 1.0 + in_progress * 0.5 + planned * 0.1) / total * 100
```
- **Notes:**
  - Rounds to 1 decimal place.
  - Zero division handled (returns `0` if no capabilities).

## Acceptance Criteria
### Data Model
- [ ] `Capability` schema matches fields/table above with constraints enforced.
- [ ] Schema supports all required query patterns (e.g., filtering by `projectId`, `status`).

### API Endpoints
- [ ] All endpoints return documented responses and status codes.
- [ ] Input validation rejects malformed requests (e.g., invalid `status`).
- [ ] Rollup endpoint correctly calculates health score per the formula.
- [ ] Immutable fields (`id`, `projectId`) are not updatable via `PATCH`.

### Testing
- [ ] Unit tests cover:
  - Health score calculation edge cases (0 capabilities, all statuses).
  - Validation logic (e.g., invalid `priority`).
- [ ] Integration tests cover:
  - End-to-end API flows (POST → GET → PATCH → GET → rollup).
  - Error scenarios (e.g., missing `projectId`).

### Documentation
- [ ] OpenAPI spec generated for all endpoints.
- [ ] Example requests/responses provided for each endpoint.

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