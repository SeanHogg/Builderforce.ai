> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #187
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Project Health Score & Trend

## 1. Problem & Goal

**Problem:** Project managers and stakeholders often struggle to quickly assess the overall health of a project, leading to delayed recognition of issues and reactive management. Without a consolidated metric, understanding project status requires manual aggregation of various data points, consuming valuable time and increasing risk.

**Goal:** To provide a clear, composite "Project Health Score" (0-100) and its recent trend directly on the project overview, enabling users to instantly grasp project status and proactively address potential issues.

## 2. Target Users / ICP Roles

*   **Project Managers:** To monitor their projects at a glance and identify areas needing attention.
*   **Team Leads:** To understand the health of projects they are contributing to.
*   **Stakeholders / Executives:** To get a high-level overview of project portfolio health without drilling into details.

## 3. Scope

This feature will introduce a Project Health Score (0-100) and a trend indicator (up/down/stable) to the project overview dashboard. The score will be calculated based on predefined project metrics.

## 4. Functional Requirements

*   **FR1: Health Score Calculation:** The system shall calculate a composite "Project Health Score" ranging from 0 to 100.
    *   **FR1.1: Inputs:** The score calculation shall incorporate weighted inputs from key project dimensions (e.g., Schedule Adherence, Budget Utilization, Task Completion, Risk Exposure, Bug Count, Stakeholder Satisfaction, etc.).
    *   **FR1.2: Daily Update:** The score shall be recalculated and updated daily for each active project.
*   **FR2: Display Current Score:** The current Project Health Score (0-100) shall be prominently displayed on the project overview dashboard.
    *   **FR2.1: Visual Encoding:** The score display shall use color coding (e.g., 75-100 Green, 50-74 Yellow, 0-49 Red) to indicate overall health.
*   **FR3: Display Trend Indicator:** A visual trend indicator shall be displayed alongside the health score, showing its change relative to the previous day/period.
    *   **FR3.1: Trend Types:** Indicators shall represent "Up" (score increased), "Down" (score decreased), or "Stable" (score remained constant or within a negligible delta).
    *   **FR3.2: Visual Encoding:** Use standard arrow icons (▲ for up, ▼ for down, — for stable).
*   **FR4: Historical Data Storage:** The system shall store daily health scores for each project to enable trend analysis.
*   **FR5: Score Tooltip (MVP):** On hover over the health score, a basic tooltip shall display the last 7 days' scores to provide context for the trend.

## 5. Acceptance Criteria

*   The Project Health Score (0-100) is displayed accurately on the project overview dashboard for all active projects.
*   The score updates daily, reflecting changes in underlying project metrics.
*   The trend indicator (up/down/stable arrow) correctly reflects the change in score compared to the previous day.
*   The color coding of the score (Green/Yellow/Red) aligns with the defined thresholds.
*   Hovering over the score reveals the last 7 days' scores in a tooltip.
*   No noticeable performance degradation is observed on the project overview dashboard due to this feature.

## 6. Out of Scope

*   User-customizable health score formulas or weighting of inputs per project.
*   Detailed historical charts or graphs beyond the simple trend indicator and 7-day tooltip.
*   Alerting or notifications based on health score changes (e.g., email alerts if score drops below a threshold).
*   Deep-dive analytics or drill-down capabilities into the specific components contributing to the health score (e.g., clicking the score to see budget vs. schedule impact).
*   Integration with external project management tools for health score calculation inputs.