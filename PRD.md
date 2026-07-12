> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #253
> _Each agent that updates this PRD signs its change below._

# PRD: Key Risk & Recommended Next Action per Project

## Problem & Goal

Project stakeholders and team leads currently lack a consolidated, at-a-glance view of the top risk facing each project and what should be done about it. Risk information is scattered across status updates, meeting notes, and project management tools, making it difficult to prioritize attention and act decisively. The goal is to surface **one key risk and one recommended next action per project** in a single, unified view so decision-makers can triage and respond quickly.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Portfolio Manager / PMO Lead** | Scan risk posture across all active projects in one view |
| **Project Manager** | Confirm their project's top risk is accurately represented and actioned |
| **Executive Sponsor** | Quickly identify which projects need escalation or intervention |
| **Team Lead / Tech Lead** | Understand what action is expected of them next |

---

## Scope

This document covers the generation, display, and maintenance of a **per-project risk summary card** containing:
- The single highest-priority risk for each project
- A single recommended next action to mitigate or address that risk

Applicable to all active projects tracked within the organization's project portfolio.

---

## Functional Requirements

### FR-1: Project Risk Identification
- The system (or designated agent/analyst) must evaluate each active project and identify its **top risk** — the one risk most likely to negatively impact scope, timeline, budget, or quality if left unaddressed.
- The key risk must be expressed as a clear, plain-language statement (≤ 30 words).
- Each risk must include a **severity tag**: `Critical`, `High`, `Medium`, or `Low`.

### FR-2: Recommended Next Action
- Each project must have exactly **one recommended next action** tied directly to its key risk.
- The action must be:
  - Specific and actionable (not vague guidance)
  - Assigned to a **role or named owner**
  - Associated with a **due date or time horizon** (e.g., "by EOW", "within 3 business days")
- Action must be expressed in ≤ 25 words.

### FR-3: Project Summary Card Structure
Each project entry must display the following fields:

| Field | Description |
|---|---|
| `Project Name` | Official project name or ID |
| `Project Status` | Current status: On Track / At Risk / Blocked / Completed |
| `Key Risk` | Top risk statement with severity tag |
| `Risk Category` | Schedule / Budget / Resource / Technical / Dependency / Compliance |
| `Recommended Next Action` | Specific action, owner, and due date |
| `Last Updated` | Date the risk and action were last reviewed |

### FR-4: Portfolio-Level View
- All project summary cards must be viewable in a **single consolidated list or table**, sortable by:
  - Project status
  - Risk severity
  - Risk category
  - Last updated date
- The view must support **filtering** by status, severity, and risk category.

### FR-5: Staleness Indicator
- Any project card not updated within **5 business days** must be flagged visually as **Stale** to prompt review.
- Stale cards must surface at the top of any default sort.

### FR-6: Update & Review Workflow
- Project Managers must be able to update their project's key risk and next action directly.
- All updates must be timestamped and attributed to the editor.
- A review cadence of **at minimum once per week** must be enforced per project.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Every active project has exactly one key risk and one recommended next action populated |
| AC-2 | No risk statement exceeds 30 words; no action statement exceeds 25 words |
| AC-3 | Every recommended next action includes a named/role owner and a due date |
| AC-4 | Every key risk carries one of the four defined severity tags and one risk category |
| AC-5 | Portfolio view displays all projects in a single scrollable list with sort and filter functional |
| AC-6 | Cards not updated in > 5 business days display a "Stale" flag and sort to the top by default |
| AC-7 | All edits are timestamped and show the editor's identity |
| AC-8 | A stakeholder with read access can identify the key risk and next action for any project within 10 seconds of opening the view |

---

## Out of Scope

- **Full risk registers** — this feature surfaces only the single top risk, not a comprehensive list of all risks per project.
- **Automated risk detection** — risks are human-identified and entered; no ML or automated scanning of project data is included in this iteration.
- **Risk history / audit trail beyond edit attribution** — trending or historical risk comparison is not included.
- **Integration with external project management tools** (e.g., Jira, Asana, Smartsheet) in the first version; manual entry only.
- **Quantitative risk scoring** (probability × impact matrices) — severity is tag-based only.
- **Notification or alerting system** for risk changes or stale cards — flagging is visual only; push notifications are out of scope.
- **Completed or archived projects** — only active projects are in scope.