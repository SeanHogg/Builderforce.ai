> **PRD** — drafted by Ada (Sr. Product Mgr) · task #508
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Reporting Dashboard and Weekly Digest

## 1. Problem & Goal

### 1.1 Problem
Stakeholders lack a centralized, real-time (within an acceptable refresh window) view of critical project alignment metrics, leading to potential delays in decision-making, missed escalations, and inconsistent communication regarding project status and required actions.

### 1.2 Goal
To provide stakeholders with a concise, actionable, and easily accessible reporting dashboard displaying key project alignment metrics, supplemented by a lightweight, auto-generated weekly digest that delivers essential updates and urgent action items directly to relevant parties, fostering alignment and enabling timely interventions.

## 2. Target Users / ICP Roles
*   **Required Approvers:** Individuals with explicit sign-off responsibilities.
*   **Informed Parties:** Stakeholders who need to stay updated on project progress and potential roadblocks.
*   **Project Managers/Leads:** Who monitor project health and require alignment visibility.

## 3. Scope
This PRD covers the development and integration of a Reporting Dashboard and an app-level Weekly Digest system. The dashboard will provide a comprehensive, filterable summary of project priorities, sign-offs, conflicts, and escalations. The digest will deliver a curated, lightweight summary of critical items directly to stakeholders. Both components will leverage existing notification/corpus infrastructure where possible, with necessary augmentations.

## 4. Functional Requirements

### 4.1 Reporting Dashboard
*   **FR1.1: Summary View:** The dashboard must display a summary view of the following key metrics:
    *   Total approved priorities.
    *   Count of open, pending, and overdue sign-offs.
    *   Count of active conflicts.
    *   Count of overdue escalations.
*   **FR1.2: Data Filtering:** The dashboard data must be filterable by:
    *   Project
    *   Time period (e.g., last 7 days, last 30 days, custom range)
    *   Stakeholder
*   **FR1.3: Data Caching:** Dashboard metrics must be cached for approximately 60 seconds to optimize performance.
*   **FR1.4: Digest Access:** The dashboard panel must provide direct access to weekly digest consumption and allow for manual reloading of digest content.

### 4.2 Weekly Digest
*   **FR2.1: Auto-Generation:** An app-level worker must auto-generate the weekly digest daily.
*   **FR2.2: Content Requirements:** Each digest must be lightweight (approx. 600 characters) and include:
    *   Top 2 most active conflicts/overdue items.
    *   A count summary of relevant metrics (e.g., total open sign-offs, pending escalations).
    *   A list of urgent/pending action items.
*   **FR2.3: Distribution:** Digests must be distributed to all "Required Approvers" and "Informed Parties" via configured channels (e.g., email, Slack).

### 4.3 Backend & Infrastructure
*   **FR3.1: Dashboard API:** Develop API endpoints for:
    *   Priority metrics query templates.
    *   Filter queries for project, time period, and stakeholder.
*   **FR3.2: DTO Aggregation:** Implement logic for Dashboard Data Transfer Objects (DTOs) aggregated by project and time period.
*   **FR3.3: Metrics Query Logic:** Implement summary query logic for sign-offs, conflicts, and escalations.
*   **FR3.4: Digest Configuration:** Implement configuration for weekly digest generation, including:
    *   Digest window definition.
    *   Templates for digest content.
    *   Distribution list management.
*   **FR3.5: Digest Worker:** Implement a daily cron-based weekly digest worker.
*   **FR3.6: Digest Scheduler:** Implement a scheduler for the weekly digest worker.
*   **FR3.7: Digest Storage & Paging:** Provide storage and paging capabilities for generated digests.

### 4.4 Frontend
*   **FR4.1: UI Component:** Integrate a dashboard panel component within the existing "Stakeholder Alignment" facet.

## 5. Acceptance Criteria
*   **AC1: Dashboard Accuracy:** All summary metrics displayed on the dashboard accurately reflect the underlying data.
*   **AC2: Dashboard Performance:** The dashboard loads and displays initial data within 3 seconds for an average user load.
*   **AC3: Filter Functionality:** All specified filters (project, time period, stakeholder) correctly apply and update the dashboard data without errors.
*   **AC4: Cache Effectiveness:** Dashboard metrics are visibly cached for approximately 60 seconds, reducing load times on subsequent requests within the cache window.
*   **AC5: Digest Generation:** The weekly digest worker successfully generates a new digest daily.
*   **AC6: Digest Content:** Each generated digest adheres to the ~600 character limit and correctly includes the top 2 active conflicts/overdue items, a count summary, and a list of urgent/pending action items.
*   **AC7: Digest Distribution:** Digests are successfully distributed to all intended "Required Approvers" and "Informed Parties" via configured channels.
*   **AC8: UI Integration:** The dashboard panel component is seamlessly integrated into the "Stakeholder Alignment" facet and provides working links to digest consumption and reload functionality.
*   **AC9: Infrastructure Leverage:** Existing notification/corpus infrastructure is correctly identified and augmented where necessary, without unnecessary duplication.

## 6. Out of Scope
*   Real-time streaming updates for dashboard metrics (the 60-second cache is the specified refresh mechanism).
*   Personalized or customizable digest content for individual users beyond the defined distribution lists.
*   Advanced analytics or deep-dive reporting capabilities beyond the specified summary views and filters.
*   The creation of entirely new notification or corpus infrastructure if existing systems can be augmented.