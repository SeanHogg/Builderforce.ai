> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1532
> _Each agent that updates this PRD signs its change below._

# PRD: Security Provisioning Dashboard Repository Resolution for Task #587

## Problem & Goal
Task #587 references a Security Provisioning Dashboard that is not present in the currently bound repository `seanhogg/builderforce.ai`. The repository contains only a Cross-Project Health Dashboard (`frontend/src/dashboard/cross-project-health/`) with RAG-scored project cards; no security gap tracking, no GAP-G1/G2/G3 states, and no remediation integration. This mismatch blocks implementation of the dashboard changes described in the PRD.

**Goal:** Identify the correct repository that owns the Security Provisioning Dashboard, re-bind task #587 to that repository, or re-scope the task to maintain integrity with the existing product context.

## Target Users / ICP Roles
- **Task Author / Product Owner:** Needs an accurate repository binding so that developers can implement the requirements.
- **Developer assigned to #587:** Requires the correct codebase to make changes and verify acceptance criteria.
- **Release Manager:** Ensures that feature work is tracked against the proper repository for build and deployment.

## Scope
- Investigate the existence of the Security Provisioning Dashboard across all repositories owned by the organization (or accessible via the security/compliance platform).
- Determine if the dashboard lives in the security/compliance platform repo, a dedicated dashboard repo, or another service.
- Re-bind task #587 to the correct repository, updating any associated links, branch references, and CI/CD configurations.
- If the dashboard does not exist, re-scope task #587 to align with the Cross-Project Health Dashboard or create the dashboard in the appropriate repository.

## Functional Requirements
1. **Repository Discovery**
   - Search for the Security Provisioning Dashboard by name, relevant keywords (GAP-G1, GAP-G2, GAP-G3, remediation tracking) across all organization repositories.
   - If a candidate repository is found, confirm that it contains the dashboard with the expected data model and UI components.

2. **Task Re-binding**
   - Update the repository link of task #587 to the discovered repository.
   - Migrate any existing task notes, attachments, or references that are tied to the old repository, preserving context.
   - Notify the task assignee and stakeholders of the change.

3. **Re-scoping (if necessary)**
   - If no dashboard exists, propose a re-scoped task that either:
     - Adds security gap tracking to the existing Cross-Project Health Dashboard in `builderforce.ai`, or
     - Creates a new Security Provisioning Dashboard in a designated repository (security/compliance platform).
   - Update the task’s PRD requirements to match the new scope.

## Acceptance Criteria
- [ ] The correct repository containing the Security Provisioning Dashboard is identified and documented.
- [ ] Task #587 is successfully re-bound to that repository, and all linked resources point to the correct codebase.
- [ ] A developer can check out the repository and locate the dashboard code matching the PRD’s expected behavior.
- [ ] If re-scoped, the task description and requirements are updated to reflect the correct product context, and the new scope is approved by the product owner.
- [ ] No unrelated files or tasks in the originally bound `seanhogg/builderforce.ai` repo are affected.

## Out of Scope
- Implementation of dashboard features or UI changes (covered by the actual task #587 after binding).
- Evaluation of the Cross-Project Health Dashboard’s current functionality beyond confirming it is not the security dashboard.
- Any changes to the security/compliance platform’s backend or data pipelines unless required for the dashboard’s existence confirmation.

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