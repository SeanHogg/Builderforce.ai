> **PRD** — drafted by Ada (Sr. Product Mgr) · task #700
> _Each agent that updates this PRD signs its change below._

# PRD: Bind Application/API Tree for Progress Breakdown Object Implementation

**Status:** WIP  
**Linked Task:** #668 (Progress Breakdown Object Structure)  
**Author:** Product Architect  
**Date:** [Current Date]

---

## 1. Problem & Goal

**Problem:**  
Task #668 (PRD: Progress Breakdown Object Structure) cannot be implemented on the current branch (`builderforce/task-668` of `seanhogg/builderforce.ai`) because the repository lacks the foundational application and API tree. The branch contains only `agent-runtime/` (Swabble + chat extensions), root markdown/PRD files, and a single isolated frontend component (`EvermindBrainMap.tsx`). Missing entire layers make it impossible to:

- Expose progress breakdown data via REST endpoints.
- Persist or validate progress structures.
- Render progress in the frontend or share date/timezone logic.
- Contract-test the endpoints or fixtures.

A repo‑wide code search for `progressBreakdown` yields zero results — there is no existing progress tracking code. This is the same root cause that blocked prior tasks (#615, #682, #687).

**Goal:**  
Bring the full application and API tree into the active repository/branch so that the downstream task (#668) can be implemented in an end‑to‑end fashion rather than producing abstract, disconnected schema definitions. Once this PRD is completed, the branch will be ready for the actual progress breakdown object implementation.

---

## 2. Target Users / ICP Roles

- **Internal development team** working on Builderforce.ai (backend/frontend engineers, QA).  
- **Product architects** overseeing the progress tracking feature.

No end‑user personas are directly involved in this infrastructure setup.

---

## 3. Scope

**In Scope:**

1. **Backend API tree** – scaffold or pull in the correct `/api` directory containing:
   - Serializer/DTO layer.
   - Persistence models (e.g., ORM entities).
   - Request/data validation layer (Zod, Joi, or equivalent).
   - REST endpoints capable of serving progress‑related data (initially stubs or placeholder routes).
2. **Frontend application scaffold** – ensure the frontend directory has:
   - A proper Node.js project with `package.json` and TypeScript configuration.
   - A data‑access layer (API client, hooks, or store module).
   - Placeholder or reusable components for rendering progress breakdowns (can be minimal but must be structured for future implementation).
   - A shared utility module for date/timezone formatting (e.g., `formatDate`, timezone conversion helpers).
3. **Test fixtures & contract‑test infrastructure** – introduce a `fixtures/` directory (or similar) and a test harness (e.g., Jest, Vitest) that can be used to write contract tests for progress endpoints once #668 is implemented.
4. **Repository branch binding** – ensure that the branch `builderforce/task-668` (or its successor) is correctly bound to the repository containing the full application tree (as opposed to a stripped‑down snapshot).

**Out of Scope:**

- Implementation of the Progress Breakdown Object type, schema, or any business logic from PRD #668.
- Actual data population or progress calculation.
- UI polishing or production‑ready rendering of progress breakdowns.
- Backend performance optimization or database migration scripts.
- Git history cleanup or branch renaming beyond what is needed to achieve a working tree.

---

## 4. Functional Requirements

### FR‑1: Repository Synchronisation
The branch shall be connected to (or contain) the canonical Builderforce.ai application repository with its complete directory structure.  
If the canonical repo lives elsewhere, the branch shall be created from or merged with that canonical repo.

### FR‑2: Backend API Tree Presence
The `/api` directory (or equivalent, per project conventions) must exist and contain at least:

- A serialization/deserialization layer (e.g., `serializers/`).
- Model definitions (e.g., `models/`, `entities/`).
- A validation schema library integration (e.g., Zod schemas in a `validation/` folder).
- One or more REST endpoint files (e.g., `routes/progress.ts`) with placeholder handlers that return 501 or stub responses.

A search for `progressBreakdown` may still return 0 hits — that is acceptable; the infrastructure for serving such data must exist.

### FR‑3: Frontend Application Scaffold
The `/frontend` directory (or the path where `EvermindBrainMap.tsx` resides) must be a working application scaffold:

- `package.json` with dependencies (React, TypeScript, etc.).
- `tsconfig.json` (or at least a referenced config).
- A data‑access layer directory (e.g., `src/data/`) containing an API client factory or hook under a clearly named module.
- A dedicated component folder for progress breakdown (e.g., `src/components/progress/`) with an `index.ts` barrel file, even if components are stubs.
- A shared date/timezone utility file (e.g., `src/utils/datetime.ts`) exporting functions like `formatTimestamp`, `toUserTimezone`.

### FR‑4: Test Fixtures & Contract Test Harness
The repository shall contain a `fixtures/` directory with at least:

- A placeholder JSON fixture file representing a sample API response structure for progress breakdown (e.g., `progressBreakdownFixture.json`).
- A test setup that can execute contract tests (e.g., `tests/contract/` with a Jest/Vitest config and a sample test that imports the fixture and hits a stub endpoint).

---

## 5. Acceptance Criteria

1. **AC‑1: Repository Structure Check**  
   The branch `builderforce/task-668` (or its successor) contains directories matching the canonical application tree: `api/`, `frontend/`, `fixtures/`, and at least a `tests/` or `__tests__/` folder at the root.

2. **AC‑2: Backend API Endpoints Reachable**  
   Running the backend (according to project documentation) and hitting a progress‑related endpoint (e.g., `GET /api/progress/test`) returns a `501 Not Implemented` or a controlled stub response. The endpoint is defined in a route file.

3. **AC‑3: Frontend Builds Without Errors**  
   Executing `npm install && npm run build` (or equivalent) from the `frontend/` directory completes without errors. The data‑access layer and shared utility are importable (even if they contain only placeholder exports).

4. **AC‑4: Test Harness Runs**  
   From the project root, running `npm test -- --testPathPattern=contract` (or equivalent) executes a sample contract test and reports success (e.g., a test that validates fixture structure). No real logic needed.

5. **AC‑5: Zero Hidden Progress Code**  
   A case‑insensitive repo‑wide search for `progressBreakdown` still yields 0 matches in code files (excluding PRD/ planning documents). The goal is to have the scaffolding ready, not partial progress logic.

6. **AC‑6: Branch Consistency**  
   The branch passes CI linting and basic structure checks defined by the project (if such checks exist). All directories are properly ignored by `.gitignore` so that ephemeral files (node_modules, build artifacts) are not committed.

---

## 6. Out of Scope (Explicitly Not Covered)

- Any implementation of `ProgressBreakdownObject` type, schema, or accompanying logic from Task #668.
- Actual frontend state management or UI rendering of progress breakdowns.
- Database migrations, seeding, or integration with production data sources.
- Authentication/authorisation middleware for progress endpoints.
- Performance benchmarks or UI/UX design reviews.
- Modifying the existing `agent-runtime/` or `EvermindBrainMap.tsx` beyond what is needed to integrate with the new tree.

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

## Acceptance

_Owned by the validator — to be authored._