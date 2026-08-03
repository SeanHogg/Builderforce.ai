> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1534
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Enable Auto-Staffing on Project 11’s Unconfigured Lanes

## Problem & Goal  
In Project 11, 193 tickets are stalled with the status `lane_unconfigured` because their board lanes have no required role and no staffed agent. The autonomous manager cannot assign these runs to any participant, breaking throughput. The manager's policy currently has `allowAutoStaffLanes` set to `false`, preventing self-healing by pinning available agents to empty lanes.

**Goal:** Change Project 11’s manager policy to `allowAutoStaffLanes: true` so the platform’s autonomy can automatically assign available agents to those lanes, directly unblocking the largest cohort of stalled tickets in the project.

## Target Users / ICP Roles  
- **Project administrators** (who own and approve manager policy changes).  
- **Autonomous platform** (the self-healing manager that executes auto-staffing).  
- **Operations teams** monitoring stalled ticket remediation.

## Scope  
**In scope**  
- Configuration change to Project 11’s manager policy: set `allowAutoStaffLanes` from `false` to `true`.  
- Validation that the change is correctly reflected and the manager attempts to staff lanes on the next autonomy cycle.  

**Out of scope**  
- Modifications to the auto-staffing algorithm or assignment logic.  
- Changes to any other project or global platform defaults.  
- Manual correction of board lane configurations or role declarations.  
- Front‑end UI adjustments for this setting.  
- Handling other stalled-ticket causes beyond `lane_unconfigured`.

## Functional Requirements  
1. **Policy Update** – The authoritative manager configuration for Project 11 must be updated with `allowAutoStaffLanes: true`.  
2. **Persistence** – The updated value must survive restarts, redeployments, and configuration syncs.  
3. **Manager Behaviour** – On its next evaluation cycle after the change, the manager shall detect unconfigured lanes for the stalled tickets and automatically assign suitable agents from the available pool, turning the tickets from `lane_unconfigured` to an active state.  
4. **No Regressions** – Existing lane assignments, agent availability, and other project behaviours remain unchanged.  

## Acceptance Criteria  
- The configuration record for Project 11’s manager shows `allowAutoStaffLanes: true` after deployment.  
- Within one manager cycle (≤ 15 minutes) after the change, the number of `lane_unconfigured` stalled tickets in Project 11 begins to decline.  
- All 193 previously stalled tickets are either assigned to an agent or transitioned to a resolvable state without manual intervention.  
- No new errors or warnings appear in manager logs related to this change.  

## Out of Scope  
- Adjusting the criteria for which agents are considered “available”.  
- Globally enabling `allowAutoStaffLanes` for all projects.  
- Reporting/dashboard improvements for stalled ticket trends.  
- Backfilling historical lane configurations.

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