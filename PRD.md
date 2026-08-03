> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1536
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Consolidate Duplicate Boards – Project 11

## Problem & Goal
**Problem:** Autonomy wiring audit uncovered duplicate boards on 3 projects. Project 11 has the worst case with multiple boards (historically up to 7). Non-canonical boards cause lane gates and agent staffing to be silently ignored, leading to configuration dead‑ends and unreliable automation behavior.

**Goal:** Remediate Project 11 so it has exactly one canonical board, with all lane gates and staffing configurations correctly applied and operational on that board.

## Target Users / ICP Roles
* Platform engineers responsible for board configuration hygiene  
* Project leads who rely on board-defined automation gates and staffing  
* Automation administrators troubleshooting dead‑end configurations

## Scope
This initiative is scoped to **Project 11 only** as the immediate remediation target. It covers:
* Full audit of all boards belonging to Project 11
* Identification of the canonical board
* Merging or retiring all duplicate boards
* Verification that lane gates and staffing are present and active on the final canonical board
* Updating any internal references (e.g., automation pointers) to the canonical board

## Functional Requirements
1. **Board Audit**  
   - Enumerate all boards currently associated with Project 11.  
   - Record board metadata: ID, name, lane count, gate definitions, staffing assignments, activity status.

2. **Canonical Selection**  
   - Define criteria for canonical board (e.g., most lanes, most recent activity, or designated as primary in source of truth).  
   - Surface a recommended canonical board for operator approval.

3. **Data Merging (if required)**  
   - Compare gate definitions and staffing assignments across duplicates.  
   - Add any missing gates or staffing to the canonical board before retiring duplicates.  
   - Handle conflicts deterministically (prefer values from the canonical board; log overrides).

4. **Retirement of Duplicates**  
   - Mark duplicate boards as retired (do not physically delete if history is needed) so they are no longer active.  
   - Ensure no automation silently routes to retired boards.

5. **Reference Update**  
   - Identify any automation rules, triggers, or integrations pointing to duplicate boards.  
   - Re-point them to the canonical board.

6. **Verification**  
   - Confirm all lane gates evaluate correctly on the canonical board.  
   - Confirm agent staffing is assigned and applies to lanes.  
   - Run a dry-run validation of typical workflows to prove no dead‑end paths.

## Acceptance Criteria
- Project 11 contains **exactly one active board** (duplicates retired).  
- The active board holds **all intended lane gates** (none missing from retired boards).  
- **Staffing assignments** are fully present and functional on the canonical board.  
- No automation component references a retired board.  
- A post‑consolidation audit confirms zero silent gate/staffing drops.  
- Board operations (lane transitions, gate evaluations) behave identically to the intended pre‑audit state, minus dead‑ends.

## Out of Scope
- Remediation of other projects with duplicate boards (handled in follow‑up tasks).  
- Changes to the board engine, gate evaluation logic, or staffing subsystem.  
- UI enhancements or new board management features.  
- Historical data migration beyond what is necessary to avoid configuration loss.  
- Broader platform governance or naming conventions for boards.

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