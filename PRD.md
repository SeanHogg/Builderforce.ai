> **PRD** — drafted by Validator · task #857
> _Each agent that updates this PRD signs its change below._

# PRD: Auto-resolve Owner role from epic's assigned agent

## Problem & Goal
Epic tickets may have an assigned agent or user that should automatically become the manifest Owner. Current `deriveManifest` logic does not populate the Owner role, leading to missing or inconsistent Owner participants on create/refresh.  
Goal: Patch `TicketParticipantsService.deriveManifest` to auto-populate Owner from `task.assignedUserId` (fallback `assignedAgentRef`), schedule the Owner participant in the Owner lane with `source='owner-manifest'`, and ensure unassigned/inconsistent states are handled gracefully.

## Target users / ICP roles
- Kanban users creating or refreshing Epic tickets
- Agents and owners relying on accurate manifest roles for task assignment and visibility

## Scope
- Modify `api/src/application/kanban/ticketParticipants.ts`
- Add test suite `qat-test/owner-auto-resolve.spec.ts`
- Implement FR-1 through FR-5 and FR-7 from PRD #792

## Functional requirements
- FR-1: `deriveManifest` reads `assignedUserId` first, falls back to `assignedAgentRef`
- FR-2: Creates Owner participant entry when assignment present
- FR-3: Schedules manifest entry in Owner lane with `source='owner-manifest'`
- FR-4: Handles null/unassigned cases by omitting Owner
- FR-5: Reconciles inconsistent fields without throwing
- FR-7: Owner manifest updates on both create and refresh flows

## Acceptance criteria
- Owner role appears in manifest exactly when `assignedUserId` or `assignedAgentRef` is set on the Epic
- `source` field equals `'owner-manifest'` for the generated Owner participant
- All new unit tests in `owner-auto-resolve.spec.ts` pass
- Existing manifest behavior for non-Epic tickets remains unchanged
- No duplicate Owner entries created

## Out of scope
- UI changes or lane rendering updates
- Other participant roles (Assignee, Reviewer, etc.)
- Migration of historical data
- Performance benchmarking or caching

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