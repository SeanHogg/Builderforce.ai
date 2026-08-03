> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1541
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Fix Kanban Signoff Token Revocation Issue

## Problem & Goal

The business-analyst agent, after completing its deliverable (authoring the Requirements section of `PRD.md`), was unable to record the signoff for task #693 using `builtin_kanban_signoff`. Every call resulted in a `401` error: `{"error":"Token has been revoked or expired"}`. This prevented the agent from fulfilling the signoff requirement, even though the PRD change was successfully committed. The underlying cause is that the authentication token used by the task becomes invalid before the signoff API call, making the endpoint unreachable for tasks that rely on the original session context. The goal is to ensure that kanban signoff operations succeed reliably for agent-triggered tasks, even if the token's lifespan has expired during execution.

## Target Users / ICP Roles

- Downstream agents (e.g., business-analyst, developer, reviewer) who need to programmatically record a signoff on a Kanban task as part of their workflow.
- Task orchestration systems that chain multiple agent steps and require the final signoff to be recorded automatically.

## Scope

- Enable `builtin_kanban_signoff` (or its equivalent) to handle token expiration gracefully, ensuring the signoff is recorded regardless of token state when the call is made.
- If necessary, introduce a mechanism (e.g., a system-level key or a short‑lived delegated token) that allows the signoff endpoint to accept the request without relying on a user‑session token that may have expired.
- Ensure that the fix does not compromise security; only authorized interactions (from the correct task/agent) should succeed.
- Validate the solution on task #693 as a concrete test case.

## Functional Requirements

1. **FR1: Expired‑token‑tolerant signoff**
   - The signoff API must accept a request that originates from an authorized task context, even if the bearer token has expired, provided the request body contains a valid verification of the task’s identity (e.g., a task‑specific secret or signed payload).

2. **FR2: Task identity verification**
   - A secure, non‑repudiable mechanism shall be implemented to prove that the signoff request comes from the authorized agent for the task. This may be a token generated at task assignment time that is long‑lived or a challenge‑response using the task’s metadata.

3. **FR3: Backward compatibility**
   - Existing signoff calls that use a valid session token must continue to work without modification.

4. **FR4: Error clarity**
   - The API must return a specific error code (not `401` due to token expiry) when the provided task identity cannot be verified, so that agents can distinguish between “token expired” and “invalid task identity”.

5. **FR5: Audit trail**
   - The signoff record must be persisted as before, including contributor, summary, verdict, etc., with the agent identity correctly attributed.

## Acceptance Criteria

- **AC1:** A business-analysis agent can call `builtin_kanban_signoff` on task #693 (or any similar task) after its main work is done, and receive a `200 OK` with the signoff successfully recorded, even when the original session token has expired.
- **AC2:** A request that does not include the correct task identity proof (e.g., forged or missing) results in a `403 Forbidden` or an appropriate error that is not a generic `401`.
- **AC3:** No changes to the agent’s workflow are required beyond what was originally intended (the same function signature works).
- **AC4:** Auditors can see the signoff entry in the Kanban view with correct agent attribution and timestamp.
- **AC5:** Security review confirms that the new token‑bypass mechanism does not create an unauthorized access vector.

## Out of Scope

- Handling signoffs for tasks that are not managed by an automated agent workflow (manual user signoff remains unchanged).
- General token lifecycle management beyond the kanban_signoff endpoint.
- Modifying the structure of the `builtin_kanban_signoff` function itself (if it already supports the required payload) unless necessary to pass the new identity proof.
- Fixing other endpoints that may suffer from token expiry for long‑running agent tasks (this PRD focuses solely on signoff).

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