> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1268
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
A prior analysis incorrectly concluded that the repository bound to project 11 (`seanhogg/builderforce.ai`) does not contain the necessary application layer for Builderforce.ai. Multiple onboarding/PMO tickets (#147, #266, #284, #285, #297, #305, #321, #325, #346, #154) were flagged as blocked due to this assessment.

### Verification Results
The bound repository `seanhogg/builderforce.ai` **DOES** contain all required components:

| Component | Location | Status |
|-----------|----------|--------|
| Next.js `app/` directory | `frontend/src/app/` | ✅ Present |
| `frontend/package.json` | `frontend/package.json` | ✅ Present |
| `api/src/**` | `api/src/` | ✅ Present |
| Routes | `frontend/src/app/` + `api/src/presentation/routes/` | ✅ Present |
| Database schema/migrations | `api/src/infrastructure/database/schema.ts` + `api/migrations/` (300+ migration files) | ✅ Present |
| `OnboardingStepper` component | `frontend/src/components/OnboardingStepper.tsx` | ✅ Present |

### Goal
Correct the PRD to reflect verified repository state and document that no repository binding change is required. The previously blocked tickets can proceed with implementation.

## Target Users / ICP Roles
- **Developers**: Frontend and backend developers who need access to the complete Builderforce.ai application code to implement features and fix issues.
- **Project Managers**: Individuals responsible for managing the project and ensuring that tickets are completed on time.
- **QA Engineers**: Team members who need to test the application and ensure it meets the required specifications.

## Scope
- Correct the PRD with verified repository contents.
- Confirm the bound repository is correct and requires no changes.
- Document that affected tickets are ready for implementation.

## Functional Requirements

1. **Repository Verification**
   - Verify the repository includes:
     - ✅ Next.js `app/` directory — `frontend/src/app/`
     - ✅ `frontend/package.json` — root-level in `frontend/`
     - ✅ `api/src/**` — application layer at `api/src/`
     - ✅ Routes — frontend pages + API routes
     - ✅ Database schema/migrations — `api/migrations/` (300+ SQL files)
     - ✅ `OnboardingStepper`/wizard step components — `frontend/src/components/OnboardingStepper.tsx`

2. **Confirmation**
   - The bound repository `seanhogg/builderforce.ai` is correct.
   - No rebinding is required.
   - Affected tickets can be unblocked.

## Acceptance Criteria

- ✅ The repository bound to project 11 contains the Builderforce.ai frontend and API components.
- ✅ The `OnboardingStepper` component exists at `frontend/src/components/OnboardingStepper.tsx`.
- ✅ Database migrations exist in `api/migrations/`.
- ✅ The previously blocked tickets can proceed with implementation.

## Out of Scope

- Modifying the contents of the `Builderforce.ai/frontend` and `api` components.
- Implementing new features or fixing existing issues in the application.
- Binding to a different repository.

## Resolution

**RESOLVED**: No action required. The repository is correctly bound. The blocker identified in the problem statement was based on an incorrect assessment of the repository contents.

## Requirements

_Verified by business-analyst — repository contains all required components._

## Design

_N/A — no architectural changes required._

## Implementation Notes

_No implementation needed — repository binding is correct._

## Review

_Confirmed: repository contents verified via file listing and search operations._

## Test Evidence

_N/A — no code changes made. Repository verified via file system listing._
