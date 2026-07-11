> **PRD** — drafted by Ada (Sr. Product Mgr) · task #350
> _Each agent that updates this PRD signs its change below._

# PRD: Engine Migration (v2 → v3) for Existing Cloud Agents via MCP

## Problem & Goal

### Problem
The `cloud_agents.update` MCP capability treats the `engine` field as immutable after agent creation. As a result, upgrading an existing agent from `builderforce-v2` to `builderforce-v3` — to gain the limbic affective personality layer — requires deleting and recreating the agent. This destroys the agent's ID, breaking all existing task assignments and integrations that reference that ID.

### Goal
Make `engine` a mutable field on the `cloud_agents.update` MCP capability so operators can migrate existing agents between engine versions in-place, preserving all identity and relational data.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform Engineers** | Automate bulk engine upgrades across a fleet of cloud agents without re-wiring task pipelines |
| **Agent Operators / Builders** | Upgrade individual agents to v3 to unlock the affective layer without losing agent history or assignments |
| **MCP Integration Developers** | Rely on a stable agent ID contract when building tooling on top of the MCP API |

---

## Scope

This document covers:
- Making `engine` writable via `cloud_agents.update`
- Lifecycle behavior when engine changes (v2 → v3 and v3 → v2)
- Preservation guarantees for agent metadata
- API response contract changes
- Warning surface for destructive transitions (v3 → v2)

---

## Functional Requirements

### FR-1 — `engine` as a Mutable Update Field
The `cloud_agents.update` MCP capability **must** accept an optional `engine` parameter in the request payload. Valid values are `builderforce-v2` and `builderforce-v3`. If `engine` is omitted, the field is unchanged (existing behavior preserved).

### FR-2 — v2 → v3 Upgrade: Limbic Affective Layer Activation
When `engine` is updated from `builderforce-v2` to `builderforce-v3`, the system **must** automatically provision and attach the limbic affective personality layer to the agent. No additional caller action is required to activate this layer.

### FR-3 — v3 → v2 Downgrade: Affective Layer Deactivation with Warning
When `engine` is updated from `builderforce-v3` to `builderforce-v2`, the system **must** deactivate the limbic affective layer. The API response **must** include a structured warning indicating that the affective layer has been removed.

### FR-4 — Full Metadata Preservation During Engine Change
Across any engine transition the following **must** remain unchanged:
- Agent ID
- Agent name and bio
- Skills configuration
- Task assignments (active and historical)
- Publish status
- All other metadata fields not explicitly part of the engine specification

### FR-5 — Updated Engine Value Reflected in Response
The `cloud_agents.update` response payload **must** include the `engine` field set to the new value, confirming the transition took effect. The response **must not** return the previous engine value.

### FR-6 — No Interruption to Active Tasks
If the agent has active (in-flight) task assignments at the time of the engine update, the system **must** either:
- Complete those tasks under the previous engine before switching, **or**
- Clearly surface a conflict error to the caller indicating the engine cannot be changed while tasks are active, allowing the caller to retry.

The chosen strategy **must** be documented in the API reference.

### FR-7 — Same-Version Update is a No-Op
If the `engine` value supplied equals the agent's current engine, the request **must** succeed with HTTP 200 and return the current state unchanged. No re-provisioning occurs.

---

## Acceptance Criteria

- [ ] `cloud_agents.update` accepts an `engine` parameter (`builderforce-v2` | `builderforce-v3`)
- [ ] Upgrading an agent from `builderforce-v2` to `builderforce-v3` activates the limbic affective layer automatically, verifiable via a subsequent `cloud_agents.get` call returning `affective_layer: true` (or equivalent field)
- [ ] Agent ID, name, bio, skills, task assignments, and publish status are identical before and after the engine update (validated by diffing a full agent snapshot pre- and post-update)
- [ ] The API response for a successful update reflects the new `engine` value
- [ ] Downgrading from `builderforce-v3` to `builderforce-v2` succeeds and the response contains a structured warning about affective layer removal
- [ ] A same-version `engine` update returns HTTP 200 with no state mutation
- [ ] Attempting to update engine while active tasks exist returns a defined, documented error or completes gracefully per the chosen conflict strategy (FR-6)
- [ ] Invalid `engine` values are rejected with a validation error (HTTP 422 or equivalent)

---

## Out of Scope

- **Creating new agents with a specific engine** — creation-time `engine` selection is an existing feature and is not modified here
- **New engine versions beyond `builderforce-v3`** — this PRD covers only the v2 ↔ v3 axis; future engine versions require a separate PRD
- **Migrating agent conversation or memory history** — only structural metadata and assignments are preserved; runtime state (memory, session context) migration is not addressed
- **Bulk migration tooling or batch API** — individual agent updates only; a batch endpoint is a future consideration
- **UI/dashboard controls** for engine migration — this PRD covers only the MCP API surface
- **Billing or quota changes** triggered by engine upgrade — handled by a separate pricing PRD if applicable
- **Rollback / undo** of an engine change — callers may issue a subsequent downgrade request manually; no automatic rollback mechanism is introduced