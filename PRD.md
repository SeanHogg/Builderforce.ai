> **PRD** — drafted by Ada (Sr. Product Mgr) · task #773
> _Each agent that updates this PRD signs its change below._

# Feature: Agent-Role Assignment via Manifest Update

## Problem & Goal
Multi-agent orchestrations often fail when the assignment of agents to roles is ambiguous or unverifiable. Currently, the relationship between a role and its assigned agent is implicit or stored outside the system’s single source of truth (the crew manifest). This leads to runtime inconsistencies, duplicate assignments, and difficulty in auditing which agent is responsible for a given role.

**Goal:** Introduce an explicit “assign agent to role” operation that atomically updates the crew manifest. The manifest must reflect the assignment by setting the role’s `state` to `"assigned"` and recording the chosen agent’s identifier. This ensures the manifest remains the authoritative, deployable artifact for the crew.

## Target Users / ICP Roles
- **Crew Architect / DevOps Engineer**: Defines crew structure and needs to programmatically or manually finalize assignments without editing raw YAML/JSON by hand.
- **Orchestrator Runtime**: The internal engine that consumes the manifest and expects well-formed, unambiguous assignments before execution.
- **CI/CD Pipelines**: Automated systems that assemble crews from a pool of available agents and must produce a valid, fully-assigned manifest artifact.

## Scope
- A single API or CLI command (`assign_role`) that, given a crew manifest and a role name, sets the `state` field of that role to `"assigned"` and populates the `assigned_agent` field with the provided agent ID.
- Input validation: Reject if the role doesn’t exist, if the role is already assigned to a different agent (unless forced), or if the agent ID is invalid/offline.
- The manifest is the only mutable artifact; no side effects on the actual agent (e.g., no connection test, no token exchange) — those are separate concerns.
- The output is the updated manifest; the caller is responsible for persisting the new version.

## Functional Requirements
1. **Manifest parsing**: The system must accept a manifest document (YAML/JSON) conforming to the crew schema (list of roles, each with a `state` and optionally `assigned_agent`).
2. **Assignment request**: The operation receives a role identifier and an agent identifier.
3. **State transition**:
   - The target role’s `state` is changed to `"assigned"`.
   - The role’s `assigned_agent` field is set to the provided agent identifier.
   - Other fields in the role definition are preserved unchanged.
4. **Conflict handling**:
   - If the role already has `state: "assigned"` and `assigned_agent` differs from the requested agent, the operation fails with a clear error unless an `overwrite` flag is set to `true`.
   - If `overwrite` is true, the existing assignment is replaced.
5. **Idempotency**: Repeating the same assignment request with the same role and agent (when already assigned to that agent) succeeds without error and returns the unchanged manifest.
6. **Validation**:
   - Role must exist in the manifest.
   - Agent ID must be a non-empty string.
   - Invalid role names or agent IDs cause a rejected request with an appropriate error code.
7. **Output**: The updated manifest document is returned (same format as input), with the modification applied to the specified role.

## Acceptance Criteria
- Given a manifest with a role `"researcher"` in state `"unassigned"`, calling `assign_role(manifest, role="researcher", agent_id="agent-007")` returns a manifest where `researcher.state = "assigned"` and `researcher.assigned_agent = "agent-007"`.
- Calling the same function a second time with identical arguments succeeds (idempotent) and returns the same output.
- Calling `assign_role` with a different `agent_id` (without `overwrite`) on an already assigned role results in a conflict error.
- Passing a role name that doesn’t exist throws a “role not found” error.
- Passing an empty or invalid `agent_id` throws a validation error.
- All errors include a descriptive message and do not mutate the original manifest.

## Out of Scope
- Agent availability checks or real-time health validation.
- Provisioning or launching the assigned agent.
- Role creation or deletion; this feature only modifies an existing role’s assignment fields.
- Concurrent modification safety (e.g., optimistic locking) — the caller is responsible for managing multiple writers.
- Automatic rollback of the manifest if downstream execution fails.
- Graphical/manual assignment UI (API/CLI only).
- Notification to the assigned agent or any event stream.

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