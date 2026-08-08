> **PRD** — drafted by Ada (Sr. Product Mgr) · task #891
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Ready for Refinement Status Implementation (FR-5/AC-6)

## Problem & Goal
**Problem:** Backlog items cannot be explicitly marked as "Ready for Refinement," making it difficult for product managers and engineering leads to identify and triage work that has met minimum definition criteria but has not yet entered an active refinement session.

**Goal:** Introduce a `Ready for Refinement` workflow status, associated filtering, and migration path so teams can clearly signal, discover, and manage backlog candidates that are primed for collaborative refinement.

## Target Users / ICP Roles
- **Product Managers:** Need to promote candidate items and filter the backlog to prioritize refinement sessions.
- **Engineering Leads / Tech Leads:** Need to pull a filtered view of ready items when planning refinement meetings or sprint pre-planning.
- **Scrum Masters / Agile Coaches:** Ensure workflow integrity and adherence to team definition-of-ready policies.

## Scope
- Add a new persistent status value: `Ready for Refinement`.
- Support migration of existing items to the new status.
- Expose status in the API.
- Provide UI filter toggles in the backlog and board views.
- Ensure the status respects role-based transition rules.

## Functional Requirements
- **FR1 – Status Definition:** The system MUST support `Ready for Refinement` as a first-class workflow status for applicable work item types (User Story, Bug, Task).
- **FR2 – Status Transitions:** Items MUST be movable into `Ready for Refinement` from `New` and `Backlog` states. Transitions out MUST allow `Refinement in Progress` (if exists) or `Open`.
- **FR3 – Database & API Support:**
  - Status MUST be stored and queryable via the items’ `status` field.
  - GET endpoints MUST return `Ready for Refinement` where applicable.
  - PATCH/POST endpoints MUST allow setting the status to `Ready for Refinement` if the transition is valid.
- **FR4 – Backlog Filter:** A dedicated quick-filter toggle labeled `Ready for Refinement` MUST be present in the backlog view to show only items with the status.
- **FR5 – Board View Filter:** Board views (Kanban/Sprint) MUST include a filter option to include/exclude `Ready for Refinement` items.
- **FR6 – Migration:** Existing items in `New` or `Backlog` that meet a configurable minimum set of property completeness (title + acceptance criteria populated) MAY be bulk-migrated on admin trigger.

## Acceptance Criteria
- **AC1:** The `Ready for Refinement` status appears as a selectable option in the item detail status dropdown when the current status is `New` or `Backlog`.
- **AC2:** The backlog view contains a filter toggle that, when active, restricts visible items to only those with `Ready for Refinement` status.
- **AC3:** Board view filter correctly shows/hides `Ready for Refinement` items according to user selection, without affecting column WIP counts.
- **AC4:** API response for `GET /items?status=Ready for Refinement` returns only items in that status; `PATCH /items/{id}` with `{"status": "Ready for Refinement"}` succeeds for valid transition and fails with `409 Conflict` for invalid ones.
- **AC5:** Admin-initiated migration script correctly identifies `New`/`Backlog` items with title + acceptance criteria populated, sets them to `Ready for Refinement`, and provides a summary report of updated count.

## Out of Scope
- Custom definition-of-ready (DoR) condition builder (assumes a static minimum via config fallback).
- Automatic promotion to `Ready for Refinement` based on field changes (only explicit or admin-bulk migration).
- New notification or automation rules triggered by the status (existing rules engine may consume it separately).
- Reporting/dashboard widgets specific to this status.

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