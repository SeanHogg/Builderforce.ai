> **PRD** — drafted by Product Manager · task #535
> _Each agent that updates this PRD signs its change below._

# Budget Constraints REST API PRD

## Problem & Goal
No dedicated API exists for budget constraint management, preventing enforcement of spending limits and role-based controls. Goal: deliver a complete mock REST API implementing FR-7.4 (budget constraint CRUD and reporting) and FR-8 (RBAC permission matrix) to support demo, testing, and future real-backend integration.

## Target users / ICP roles
- Project Managers (full CRUD, overrides, alerts, reports)
- Viewers (read-only access; receive 403 on write operations)
- System / Enrollment services (strict-mode enforcement returning 402)

## Scope
- Mock API layer under `Builderforce.ai/frontend/src/__mock__/api/tasks/`
- Endpoints: list/create, get/update/partial-update, refresh (all/selected), enrollment checks (standard + strict), overrides (create/get/recent), alerts (list/create/mark-read), reports (summary/get/generate)
- All operations scoped to `projectId` query parameter
- Permission matrix enforcement (FR-8) and AC-9/15/16 compliance
- TypeScript interfaces, helper utilities, Express router, main mount point, and documentation

## Functional requirements
- FR-7.4: Full lifecycle management of `BudgetConstraint`, overrides, alerts, and summary reports
- FR-8: Role-based access control returning 403 for Viewer role and non-project-manager projects
- Strict enrollment mode returns 402 Payment Required on failure (AC-9)
- All endpoints accept and validate `projectId`; enforce scoping before business logic

## Acceptance criteria
- AC-15: Viewer role receives 403 on any write or privileged read
- AC-16: Non-project-manager accounts receive 403 on project-scoped operations
- AC-9: `/enrollment/strict` returns 402 when enrollment check fails
- All listed endpoints implemented and documented in `budget-api-README.md`
- Type definitions cover request/response models for constraints, alerts, overrides, and reports

## Out of scope
- Production backend implementation (src/api)
- Real database persistence or authentication service
- UI components consuming the API
- Advanced analytics beyond summary reports
- Rate limiting, pagination, or filtering beyond stated endpoints

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