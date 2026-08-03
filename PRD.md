> **PRD** — drafted by Ada (Sr. Product Mgr) · task #768
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document for Epic #709 Manifest Owner Assignment

## Problem & Goal
When a manifest is generated from an epic, the ownership and lifecycle state are not automatically derived from the epic’s assignment fields. This forces manual updates, increases error risk, and slows down downstream processes that depend on accurate owner and state information.

**Goal:** Automatically set the manifest’s `Owner` field to the assigned agent’s identifier (`Ada`) and the `state` field to `assigned` whenever Epic #709 has either `assignedAgentRef = "Ada"` or `assignedUserId = "Ada"`.

## Target Users / ICP Roles
- DevOps engineers generating deployment manifests from work tracking epics.
- Project managers or release coordinators who rely on accurate manifest metadata for audit trails.
- Platform administrators who configure automated manifest pipelines.

## Scope
- **In scope:** Epic #709 manifest generation logic when `assignedAgentRef` or `assignedUserId` equals the exact string `"Ada"`.
- **In scope:** Setting exactly two manifest metadata fields: `Owner` (value `"Ada"`) and `state` (value `"assigned"`).
- **Trigger condition:** OR logic – if either assignment reference resolves to `"Ada"`, the rule applies.

## Functional Requirements
1. **Detection**  
   The manifest generation service SHALL inspect Epic #709 for the presence of `assignedAgentRef` and `assignedUserId`.
   - If either value string‑equals `"Ada"` (case‑sensitive), the rule is triggered.

2. **Owner Mapping**  
   When the rule triggers, the generated manifest’s `Owner` metadata field SHALL be set to `"Ada"`.

3. **State Mapping**  
   When the rule triggers, the manifest’s `state` field SHALL be set to `"assigned"`.

4. **No Overlap Conflict**  
   If both `assignedAgentRef` and `assignedUserId` are present and both equal `"Ada"`, the same result SHALL be produced without duplication or error.

5. **Non‑Triggering Cases**  
   If neither field equals `"Ada"` (e.g., other users, empty or missing fields), the rule SHALL NOT apply; existing default manifest generation behaviour SHALL remain unchanged.

## Acceptance Criteria
| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Epic #709 has `assignedAgentRef = "Ada"` and no `assignedUserId` | Manifest `Owner` = `"Ada"`, `state` = `"assigned"` |
| 2 | Epic #709 has `assignedUserId = "Ada"` and no `assignedAgentRef` | Manifest `Owner` = `"Ada"`, `state` = `"assigned"` |
| 3 | Epic #709 has `assignedAgentRef = "Ada"` **and** `assignedUserId = "Ada"` | Manifest `Owner` = `"Ada"`, `state` = `"assigned"` (no duplicates) |
| 4 | Epic #709 has `assignedAgentRef = "Other"` or `assignedUserId = "Other"` | Manifest `Owner` and `state` follow existing defaults; not overwritten |
| 5 | Epic #709 has both fields missing or null | Manifest generation proceeds with no change to `Owner`/`state` |

## Out of Scope
- Other epics, tasks, or work items; this rule applies strictly to Epic #709.
- Dynamic mapping from arbitrary agent/user identifiers – only the literal `"Ada"` is handled.
- Updates to the manifest after initial generation (no listening for assignment changes).
- Any user interface changes; this is a pure backend data mapping.
- Additional manifest fields beyond `Owner` and `state`.
- Rollback or migration of previously generated manifests.

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