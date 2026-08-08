> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1520
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current implementation of the `addParticipant()` method in `TicketParticipantsService` only supports creating new participant entries for a ticket. However, there is no existing logic to update the state of a participant when a ticket is reassigned, which is a critical requirement for managing ticket assignments effectively.

### Goal
Implement a new `assignParticipant()` method in `TicketParticipantsService` that updates the state of an existing participant for a given task and role, ensuring that the assignee information is correctly updated and the cache is invalidated to reflect the changes.

## Target Users / ICP Roles
- **Developers**: Who will integrate and use the updated `TicketParticipantsService` in their applications.
- **Product Managers**: Who need to understand the capabilities and limitations of the ticket assignment functionality.
- **QA Engineers**: Who will test the new assignment logic to ensure it meets the acceptance criteria.

## Scope

### In-Scope
- Creation of a new `assignParticipant()` method in `api/src/application/kanban/ticketParticipants.ts`.
- Logic to look up existing `ticketParticipants` rows by `taskId` and `roleKey`.
- Validation to ensure the participant exists before attempting an update.
- Update of `assigneeKind`, `assigneeRef`, and `assigneeName` fields.
- Update of the participant's state to `'assigned'`.
- Invocation of the `bump()` method to invalidate caches.
- Handling of reassignment by overwriting existing assignee information.

### Out-of-Scope
- Modification of the existing `addParticipant()` method.
- Handling of participant states other than `'assigned'`.
- Implementation of additional validation rules beyond ensuring the participant exists.
- Changes to the database schema or caching mechanisms.

## Functional Requirements

1. **Method Definition**
   - The `assignParticipant()` method must be defined in the `TicketParticipantsService` class.
   - The method should accept parameters for `taskId`, `roleKey`, `assigneeKind`, `assigneeRef`, and `assigneeName`.

2. **Participant Lookup**
   - The method must query the `ticketParticipants` table to find a row matching the provided `taskId` and `roleKey`.
   - The lookup should be case-sensitive for `roleKey` to ensure accurate matching.

3. **Validation**
   - The method must check if a participant row exists for the given `taskId` and `roleKey`.
   - If no matching row is found, the method should throw a `ParticipantNotFoundError`.

4. **Update Logic**
   - The method must update the `assigneeKind`, `assigneeRef`, and `assigneeName` fields of the existing participant row.
   - The `state` field must be set to `'assigned'`.
   - The update should overwrite any existing assignee information to handle reassignment scenarios.

5. **Cache Invalidation**
   - After successfully updating the participant row, the method must call the `bump()` method to invalidate the cache and ensure that the latest changes are reflected.

## Acceptance Criteria

1. **Method Implementation**
   - The `assignParticipant()` method is implemented in the `TicketParticipantsService` class.
   - The method signature includes all required parameters: `taskId`, `roleKey`, `assigneeKind`, `assigneeRef`, and `assigneeName`.

2. **Lookup and Validation**
   - The method correctly looks up the participant by `taskId` and `roleKey`.
   - A `ParticipantNotFoundError` is thrown if the participant does not exist.

3. **Update and State Management**
   - The `assigneeKind`, `assigneeRef`, and `assigneeName` fields are updated as specified.
   - The `state` field is set to `'assigned'`.
   - The method overwrites existing assignee information to handle reassignment.

4. **Cache Invalidation**
   - The `bump()` method is called after the update to invalidate the cache.
   - The cache is invalidated correctly, and the changes are reflected in subsequent calls.

5. **Error Handling**
   - The method handles exceptions gracefully, ensuring that errors are propagated appropriately.

## Out of Scope

- Modification of the existing `addParticipant()` method.
- Implementation of additional participant states.
- Changes to the database schema or caching mechanisms.
- Handling of edge cases not related to the assignment of participants.

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