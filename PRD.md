> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1543
> _Each agent that updates this PRD signs its change below._

# PRD: Fix Kanban Signoff Endpoint 401 Error

## Problem & Goal

**Problem**  
POST `/api/kanban/tasks/:id/signoff` consistently returns `401 "Token has been revoked or expired"` for authenticated users with valid tokens. This occurs across multiple agent roles (e.g., Ada as Sr. Product Manager, Product Owner) and blocks role‑based signoffs. The same 401 error propagates to related Kanban endpoints: accountability, participants, audit, and tickets lifecycle. The current workaround is the `builtin_reviews_record` fallback (recorded `reviewId=69` for task #767), which does not integrate with Kanban lifecycle management. Root cause likely lies in token scoping or session‑expiry logic specific to Kanban endpoints.

**Goal**  
Restore the intended role‑based signoff flow by eliminating the spurious 401 errors on all affected Kanban endpoints. Authenticated users with the appropriate permissions must be able to complete signoffs normally, while genuine token‑expiration or revocation cases continue to be enforced.

## Target Users / ICP Roles

- Product Owner  
- Senior Product Manager (e.g., Ada)  
- Any agent role with signoff permissions in the Kanban module  
- Downstream systems or automated agents that call the Kanban API for lifecycle management

## Scope

- Diagnose and remediate the authentication/token validation logic for Kanban endpoints (`/api/kanban/tasks/:id/signoff` and all related endpoints: accountability, participants, audit, tickets lifecycle).  
- Ensure the fix works for all role‑based signoffs without altering existing authorization rules.  
- Preserve the `builtin_reviews_record` fallback as a secondary mechanism.

## Functional Requirements

1. **FR‑1**: `POST /api/kanban/tasks/:id/signoff` must accept valid tokens from authorized users and return a `2xx` success response (e.g., 200, 201).  
2. **FR‑2**: Other Kanban endpoints (`/api/kanban/tasks/:id/accountability`, `/api/kanban/tasks/:id/participants`, audit, tickets lifecycle) must return `2xx` for the same valid tokens.  
3. **FR‑3**: Token validation must distinguish between genuinely invalid/expired tokens and those that were incorrectly rejected – only genuine failures may result in `401`.  
4. **FR‑4**: Role‑based access controls must remain unchanged; a user without signoff permissions must still receive a `403` (forbidden) error if they attempt signoff.  
5. **FR‑5**: The `builtin_reviews_record` endpoint must continue to function as a fallback without regression.

## Acceptance Criteria

1. **AC‑1**: Given a valid token for a user with signoff permissions, when `POST /api/kanban/tasks/:id/signoff` is called, the response status is `200` and the signoff is recorded in the Kanban system.  
2. **AC‑2**: Given the same valid token, calling any of the other affected Kanban endpoints returns `200` (not `401`).  
3. **AC‑3**: An expired token or a token belonging to a user without signoff permissions still results in a `401` or `403` as appropriate, with no degradation in security logic.  
4. **AC‑4**: The `builtin_reviews_record` fallback continues to record reviews without errors.  
5. **AC‑5**: All existing automated tests for Kanban API pass.  
6. **AC‑6**: Ada and/or the Product Owner verify manually on the originally failing task (#767) that the signoff endpoint now succeeds.

## Out of Scope

- Modifying Kanban signoff business logic (approval rules, new roles, etc.).  
- Broad refactoring of the token generation or global authentication system.  
- Changes to the `builtin_reviews_record` endpoint beyond preserving its current behavior.  
- Addition of new monitoring, logging, or alerting unless strictly necessary for root‑cause diagnosis.  
- Support for non‑Kanban endpoints that may exhibit similar 401 errors – those are separate issues.

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