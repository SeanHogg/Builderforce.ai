> **PRD** — drafted by Ada (Sr. Product Mgr) · task #512
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: FR1 - Unassigned High-Priority Task Identification API

## Problem & Goal

**Problem:** Project managers and team leads need a quick, efficient way to identify critical tasks that have not yet been assigned to anyone. Delays in assigning high-priority work can lead to missed deadlines and overall project slowdowns.

**Goal:** To provide a robust and performant API endpoint that allows clients (e.g., dashboards, reporting tools) to retrieve a filtered list of unassigned, high-priority tasks. This enables proactive task management, improved resource allocation, and ensures critical work is prioritized.

## Target Users / ICP Roles

*   **Developers/Engineers:** Building front-end dashboards, internal tools, or integrations that consume task data.
*   **Project Managers:** Utilizing dashboards to identify and assign critical unassigned tasks.
*   **Team Leads:** Monitoring team workload and ensuring high-priority items are addressed.

## Scope

This PRD covers the development and deployment of a new read-only API endpoint responsible for identifying and listing unassigned high-priority tasks. It includes the definition of filtering, sorting, pagination, and caching mechanisms for this specific data set. The mock API implementation is complete and serves as the reference.

## Functional Requirements

*   **FR1.1: Endpoint Availability:** A new `GET` endpoint `/api/tasks/unassigned-high-priority` must be available.
*   **FR1.2: Priority Filtering:** The endpoint must return tasks with a `priority` level of `high` or `critical`.
*   **FR1.3: Assignment Filtering:** The endpoint must only return tasks where `assignedUserId` is `NULL`.
*   **FR1.4: Status Exclusion:** The endpoint must exclude tasks that are `archived` or marked as `done`/`completed`.
*   **FR1.5: Pagination Support:** The endpoint must support standard pagination parameters (e.g., `page`, `pageSize`).
*   **FR1.6: Project Filtering:** The endpoint must support filtering tasks by `projectId`.
*   **FR1.7: Sorting Options:** The endpoint must support sorting by `dueDate`, `title`, and `createdAt`.
*   **FR1.8: Caching Recommendation:** The API response must include `cacheInfo.validForSeconds` to inform clients about recommended caching duration.

## Acceptance Criteria

*   **AC1:** The `GET /api/tasks/unassigned-high-priority` endpoint successfully returns a list of tasks.
*   **AC2:** All tasks returned by the endpoint have a `priority` of either 'high' or 'critical'.
*   **AC3:** All tasks returned by the endpoint have `assignedUserId` set to `NULL`.
*   **AC4:** No `archived` or `done`/`completed` tasks are present in the returned list.
*   **AC5:** The endpoint correctly applies pagination based on provided `page` and `pageSize` parameters.
*   **AC6:** The endpoint accurately filters tasks when a `projectId` parameter is supplied.
*   **AC7:** The endpoint correctly sorts the returned tasks based on `dueDate`, `title`, or `createdAt` as specified.
*   **AC8:** The API response includes `cacheInfo.validForSeconds` with a value of at least 1800 (30 minutes), enabling clients to comfortably cache responses for this duration.
*   **AC9:** The mock API implementation at `Builderforce.ai/mock-api/tasks/unassigned-high-priority.ts` fully demonstrates all specified functional requirements and adheres to the given criteria.

## Out of Scope

*   User Interface (UI) development for consuming this API endpoint.
*   Real-time push notifications for newly unassigned high-priority tasks.
*   API for modifying task assignment or priority.
*   Detailed error handling specifications (assumed to follow existing API standards).
*   Authentication and Authorization (assumed to be handled by existing API gateway/middleware).