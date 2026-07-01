> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #210
> _Each agent that updates this PRD signs its change below._

# WIP Product Requirements Document: Team Capacity Analysis

## Problem & Goal

**Problem:** The team lacks a clear, quantifiable understanding of its current capacity, making effective workload distribution, project estimation, and resource allocation difficult. This can lead to burnout, missed deadlines, and inefficient use of resources.

**Goal:** To establish a baseline and a repeatable process for analyzing and understanding the team's available capacity, enabling more accurate planning and resource management.

## Target Users / ICP Roles

*   **Team Lead / Manager:** Responsible for assigning tasks, managing project timelines, and ensuring team well-being.
*   **Project Manager:** Needs to understand team velocity and capacity for realistic project planning and stakeholder communication.
*   **Individual Contributors (Human & Cloud Agents):** Need to understand their own capacity to manage their workload and report progress.

## Scope

This document defines the initial requirements for analyzing the capacity of the current team, which includes one human resource (seanhogg@gmail.com) and four cloud-based agents (named Kevin, Mike, Bob, and John, with defined roles of BA/PM, QA, Developer, and Coder, respectively). The analysis will focus on identifying available working time and potential constraints.

## Functional Requirements

1.  **Identify Available Working Hours:**
    *   The system shall allow for the definition of standard working hours for each team member (human and agent).
    *   The system shall allow for the input and consideration of non-working time (e.g., holidays, planned breaks, scheduled maintenance for agents).
2.  **Define Task Granularity & Effort Estimation:**
    *   The system shall support defining a unit of work (e.g., story points, hours) for tasks.
    *   The system shall provide a mechanism for estimating the effort required for individual tasks.
3.  **Track Resource Allocation:**
    *   The system shall track the allocation of team members to specific projects or tasks.
    *   The system shall prevent over-allocation of resources.
4.  **Calculate Available Capacity:**
    *   The system shall calculate the aggregate available capacity of the team for a given period based on working hours and non-working time.
    *   The system shall calculate the capacity remaining after accounting for allocated tasks.
5.  **Reporting:**
    *   The system shall generate a summary report of current team capacity.
    *   The report shall include total available capacity, allocated capacity, and remaining capacity.
    *   The report shall be filterable by individual team member and by project.

## Acceptance Criteria

*   **AC1:** For a given week, the system accurately calculates the total available working hours for seanhogg@gmail.com, Kevin, Mike, Bob, and John, considering predefined standard working hours and any explicitly marked non-working periods.
*   **AC2:** A task estimated at 8 hours can be assigned to Bob the Developer, and the system reflects that 8 hours of his capacity for the relevant period are now allocated.
*   **AC3:** If a task is estimated at 10 hours and Bob the Developer only has 8 hours of available capacity remaining for the week, the system flags this as an over-allocation or prevents the assignment.
*   **AC4:** A generated capacity report for the current week shows:
    *   Total available hours for the team.
    *   Total hours allocated to ongoing tasks.
    *   Net remaining hours for the team.
    *   Breakdown of available and allocated hours per team member.
*   **AC5:** The system can correctly identify that cloud agents (Kevin, Mike, Bob, John) have 24/7 availability by default unless specific maintenance or downtime is declared.

## Out of Scope

*   **Performance Monitoring of Cloud Agents:** This PRD does not cover the monitoring of the *performance* or *efficiency* of the cloud agents (e.g., processing speed, network latency). The focus is solely on their availability as a resource.
*   **Automated Task Assignment:** The system will not automatically assign tasks to team members. The focus is on understanding capacity, not on orchestrating task distribution.
*   **Skill-Based Capacity Analysis:** This initial analysis does not differentiate capacity based on specific skill sets. All hours are treated as interchangeable within the defined roles initially.
*   **Real-time Availability Changes:** The system will not dynamically adjust capacity based on real-time, unannounced events (e.g., an agent crashing unexpectedly). Capacity updates will rely on explicit input.
*   **Integration with external project management tools:** This initial phase focuses on internal capacity calculation and reporting.