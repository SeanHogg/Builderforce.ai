> **PRD** — drafted by John Coder ((V2) (Durable)) · task #794
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Participant Removal Tool

## Problem & Goal

**Problem:** Project Managers currently lack the ability to remove participants from a task's participation manifest. This leads to stale or duplicate entries, such as the redundant 'Engineer—development' role (participantId: 0d6423f1-ff54-40fc-9e0a-082956af913f) on Epic #709, making the manifest inaccurate and difficult to manage.

**Goal:** To provide Project Managers with a robust, backend platform tool that enables the removal of specific participants from a task's manifest, thereby ensuring the manifest remains clean, accurate, and relevant.

## Target Users / ICP Roles

*   **Project Manager:** Primary user responsible for managing task manifests.

## Scope

Develop a new backend platform tool/API to facilitate the removal of individual participants from a specified task's manifest. This tool will allow removal by either role key or specific participant ID, with built-in validations.

## Functional Requirements

1.  A new backend platform tool, `kanban_remove_participant`, shall be implemented.
2.  The tool shall accept the following parameters:
    *   `taskId` (number): The ID of the epic/task whose manifest is to be updated.
    *   `roleKey` (string, optional): The key of the role to remove (e.g., "engineer"). Either `roleKey` or `participantId` must be provided.
    *   `participantId` (string, optional): The UUID of the specific participant to remove. Either `roleKey` or `participantId` must be provided.
3.  The tool shall validate that the specified `participantId` or `roleKey` (when used with `taskId`) corresponds to an existing participant within the given task's manifest.
4.  The tool shall validate that the participant to be removed is not the *only* instance of a role deemed "required" by the system's business rules. If it is, the removal operation must be blocked.
5.  Upon successful validation, the tool shall permanently delete the specified participant entry from the `taskId`'s participation manifest.

## Acceptance Criteria

1.  A new platform tool named `kanban_remove_participant` is successfully created and available.
2.  The `kanban_remove_participant` tool correctly processes requests with valid `taskId` and either `roleKey` or `participantId`.
3.  When provided a valid `taskId` and `participantId`, the tool successfully deletes the specified participant from the corresponding manifest.
4.  The duplicate 'Engineer—development' role (participantId: 0d6423f1-ff54-40fc-9e0a-082956af913f) is successfully removed from Epic #709's manifest using the `kanban_remove_participant` tool.
5.  Attempts to remove a non-existent participant or a participant from an incorrect task result in an appropriate error or validation message.
6.  Attempts to remove a required participant who is the sole instance of their role are blocked by the tool, with an appropriate error or validation message.

## Out of Scope

*   Development of any user interface (UI) for this tool. This is purely a backend platform capability.
*   Detailed definition or implementation of the "required participant" business rules beyond ensuring the tool *respects* existing or future rules.
*   Batch removal of multiple participants in a single operation.

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