> **PRD** — drafted by Ada (Sr. Product Mgr) · task #795
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Epic #709 Participation Manifest Fixes

## Problem & Goal

**Problem:** Epic #709 currently has an incorrect and incomplete participation manifest, including a duplicate Engineer role entry and unassigned or incorrectly assigned roles. This impedes accurate team visibility and accountability for the epic.

**Goal:** To rectify the participation manifest for Epic #709, ensuring all defined roles are correctly assigned according to the expected final state, and no `unstaffed` roles remain. This will provide an accurate representation of the team involved in Epic #709.

## Target Users / ICP Roles

This task is an operational execution step.
*   **Internal Operations Team:** Individuals responsible for maintaining system data integrity, typically developers, platform engineers, or technical product managers.

## Scope

This PRD covers the direct application of fixes to Epic #709's participation manifest using newly deployed platform tools. It specifically details the steps to modify the manifest for Epic #709 to reach a predefined correct state.

## Functional Requirements

The following actions must be executed to correct the Epic #709 participation manifest:

1.  **Remove Duplicate Engineer Role:** Identify and remove the redundant `Engineer—development` role entry from Epic #709's manifest.
    *   *Operation:* Call `kanban_remove_participant(taskId=709, participantId=0d6423f1-ff54-40fc-9e0a-082956af913f)`

2.  **Assign Engineer Role:** Assign the `Engineer` role for Epic #709 to John Coder.
    *   *Operation:* Call `kanban_assign_participant(taskId=709, roleKey="engineer", assigneeRef="658608ba-59ab-4ec3-873d-211a89ea000f", assigneeKind="user")`

3.  **Auto-resolve Owner Role:** Ensure the `Owner` role for Epic #709 is correctly assigned to Ada, who is the epic assignee, either via an automatic sync or a manual trigger.
    *   *Operation:* Verify auto-resolution to Ada (fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6) or trigger relevant sync function.

## Acceptance Criteria

The Epic #709 participation manifest is considered fixed when, after applying the above steps, the manifest reflects the following final state:

*   **Owner:** Ada (fdbbd9af-80eb-483e-a5d0-557dbfdd2cc6) - assigned
*   **Engineer:** John Coder (658608ba-59ab-4ec3-873d-211a89ea000f) - assigned
*   **Designer:** Designer (designer-t1) - assigned
*   **Security:** Security (security-t1) - assigned
*   **No Unstaffed Roles:** There are no roles marked as `unstaffed` within the Epic #709 participation manifest.

## Out of Scope

*   Development or deployment of the prerequisite tools/platform changes: #792 (Auto-resolve Owner), #793 (Assign participant tool), and #794 (Remove participant tool).
*   Investigation into the root cause of the initial manifest corruption for Epic #709.
*   General changes or enhancements to the participation manifest system beyond this specific epic's cleanup.
*   Applying these fixes to any other epics or tasks.

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