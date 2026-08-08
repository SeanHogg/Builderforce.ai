> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1526
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) for Ticket Participant State Update Logic

## Problem & Goal

### Problem
The current implementation of `TicketParticipantsService` in `api/src/application/kanban/ticketParticipants.ts` lacks a method to update the state and assignee fields of an existing participant. The existing `addParticipant()` method only supports the creation of new participant rows, which leads to issues when attempting to modify existing participant data.

### Goal
Implement an `assignParticipant()` method in `TicketParticipantsService` that updates the state and assignee fields of an existing participant, ensuring proper validation, cache invalidation, and handling of reassignment logic.

## Target Users / ICP Roles
- **Developers**: Engineers who maintain and extend the Kanban board functionality.
- **Product Managers**: Individuals who oversee the feature development and ensure it meets user needs.
- **QA Engineers**: Team members responsible for testing the new functionality to ensure it works as expected.

## Scope

### In-Scope
- Creation of a new method `assignParticipant()` in `TicketParticipantsService`.
- Logic to look up an existing participant by `taskId` and `roleKey`.
- Validation to ensure the participant exists before attempting an update.
- Update of the following fields:
  - `assigneeKind`
  - `assigneeRef`
  - `assigneeName`
  - `state` set to `'assigned'`
- Invalidation of relevant caches after the update.
- Handling of reassignment logic as per FR4.

### Out-of-Scope
- Modification of the existing `addParticipant()` method.
- Changes to the database schema or migration scripts.
- Implementation of additional participant states beyond `'assigned'`.
- UI changes related to participant assignment.

## Functional Requirements

1. **Method Definition**
   - The `assignParticipant()` method should be defined in the `TicketParticipantsService` class.
   - Method signature: `assignParticipant(taskId: string, roleKey: string, assigneeKind: string, assigneeRef: string, assigneeName: string): Promise<void>`

2. **Participant Lookup**
   - The method should query the database to find an existing participant row using the provided `taskId` and `roleKey`.
   - If no participant is found, the method should throw a `ParticipantNotFoundError`.

3. **Validation**
   - Ensure that the `assigneeKind`, `assigneeRef`, and `assigneeName` are valid and not null.
   - Validate that the `state` transition from the current state to `'assigned'` is allowed.

4. **Update Logic**
   - Update the participant's `assigneeKind`, `assigneeRef`, `assigneeName`, and `state` fields in the database.
   - Set the `state` to `'assigned'`.

5. **Cache Invalidation**
   - Invalidate any relevant caches that may be storing the participant's previous state or assignee information.

6. **Reassignment Handling**
   - Implement reassignment logic as specified in FR4, which includes notifying relevant parties and updating any related records.

## Acceptance Criteria

1. The `assignParticipant()` method is successfully added to `TicketParticipantsService`.
2. When `assignParticipant()` is called with valid parameters, the existing participant's state and assignee fields are updated correctly.
3. If the participant does not exist, a `ParticipantNotFoundError` is thrown.
4. The method correctly invalidates all relevant caches after the update.
5. Reassignment logic is executed as per FR4, including notifications and related record updates.
6. Unit tests are written to cover:
   - Successful assignment of a participant.
   - Attempting to assign a non-existent participant.
   - Validation of input parameters.
   - Cache invalidation after the update.
   - Reassignment handling.

## Out of Scope

- Modification of the `addParticipant()` method.
- Changes to the database schema or migration scripts.
- Implementation of additional participant states beyond `'assigned'`.
- UI changes related to participant assignment.
- Handling of participant states other than updating to `'assigned'`.

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