> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #252
> _Each agent that updates this PRD signs its change below._

# PRD: Red/Amber/Green (RAG) Status per Project

## Problem & Goal

Project stakeholders currently lack a fast, at-a-glance mechanism to understand the health of individual projects. Status is communicated inconsistently — buried in narrative updates, spreadsheets, or disparate tools — making it difficult for leadership and team leads to identify at-risk projects and act before issues escalate.

**Goal:** Implement a standardised Red/Amber/Green (RAG) status indicator for every project so that all stakeholders can instantly assess project health, surface blockers early, and prioritise interventions.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Portfolio Manager / PMO | Aggregate view of all project statuses to manage risk across the portfolio |
| Project Manager | Set and update RAG status with supporting rationale; track history |
| Executive / Sponsor | Quick health summary without reading full reports |
| Team Member | Understand the declared status of their project |

---

## Scope

This feature covers the ability to assign, display, update, and audit a RAG status on each project entity within the platform. It includes status visibility on project detail pages, project list/dashboard views, and notifications on status changes.

---

## Functional Requirements

### FR-1 · RAG Status Field
- Each project must have exactly one RAG status at any point in time.
- Valid values: **Red**, **Amber**, **Green**.
- Default status for a newly created project is **Green**.

### FR-2 · Status Assignment & Update
- Users with the **Project Manager** or **Portfolio Manager** role can set or change the RAG status of a project.
- Status changes must require a mandatory free-text **reason / comment** (minimum 10 characters, maximum 500 characters).
- A status change is recorded as a timestamped entry in the project's audit history.

### FR-3 · Visual Display
- RAG status is rendered as a colour-coded badge/pill:
  - 🔴 **Red** — project is critically at risk; immediate action required.
  - 🟡 **Amber** — project has issues that need attention but is not yet critical.
  - 🟢 **Green** — project is on track.
- The badge must meet WCAG 2.1 AA contrast requirements and include a text label (not colour alone) to support accessibility.

### FR-4 · Project List / Dashboard View
- The RAG status badge is displayed as a column in the project list view.
- The project list can be filtered by one or more RAG statuses.
- The project list can be sorted by RAG status (Red → Amber → Green default severity order).

### FR-5 · Project Detail View
- The RAG status badge is prominently displayed in the project header.
- A **Status History** panel shows the full chronological log of status changes, including: previous status, new status, changed-by user, timestamp, and reason.

### FR-6 · Portfolio / Summary View
- A summary widget displays the count of projects in each RAG state (e.g., 3 Red / 7 Amber / 22 Green).
- Clicking a count filters the project list to that status.

### FR-7 · Notifications
- When a project status changes to **Red**, all project Watchers and the Project Sponsor receive an in-app notification and an email notification.
- When a project status changes from **Red** to **Amber** or **Green**, the same audience receives an in-app notification (email optional, configurable per user preference).
- Notifications include: project name, new status, changed-by user, and the reason provided.

### FR-8 · Permissions
- **Read** access to RAG status: all authenticated users who have view access to the project.
- **Write** access to RAG status: Project Manager, Portfolio Manager, and System Administrator only.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Every project in the system displays a RAG badge; no project can exist without a status. |
| AC-2 | Attempting to save a status change without a reason of ≥ 10 characters produces a validation error and blocks the save. |
| AC-3 | A user without Project Manager or Portfolio Manager role cannot see the "Edit Status" control (UI hidden) and receives a 403 response if the API endpoint is called directly. |
| AC-4 | After a status change, the Status History panel reflects the new entry within 5 seconds without a full page reload. |
| AC-5 | The project list, when filtered to "Red", shows only Red projects and the count matches the portfolio summary widget. |
| AC-6 | All three RAG badges pass an automated WCAG 2.1 AA colour-contrast check and include visible text labels. |
| AC-7 | An email and in-app notification is delivered within 2 minutes of a project being set to Red. |
| AC-8 | The portfolio summary widget counts are accurate in real time; manual refresh is not required. |
| AC-9 | Status history is immutable — no entry can be edited or deleted via the UI or API. |
| AC-10 | End-to-end status change flow (set → save → history entry → notification) is covered by automated integration tests. |

---

## Out of Scope

- **Automated / calculated RAG status** — status is manually set only; algorithmic derivation from schedule, budget, or task completion is not included in this release.
- **Custom status labels or additional status values** — only the three standard RAG values are supported.
- **Sub-project or milestone-level RAG status** — RAG applies at the top-level project entity only.
- **RAG status in exported reports / PDF generation** — export formatting is handled by a separate reporting feature.
- **Third-party integrations** (e.g., pushing RAG status to Jira, Slack, or MS Teams) — out of scope for this release.
- **Mobile-native push notifications** — web/email notifications only.
- **SLA enforcement or escalation workflows** triggered by status — workflow automation is a future feature.