> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1634
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current implementation of participant slot uniqueness in the kanban ticket system allows duplicate entries when `stage_key` is `NULL`. This is because, in PostgreSQL, `NULL` values are not considered equal, and thus, the `ON CONFLICT` clause does not trigger to prevent duplicate entries. This issue undermines the reliability of participant management, particularly affecting functionalities like removing duplicates and verifying their removal.

### Goal
Ensure that duplicate participant slots cannot be created, even when `stage_key` is `NULL`, by enforcing strict uniqueness constraints and providing a robust solution that prevents silent regressions.

## Target Users / ICP Roles
- **Kanban System Administrators**: Responsible for managing and maintaining the integrity of the kanban system.
- **Developers**: Implementing and testing the participant management features.
- **Quality Assurance (QA) Engineers**: Ensuring the system meets the specified requirements and behaves as expected.

## Scope

### In-Scope
- Modify the unique index to handle `NULL` values appropriately.
- Implement a regression test to verify that duplicate participants with `NULL` `stage_key` cannot be created.
- Update the `deriveManifest` and `addParticipant` functions to adhere to the new uniqueness constraints.
- Document the changes and update related functionalities impacted by this change.

### Out-of-Scope
- Changing the overall database schema beyond the necessary index modifications.
- Altering the behavior of other parts of the system unrelated to participant slot management.
- Addressing other issues not directly related to the uniqueness constraint of participant slots.

## Functional Requirements

1. **Unique Index Modification**
   - Modify the unique index on the participation-manifest slot to treat `NULL` values as non-distinct using the `NULLS NOT DISTINCT` clause (available in PostgreSQL 15+).
   - Alternatively, implement an expression index using `COALESCE(stage_key, '')` to ensure that `NULL` values are treated as equivalent.

2. **Regression Test Implementation**
   - Create a regression test that attempts to add a participant with `stageKey: null` twice.
   - Assert that only one participant row is created, ensuring that the duplicate is not inserted.

3. **Function Updates**
   - Update the `deriveManifest` and `addParticipant` functions to respect the new uniqueness constraints.
   - Ensure that these functions handle `NULL` values in `stage_key` appropriately to prevent duplicate entries.

4. **Documentation**
   - Update the system documentation to reflect the changes in the uniqueness constraints and the handling of `NULL` values.
   - Provide clear guidelines for developers and administrators on how to manage participant slots moving forward.

## Acceptance Criteria

- The unique index on the participation-manifest slot correctly handles `NULL` values, preventing duplicate entries.
- The regression test passes, confirming that adding a participant with `stageKey: null` twice results in only one row.
- The `deriveManifest` and `addParticipant` functions operate without allowing duplicate participant slots, even when `stage_key` is `NULL`.
- The system documentation is updated to include the changes in the uniqueness constraints and the handling of `NULL` values.
- No regressions are introduced in other parts of the system as a result of these changes.

## Out of Scope

- Modifying the database schema beyond the necessary index changes.
- Altering the behavior of other participant management functionalities not related to slot uniqueness.
- Addressing issues related to participant removal that are dependent on `source` filtering (as per F-1).
- Enhancing the `removeParticipant` function to return an affected-row count or handle different `source` values (as per F-2).

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