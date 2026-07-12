> **PRD** — drafted by Ada (Sr. Product Mgr) · task #480
> _Each agent that updates this PRD signs its change below._

# WIP Product Requirements: Capacity Estimate Calibration

## 1. Problem & Goal

### 1.1 Problem
Current capacity estimates rely on approximate story point (SP) estimates and an assumed 0.4h/SP utilization factor, not empirical agent velocity. Furthermore, per-agent utilization mapping is currently ±15% inaccurate due to an inaccessible live assignee roster (assignee API returned 401). This leads to imprecise time-to-completion projections and unreliable Scenario A/B deltas, hindering accurate resource planning. The 50 validation gaps are currently estimated within a broad 34-59 SP midpoint range.

### 1.2 Goal
To calibrate capacity estimates with empirical agent velocity and actual utilization data after 1-2 sprints of real throughput. This will improve the accuracy of time-to-completion projections, refine Scenario A/B deltas, and support a reliable per-sprint refresh cadence for resource planning.

## 2. Target Users / ICP Roles
*   Project Managers
*   Engineering Leads
*   Product Owners
*   Resource Planners

## 3. Scope
This initiative will focus on collecting and integrating empirical data to update and refine our capacity models. Specifically, it includes:
*   Collecting actual story points completed per agent per sprint.
*   Replacing assumed velocity ranges with empirically derived velocity for each agent.
*   Re-mapping per-agent utilization using the live assignee roster API.
*   Refreshing the overall time-to-completion projection.
*   Refreshing the Scenario A/B deltas based on updated projections.
*   Performing per-gap micro-estimation for the 50 validation gaps to tighten the standalone gap effort total.

## 4. Functional Requirements

*   **FR1: Velocity Data Collection:** The system shall collect and store actual Story Points (SP) completed per agent per sprint for the preceding 1-2 sprints.
*   **FR2: Empirical Velocity Calculation:** The system shall calculate the empirical velocity (SP/sprint) for each agent based on the collected data.
*   **FR3: Velocity Profile Update:** The system shall update the agent velocity profiles, replacing the approximated 0.4h/SP factor and assumed ranges with empirical velocity data.
*   **FR4: Live Roster Access:** The system shall successfully access the live assignee roster via the designated API.
*   **FR5: Utilization Remapping:** The system shall recalculate and re-map per-agent utilization based on the live assignee roster.
*   **FR6: Time-to-Completion Refresh:** The system shall refresh the overall time-to-completion projection using the updated velocity and utilization data.
*   **FR7: Scenario Delta Refresh:** The system shall refresh the Scenario A/B deltas to reflect the newly calculated time-to-completion projection.
*   **FR8: Validation Gap Micro-estimation:** The system shall provide a mechanism for granular micro-estimation of each of the 50 validation gaps.
*   **FR9: Gap Effort Total Update:** The system shall update the standalone gap effort total based on the sum of the new micro-estimations for the 50 validation gaps.

## 5. Acceptance Criteria

*   **AC1: Velocity Data Recorded:** Actual SP completed for each agent for the last 1-2 sprints are accurately collected and recorded.
*   **AC2: Empirical Velocity Calculated:** Each agent with sufficient historical data (at least 1 completed sprint) has an empirically derived velocity (SP/sprint) calculated.
*   **AC3: Velocity Profiles Updated:** The system's velocity ranges and utilization factors for agents are updated to reflect the empirical velocities, replacing the fixed 0.4h/SP approximation.
*   **AC4: API Access Confirmed:** The assignee API call successfully returns a `200 OK` response with the current assignee roster data.
*   **AC5: Utilization Mapped Accurately:** Per-agent utilization is re-mapped using the live roster, demonstrating an accuracy within ±5% of actual observed utilization.
*   **AC6: Projection Updated:** The overall time-to-completion projection is recalculated and displayed, reflecting the new velocities and utilization.
*   **AC7: Scenario Deltas Refreshed:** Scenario A/B deltas are updated and align with the refreshed time-to-completion projections.
*   **AC8: Gaps Micro-estimated:** Each of the 50 validation gaps has a specific, refined SP estimate (e.g., instead of a range, a single SP value or tighter range).
*   **AC9: Gap Total Correct:** The total effort for validation gaps is calculated as the sum of the refined micro-estimations for the 50 gaps.

## 6. Out of Scope

*   Implementation of new features for automated resource allocation or dynamic scheduling.
*   Changes to the underlying story point estimation methodology or definition.
*   In-depth analysis of *why* velocity differs from initial estimates (focus is on *what* the empirical velocity is).
*   Automated real-time velocity recalibration (this task focuses on a batch/manual refresh after 1-2 sprints).
*   Addressing the root cause of the `assignee API returned 401` error beyond ensuring successful access for this specific data collection.