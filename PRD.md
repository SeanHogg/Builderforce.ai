> **PRD** — drafted by Ada (Sr. Product Mgr) · task #551
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: RAG Status Enforcement & Timestamp Feature

## Problem & Goal
**Problem:** The current dashboard/report artifact does not apply the RAG (Red/Amber/Green) status rules defined in FR-3, lacks a `Generated on` timestamp, and fails to present a scannable view within 30 seconds. Consequently, acceptance criteria AC-8, AC-9, and AC-10 cannot be verified, and there is no evidence that the product meets its fundamental compliance requirements.

**Goal:** Implement the missing RAG rule engine, timestamp, and scannability improvements so that the artifact consistently reflects project health according to FR-3 and demonstrably satisfies AC-8, AC-9, and AC-10.

## Target Users / ICP Roles
- **Project Managers** – need at-a-glance status for reporting and governance.
- **Delivery Leads / Scrum Masters** – rely on accurate health indicators to triage blockers.
- **Product Owners** – require a trustworthy snapshot of progress.
- **Stakeholders (e.g., VPs, Directors)** – use the view for rapid oversight during stand-ups or reviews.

## Scope
- Implement automatic RAG status calculation per FR-3 rules (Green, Amber, Red).
- Display a “Generated on” timestamp that reflects the last computation time.
- Ensure consistent application of RAG rules across all displayed projects/views.
- Optimize the UI layout so that a user can determine the RAG status for any given project within 30 seconds (scannability).
- Validate the feature against AC-8, AC-9, and AC-10 through automated checks and usability testing.

## Functional Requirements

1. **RAG Status Engine**  
   The system must calculate the RAG status for each project/unit using the following deterministic rules (derived from FR-3):
   - **Green:**  
     - Percentage of active work > 50% **AND**  
     - No active failures (build failures, blocked tasks, or critical incidents).
   - **Amber:**  
     - Any active task has a blocker (dependency or impediment) **OR**  
     - The project is in an “on-hold” state but a documented recovery plan exists **OR**  
     - Percentage of active work is between 25% and 50% (inclusive).
   - **Red:**  
     - Build is currently broken **OR**  
     - Percentage of active work is 0% (no work being done) **OR**  
     - The team is empty (no members) **OR**  
     - No DRI (Directly Responsible Individual) assigned.
   - The calculation must be performed on the latest available data and re-evaluated whenever underlying data changes (or at a scheduled interval defined by data refresh).

2. **Timestamp Display (AC-8)**  
   - A clearly labeled “Generated on” timestamp shall be displayed in a consistent location (e.g., page header or footer).  
   - The timestamp must be in a human-readable format (e.g., `YYYY-MM-DD HH:MM UTC`).  
   - The timestamp must update every time the RAG status is recomputed and reflect the actual time of that computation.

3. **Consistent RAG Application (AC-9)**  
   - All views (overview grid, detail panel, export) that show a project health indicator must use the identical RAG logic described in FR-3 and Requirement 1.  
   - No manual overrides or outdated cached values shall be shown unless explicitly marked as “overridden” and still accompanied by the computed status.  
   - A reconciliation tool (or automated test) must verify that any displayed status matches the engine output for the same dataset.

4. **Scannable UI (AC-10)**  
   - The page layout must present project health in a way that a user can locate and interpret the RAG status of a specific project within 30 seconds of opening the view.  
   - Design elements required:  
     - High-contrast color coding consistent with RAG (green, amber, red) applied to status icons or badges.  
     - Prioritized visual hierarchy: status icon/color and project name placed prominently, with secondary details hidden or collapsed.  
     - No more than one click or scroll to identify the status for a given project (default sort or filter by status allowed).  
     - Compliance measured via time-on-task usability tests or heuristic review against the 30‑second threshold.

## Acceptance Criteria

- **AC-8 – Timestamp present:**  
  - The artifact displays “Generated on: <timestamp>”.  
  - Timestamp matches the system’s last RAG computation time (verified via API or log).  
  - The display is visible without scrolling on a 1920×1080 viewport.

- **AC-9 – Consistent rules:**  
  - For a sample of 10 projects with known underlying data, manually calculated RAG matches the displayed status 100%.  
  - Automated regression tests that simulate different datasets (including edge cases like 50% active, on-hold+plan, build broken) produce the expected RAG.  
  - No UI component shows a status that deviates from the engine output.

- **AC-10 – Scannable within 30 seconds:**  
  - In a usability test with at least 5 participants, 90% of tasks (“find the status of project X”) complete within 30 seconds.  
  - Heuristic evaluation confirms that colour, iconography, and layout conform to the scannability design guidelines.  
  - The 30‑second measurement includes time from page load to the user correctly identifying the status.

## Out of Scope
- Historical RAG trends or snapshots over time (beyond the current “Generated on” moment).
- Manual override interfaces or approval workflows for status changes.
- Custom RAG rule definitions for individual teams (only the global FR-3 rules are in scope).
- Drill‑down details responsible for the status (e.g., list of specific blockers) – unless needed to keep status visible within the 30‑second scan (basic label only).
- Changes to data source ingestion, data quality, or upstream services.

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