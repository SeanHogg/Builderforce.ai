> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #202
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Task PR Status Tracker

## Problem & Goal

### Problem

Development teams often struggle to quickly ascertain the completion status of tasks based on their associated Pull Requests (PRs). Manually checking each task's PR status (merged vs. open) across various repositories is time-consuming and prone to error, leading to delays in release planning, inaccurate progress reporting, and confusion regarding task readiness for deployment.

### Goal

To provide a concise, automated mechanism for identifying which development tasks have their associated Pull Requests (PRs) merged and which still have open PRs. This will improve project visibility, streamline release readiness assessments, and enhance overall development workflow efficiency.

## Target users / ICP roles

*   **Development Leads:** To monitor team progress and identify blockers.
*   **Project Managers:** To track task completion and update project schedules.
*   **Release Managers:** To determine the readiness of features for deployment.
*   **Developers:** To quickly review the status of their own or team's work.

## Scope

This tool will focus on querying a version control system (e.g., GitHub, GitLab) to retrieve the status of Pull Requests linked to a specified set of tasks. The output will clearly differentiate between tasks with merged PRs and those with open PRs.

## Functional requirements

*   **F1: Task ID Input:** Users must be able to provide a list of task identifiers (e.g., Jira ticket numbers, internal tracking IDs).
*   **F2: PR Association Lookup:** The system shall search for Pull Requests that are associated with the provided task identifiers (e.g., by matching task IDs in PR titles or descriptions).
*   **F3: PR Status Determination:** For each found PR, the system must accurately determine its current status:
    *   `Open`: The PR is still active and awaiting review/merge.
    *   `Merged`: The PR has been successfully integrated into the target branch.
    *   `Closed (Unmerged)`: The PR was closed without being merged.
*   **F4: Configurable Scope:** Users shall be able to specify the repository(ies) or organization(s) to search within.
*   **F5: Output Report Generation:** The system shall generate a human-readable report summarizing the status for each task ID:
    *   Task ID
    *   Associated PRs (if any)
    *   Status of each associated PR (Open, Merged, Closed)
    *   A summary indicating if *all* associated PRs are merged for a given task, or if *any* remain open.

## Acceptance criteria

*   **AC1: Accurate Merged Status:** Given a task ID with an associated PR that has been merged, the report correctly identifies the PR status as "Merged" and indicates the task as "All PRs Merged" (if applicable).
*   **AC2: Accurate Open Status:** Given a task ID with an associated PR that is currently open, the report correctly identifies the PR status as "Open" and indicates the task as "PR(s) Open."
*   **AC3: Handling No PRs:** Given a task ID with no associated PR found, the report clearly indicates "No PR Found."
*   **AC4: Multiple PRs per Task:** If a task ID has multiple associated PRs, the report correctly lists all of them and their individual statuses. The summary for the task should reflect that it is "PR(s) Open" if even one associated PR is not merged.
*   **AC5: Clear & Concise Output:** The generated report is easy to read, well-formatted, and provides the necessary information at a glance.
*   **AC6: Error Handling:** The system gracefully handles cases like invalid task IDs, inaccessible repositories, or API rate limits, providing informative error messages.

## Out of scope

*   Creating, modifying, or deleting Pull Requests.
*   Detailed code analysis or linting within PRs.
*   Integration with project management tools beyond consuming task IDs.
*   Sending notifications or alerts based on PR status changes.
*   Advanced analytics or historical trend reporting on PR status.
*   Automated merging or closing of PRs.

---

> **PRD** — drafted by CTO · task #487
> _Each agent that updates this PRD signs its change below._

# Evermind Knowledge & Learning Pipeline PRD

## Problem & Goal
Teams building memory-enabled agents lack a repeatable pipeline to baseline existing knowledge, extract new insights, review for quality, store durably, and transfer to downstream systems. The goal is to deliver a reliable, auditable pipeline that turns raw interactions into structured, transferable knowledge while minimizing hallucination and drift.

## Target Users / ICP Roles
- Memory-engine maintainers and platform engineers
- AI application developers integrating long-term memory
- Knowledge operations roles responsible for review and governance

## Scope
Implement the five-stage pipeline (baseline → extract → review → store → transfer) as a core workflow inside `memory-engine`. Cover orchestration, data models, review interfaces, and transfer adapters for the initial release.

## Functional Requirements
- **Baseline**: Snapshot current knowledge graph and vector store state with versioning.
- **Extract**: Identify and pull candidate facts, entities, and relationships from new sessions or documents.
- **Review**: Human-in-the-loop or automated quality gates for accuracy, relevance, and conflict detection.
- **Store**: Persist reviewed items into the canonical knowledge store with provenance metadata.
- **Transfer**: Export approved knowledge to external targets (vector DBs, graphs, downstream agents) via configurable adapters.
- Provide CLI and SDK entry points for pipeline execution and status tracking.
- Log every stage transition for auditability.

## Acceptance Criteria
- Pipeline completes an end-to-end run on a 100-session corpus with <5% manual intervention.
- Baseline and store operations produce immutable snapshots retrievable by version.
- Review step surfaces conflicts and requires explicit approval before storage.
- Transfer adapters successfully sync to at least two target systems with zero data loss.
- All stages expose metrics (latency, items processed, rejection rate) via Prometheus.

## Out of Scope
- Advanced LLM fine-tuning or model training
- Real-time streaming ingestion
- Multi-tenant isolation or billing features
- Mobile or non-engine client SDKs
- Historical data migration from legacy systems

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

---

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
