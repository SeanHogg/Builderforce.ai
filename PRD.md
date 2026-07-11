> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #157
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Diagnostic Report

## Problem & Goal

**Problem:** Project Managers and Leaders lack a consolidated, real-time view of project health, making it difficult to quickly identify risks, track trends, and understand the overall state of a project. This leads to reactive decision-making and potential project failures.

**Goal:** To enable PMs and Leaders to quickly understand a project's health and potential risks by providing a comprehensive, structured diagnostic report, generated through user input and ingested data, thereby facilitating proactive management and better project outcomes.

## Target users / ICP roles

*   **Project Managers (PMs):** Need a holistic view to manage their projects effectively.
*   **Team Leaders:** Require insights into team performance and project bottlenecks.
*   **Portfolio Managers / Senior Leadership:** Need high-level health snapshots across multiple projects to make strategic decisions.

## Scope

This feature encompasses the generation of a comprehensive diagnostic report, integrating user-provided answers and ingested project data. It includes the structured presentation of project health across predefined categories, visualization of trends and anomalies, highlighting of top risks, and identification of overdue items. The report will be accessible via a shareable link and exportable in PDF format, incorporating appropriate data visualizations.

## Functional Requirements

*   The system shall provide an interface for users to answer diagnostic questions related to project health.
*   The system shall ingest relevant project data from integrated sources (e.g., task trackers, bug databases, budget systems).
*   The system shall generate a structured diagnostic report based on user answers and ingested data.
*   The system shall categorize the report into predefined sections: Timeline, Budget, Quality, Risk, Team, and Alignment.
*   For each section, the system shall determine and display the "current state" (Red/Yellow/Green).
*   For each section, the system shall determine and display the "trend" (Improving/Worsening/Stable).
*   For each section, the system shall identify and display "anomalies" or significant deviations.
*   For each section, the system shall display "supporting data" (ingested or manually entered).
*   The system shall identify and prominently highlight the "top 3 risks" based on severity and likelihood scores.
*   The system shall calculate and display a composite "Project Health Score" (0-100) and its historical trend.
*   The system shall include a dedicated "What's Overdue?" section, listing tasks, bugs, or deadlines that are past their due dates.
*   The system shall allow users to export the generated report as a PDF document.
*   The system shall generate a shareable link for the diagnostic report, allowing read-only access.
*   The system shall utilize appropriate data visualizations (e.g., charts, tables, trend lines) to clearly present information within the report.

## Acceptance Criteria

*   Generate a structured report with sections mirroring the diagnostic categories: Timeline, Budget, Quality, Risk, Team, Alignment
*   Each section shows: current state (red/yellow/green), trend (improving/worsening/stable), anomalies, and supporting data (ingested or manual)
*   Highlight the top 3 risks (severity + likelihood)
*   Show a composite "Project Health Score" (0–100) and trend
*   Include a "What's Overdue?" section listing tasks, bugs, or deadlines past due
*   Allow exporting the report as PDF or sharing as a link

## Out of scope

*   Real-time continuous monitoring or alerting beyond the generation of the snapshot report.
*   Automated generation of prescriptive recommendations or action items (the report provides insights, not solutions).
*   Custom report template creation or extensive customization options for report structure.
*   Direct task assignment or project management capabilities within the report view.
*   Integration with all possible third-party project management tools beyond initial defined set.
*   Predictive analytics for future project states beyond current trends.