> **PRD** — drafted by Ada (Sr. Product Mgr) · task #498
> _Each agent that updates this PRD signs its change below._

# Task: Budget Constraints: REST API + role-based access

## Problem & Goal

User roles were previously defined by permision type, but it was tedious and error-prone to restrict user access based solely on permision types.

## Target Users / ICP Roles

* Project Managers (PRMs)
* Finance Administrators (FR-8s)

## Scope

The scope of this task includes:

1. Expose budget-constraints via HTTP endpoints.
2. Enforce the FR-8 permission matrix.

## Functional Requirements

* **FR-7.4**: Expose budget-constraints via HTTP endpoints.
	+ List (get): List all budget constraints in a given project.
	+ Create (post): Create a new budget constraint in a given project.
	+ Get (get): Retrieve information about a single budget constraint.
	+ Update (put) or Patch (PATCH): Update or update multiple budget constraints in a given project.
	+ Refresh (put) or PATCH (PATCH): Refresh budget constraints without deletion and update their state.
	+ Enrollment check (put): Checks for the current user's enrollment status to a project. Selecting enroll uses a POST to the enrollment API and returning HTTP 402 in strict mode if an enrollment check is not passed.
* **FR-8**: Enforce the FR-8 permission matrix:
	+ AC-15 (Viewer): HTTP 403 for users with READ_PERMISSION.
	+ AC-16 (Project Manager): Scoped to own projects.

## Acceptance Criteria

* **AC-9**: Budget constraints endpoints return HTTP 402 in strict mode for actions requiring enrollment checks to prevent unauthorized actions.
* **AC-15**: Upon visiting budget constraint endpoints instantiated with the VIEWER role, the user experiences HTTP 403.
* **AC-16**: When a user attempts to access a budget constraint that they are not the project manager of and does not have the READ_PERMISSION, they receive an HTTP 403.

### Out of Scope

* Custom module integrations (this would require a src/api layer to be created first).
* DB-specific security APIs (not needed when using FR-8 assumption level).
* Custom/non-gen-lib permissions (not needed for RLF's use case).
* Custom features not defined in the FR table (do not need to implement them).
kfinelpat/budget-api/src/config.js
const userAgent = 'Budget API';

module.exports = {
  userAgent,
 apiKey: 'your-api-key-here',
};