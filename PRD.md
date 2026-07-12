> **PRD** — drafted by Ada (Sr. Product Mgr) · task #482
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Agent Velocity Calibration

## Problem & Goal

**Problem:**
Current capacity estimates rely on approximate story-point sizing and an assumed SP/week throughput (0.4h/SP factor). This initial approximation was necessary due to limited empirical velocity data and an inaccessible assignee roster API (401 error). Consequently, project timeline ranges are broad and lack precision.

**Goal:**
To significantly improve the accuracy of project timeline ranges and resource allocation by calibrating agent velocity using empirical task completion data. This involves gathering actual velocity per agent, re-running capacity analysis, and mapping assignments against a live roster, with a view to establishing a recurring refresh cadence.

## Target Users / ICP Roles

*   **Project Managers:** Require accurate timelines and resource projections for planning and stakeholder communication.
*   **Resource Planners:** Need precise capacity data for strategic resource allocation and forecasting.
*   **Team Leads:** Benefit from a clearer understanding of team and individual throughput for performance management and task distribution.

## Scope

This initiative encompasses the following activities:

1.  **Empirical Data Collection:** Gather actual task completion velocity data (e.g., story points completed, actual hours spent) per agent over 1-2 recent sprints.
2.  **Assignee Roster Resolution & Mapping:** Resolve the `assignees` endpoint API access issue (401 error) and re-map all historical and current per-agent task assignments against the live roster.
3.  **Velocity Recalculation:** Re-run the existing capacity analysis using the newly collected empirical velocity data.
4.  **Capacity Estimate Update:** Update overall capacity estimates and refine project timeline projections based on the recalibrated velocity.
5.  **Cadence Establishment:** Define and implement a recurring process for refreshing agent velocity calibrations, recommended at a per-sprint (bi-weekly) cadence.

## Functional Requirements

*   **FR1: Data Extraction:** The system must be able to extract task completion data (e.g., story points, actual effort in hours, completion dates) for individual agents from the project management system.
*   **FR2: Assignee API Access:** The system must successfully connect to and retrieve data from the assignee roster API without encountering authentication errors (resolve 401).
*   **FR3: Velocity Calculation:** The system must calculate individual agent velocity (e.g., average SP/week or average hours/week) based on empirical completion data.
*   **FR4: Roster Mapping:** The system must accurately map completed tasks and current assignments to the live agent roster.
*   **FR5: Model Integration:** The system must integrate the calculated empirical velocities into the existing resource estimation model (referenced in task #144, `specs/builderforce/15-resource-estimation.md`).
*   **FR6: Report Generation:** The system must generate updated capacity analysis and timeline projection reports reflecting the new velocity data.
*   **FR7: Refresh Mechanism:** The system must support a mechanism (manual or automated) to trigger the velocity recalibration and reporting process every two weeks.

## Acceptance Criteria

*   **AC1: Empirical Velocity Application:** The resource estimation model (`specs/builderforce/15-resource-estimation.md`) successfully incorporates empirical agent velocity data, replacing or refining the initial 0.4h/SP factor.
*   **AC2: Assignee Roster Resolution:** The `assignees` endpoint API can be accessed successfully, and all agent assignments are correctly mapped to the live roster.
*   **AC3: Timeline Tightening:** The updated timeline projection ranges demonstrate a measurable reduction in variance compared to the initial estimates.
*   **AC4: Cadence Implementation:** A documented process is established and followed for conducting bi-weekly agent velocity recalibration and capacity estimate refreshes.
*   **AC5: Reporting Accuracy:** Generated reports accurately reflect the updated empirical velocities and refined timeline projections for all relevant projects and agents.

## Out of Scope

*   Redevelopment or fundamental changes to the core logic of the resource estimation model beyond integrating empirical velocity data.
*   Development of new user interfaces (UIs) specifically for tracking individual agent velocity (unless deemed critical for the initial data collection and validation phase).
*   Automated decision-making regarding resource allocation or project scope changes based solely on velocity fluctuations.
*   Forecasting future changes in agent capacity due to external factors (e.g., hiring, departures, training).