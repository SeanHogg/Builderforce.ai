> **PRD** — drafted by John Coder ((V2) (Durable)) · task #792
> _Each agent that updates this PRD signs its change below._

# PRD: Auto-resolve Owner Role from Epic's Assigned Agent

## Problem & Goal
**Problem:**
The participation manifest's Owner role does not automatically sync with the epic's assigned agent (`assignedUserId`/`assignedAgentRef`). This creates manual overhead for product managers and leads to inconsistencies where the manifest shows `unstaffed` despite the epic having a clear owner (e.g., Epic #709 assigned to Ada but manifest Owner role is `unstaffed`).

**Goal:**
Automatically resolve the Owner role in the participation manifest from the epic's assigned agent to eliminate manual duplication and ensure the manifest always reflects the current epic owner.

---

## Target Users / ICP Roles
- **Primary:**
  - Product Managers (Sr. PMs, Group PMs) responsible for managing epics and ensuring consistency across planning artifacts.
- **Secondary:**
  - Engineering Managers/Leads reviewing manifests for alignment with epic ownership.
  - Program Managers validating cross-team participation.

---

## Scope
### In Scope
- Auto-resolution of the Owner role in the participation manifest when:
  - The manifest is **initially built**.
  - The manifest is **refreshed** (e.g., on epic assignment changes or manual triggers).
  - The epic's `assignedUserId`/`assignedAgentRef` is updated.
- Handling edge cases:
  - Epics with no assignee (`assignedUserId` is `null`).
  - Epics assigned to agents vs. human users (when both fields are present, prioritize human user if inconsistencies exist).
- Backward compatibility with existing manifests.

### Out of Scope
- Auto-resolution of **other participant roles** (e.g., Contributor, Reviewer) in the manifest. This PRD focuses **only** on the Owner role.
- Changes to the UI for epic assignment or manifest display (assume existing interfaces remain).
- Workflow changes for how epics are assigned (e.g., no new assignment surfaces or automation).
- Syncing **from** the manifest **to** the epic (e.g., no bidirectional sync).
- Auditing or logging of ownership changes for compliance/historical purposes.

---

## Functional Requirements
| **ID** | **Requirement**                                                                                     | **Priority** | **Notes**                                                                 |
|--------|-----------------------------------------------------------------------------------------------------|--------------|---------------------------------------------------------------------------|
| FR-1   | The system **must** resolve the Owner role in the participation manifest from the epic's `assignedUserId` or `assignedAgentRef`. | P0           | Use `assignedUserId` if populated; fall back to `assignedAgentRef`.     |
| FR-2   | The Owner role **must** reflect the epic's current assignee when the manifest is **created or refreshed**. | P0           | Triggered on manifest generation or epic assignment changes.            |
| FR-3   | If the epic's assignee is updated, the Owner role **must** update on the next manifest refresh.     | P0           | Can be event-driven (e.g., on assignment change) or lazy (on manifest read). |
| FR-4   | If the epic has no assignee (`assignedUserId`/`assignedAgentRef` is `null`), the Owner role **must** remain `unstaffed`. | P0           | No fallback or default assignments.                                      |
| FR-5   | The system **must** handle edge cases where `assignedUserId` and `assignedAgentRef` are inconsistent (e.g., prioritize `assignedUserId`). | P1           | Log a warning for manual review if both fields are populated but differ.|
| FR-6   | The system **must** not overwrite manual Owner assignments in the manifest unless the epic's assignee changes. | P1           | Preserve manual edits unless explicitly tied to epic assignment.        |
| FR-7   | The system **should** validate that the resolved Owner exists in the system (e.g., user/account is not deleted). | P2           | Fall back to `unstaffed` + log warning if the assignee is invalid.      |

---

## Acceptance Criteria
### **AC-1: Owner Auto-Resolution on Manifest Creation/Refresh**
- **Given** an epic with an assigned agent (`assignedUserId` = Ada, UUID `fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6`),
- **When** the participation manifest is **created or refreshed**,
- **Then** the Owner role **must** show Ada as the assignee (not `unstaffed`).
  - **Test:** Verify Epic #709's manifest Owner role reflects Ada after a refresh.

### **AC-2: Owner Updates on Epic Reassignment**
- **Given** an epic assigned to Ada with a manifest Owner role reflecting Ada,
- **When** the epic is reassigned to Bob (`assignedUserId` updated),
- **Then** the Owner role **must** update to Bob on the next manifest refresh.
  - **Test:** Reassign Epic #709 from Ada to Bob; verify Owner updates to Bob.

### **AC-3: Unstaffed Owner for Unassigned Epics**
- **Given** an epic with no assignee (`assignedUserId`/`assignedAgentRef` = `null`),
- **When** the participation manifest is created or refreshed,
- **Then** the Owner role **must** remain `unstaffed`.
  - **Test:** Verify manifest for an unassigned epic shows `unstaffed` Owner.

### **AC-4: Backward Compatibility**
- **Given** an existing manifest where the Owner role was manually assigned,
- **When** the epic's assignee is updated,
- **Then** the Owner role **must** update to the new assignee (manual edits are overwritten).
  - **Test:** Manually assign Owner to Charlie for an epic; reassign epic to Dave; verify Owner updates to Dave.

### **AC-5: Edge Case Handling**
- **Given** an epic where `assignedUserId` and `assignedAgentRef` are both populated but differ,
- **When** the manifest is refreshed,
- **Then** the Owner role **must** reflect `assignedUserId` (with a warning logged).
  - **Test:** Force inconsistency between `assignedUserId` and `assignedAgentRef`; verify resolution priorities `assignedUserId`.

### **AC-6: Invalid Assignee Handling**
- **Given** an epic assigned to a deleted/invalid user (`assignedUserId` points to a non-existent user),
- **When** the manifest is refreshed,
- **Then** the Owner role **must** show `unstaffed` + log a warning.
  - **Test:** Assign epic to a deleted user ID; verify Owner is `unstaffed` and warning is logged.

---

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