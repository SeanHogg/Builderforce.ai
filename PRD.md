> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1268
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current repository (`seanhogg/builderforce.ai`) bound to project 11 does not contain the necessary application layer for the Builderforce.ai app. This includes critical components such as the Next.js `app/` directory, `frontend/package.json`, `api/src/**`, routes, database schema/migrations, and the `OnboardingStepper`/wizard step components. As a result, onboarding/PMO tickets cannot be implemented, and multiple tickets (#147, #266, #284, #285, #297, #305, #321, #325, #346, and #154) are blocked.

### Goal
Bind the correct repository/branch that contains the `Builderforce.ai/frontend` and `api` components to project 11. This will enable the implementation of onboarding/PMO tickets and unblock the development workflow.

## Target Users / ICP Roles
- **Developers**: Frontend and backend developers who need access to the complete Builderforce.ai application code to implement features and fix issues.
- **Project Managers**: Individuals responsible for managing the project and ensuring that tickets are completed on time.
- **QA Engineers**: Team members who need to test the application and ensure it meets the required specifications.

## Scope
- Identify and bind the correct repository/branch that contains the `Builderforce.ai/frontend` and `api` components.
- Update project 11 to reference the correct repository/branch.
- Communicate the change to all relevant stakeholders to ensure they are aware of the updated repository.
- Unblock and reassign the affected tickets for implementation.

## Functional Requirements

1. **Repository Identification**
   - Locate the correct repository/branch that contains the `Builderforce.ai/frontend` and `api` components.
   - Verify that the repository includes:
     - Next.js `app/` directory
     - `frontend/package.json`
     - `api/src/**`
     - Routes
     - Database schema/migrations
     - `OnboardingStepper`/wizard step components

2. **Binding the Repository**
   - Bind the identified repository/branch to project 11.
   - Ensure that the binding is correctly configured and accessible to all team members.

3. **Updating Project Configuration**
   - Update project 11's configuration to reference the new repository/branch.
   - Verify that the configuration changes are correctly applied and do not introduce new issues.

4. **Communication**
   - Notify all relevant stakeholders (developers, project managers, QA engineers) of the repository change.
   - Provide clear instructions on how to access the new repository/branch.

5. **Ticket Management**
   - Unblock the affected tickets (#147, #266, #284, #285, #297, #305, #321, #325, #346, and #154).
   - Reassign the tickets to the appropriate team members for implementation.

## Acceptance Criteria

- The correct repository/branch containing the `Builderforce.ai/frontend` and `api` components is bound to project 11.
- All team members have access to the new repository/branch.
- The project configuration is updated to reference the new repository/branch.
- Stakeholders are informed of the change and understand how to access the new repository/branch.
- The affected tickets are unblocked and reassigned for implementation.
- No new issues are introduced as a result of the repository change.

## Out of Scope

- Modifying the contents of the `Builderforce.ai/frontend` and `api` components.
- Implementing new features or fixing existing issues in the application.
- Updating any other projects or repositories not related to project 11.
- Training team members on how to use the new repository/branch.

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