> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #323
> _Each agent that updates this PRD signs its change below._

# PRD: Estimated Impact Metric for Tasks

## Problem & Goal

Teams and stakeholders currently have no standardized way to express or surface the business value of individual tasks. Without a consistent impact signal attached to each task, prioritization decisions rely on gut feel, verbal negotiation, or ad-hoc annotations scattered across comments and documents.

**Goal:** Enable users to attach a structured, human-readable *Estimated Impact* statement to any task — expressing measurable outcomes such as risk reduction, time savings, cost avoidance, or revenue gain — so that individuals and teams can make faster, data-informed prioritization decisions.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Engineering Manager / Tech Lead** | Justify sprint priorities to stakeholders using quantified value |
| **Product Manager** | Score and rank backlog items by business impact |
| **Individual Contributor (IC)** | Understand why a task matters before starting work |
| **Executive / Director** | Scan portfolio-level impact without reading every ticket |

---

## Scope

This document covers the **creation, display, editing, and querying** of an Estimated Impact field on tasks. It does not cover automated impact calculation or ML-based suggestions (see Out of Scope).

---

## Functional Requirements

### FR-1 — Impact Field on Task

- Every task MUST expose an optional **Estimated Impact** text field.
- The field accepts a free-text string up to **160 characters**.
- The field supports a structured micro-format: `[metric] [direction] [magnitude] [timeframe?]`
  - Examples: `"reduces risk by 15%"`, `"accelerates delivery by 3 days"`, `"saves ~$4 k/month"`
- The field is nullable; tasks without an entry display a muted placeholder: *"No impact estimate added."*

### FR-2 — Impact Category Tag (Optional Companion)

- Users MAY select one **Impact Category** from a fixed enum to aid filtering:
  - `risk_reduction` | `time_savings` | `cost_avoidance` | `revenue_gain` | `quality_improvement` | `other`
- Category defaults to `other` when free-text is entered but no category is chosen.

### FR-3 — Inline Editing

- The field MUST be editable inline on the task detail view without navigating to a separate settings page.
- Changes are auto-saved with optimistic UI update; a confirmation toast appears on successful save.
- Edit history (last 10 versions) is accessible via an *"Impact history"* tooltip/drawer.

### FR-4 — Display in Task Lists & Boards

- When populated, the Estimated Impact value MUST appear as a secondary line or chip beneath the task title in:
  - List view
  - Board card (truncated to 60 chars with ellipsis; full value on hover)
  - Task detail header

### FR-5 — Filtering & Sorting

- Users MUST be able to **filter** the task list by Impact Category.
- Users MUST be able to **sort** tasks by whether an impact estimate is present (populated first / populated last).
- Full-text search across impact statements MUST be supported within the existing search surface.

### FR-6 — Bulk Edit

- Users with edit permissions MUST be able to bulk-assign Impact Category to multiple selected tasks.
- Bulk edit does NOT overwrite existing free-text; it only sets/changes the category tag.

### FR-7 — API & Data Model

- The `task` resource in the REST API MUST expose:
  - `estimated_impact` (string | null, max 160 chars)
  - `impact_category` (enum | null)
  - `impact_updated_at` (ISO-8601 timestamp | null)
  - `impact_updated_by` (user ID | null)
- Both fields MUST be writable via `PATCH /tasks/{id}`.
- Both fields MUST be included in task export (CSV, JSON).

### FR-8 — Permissions

- **View** impact field: all users with task read access.
- **Edit** impact field: task assignee, task creator, project members with `contributor` role or above.
- **Delete / clear** impact field: same as edit; also project `admin`.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A user can open any task and type an Estimated Impact string; the value persists after page reload. |
| AC-2 | Strings exceeding 160 characters are rejected with an inline validation error before save. |
| AC-3 | The impact value is visible on the task card in Board view, truncated at 60 characters with full value shown on hover. |
| AC-4 | Filtering the task list by `impact_category = risk_reduction` returns only tasks tagged with that category. |
| AC-5 | Sorting by "Impact populated" places all tasks with a non-null impact field at the top. |
| AC-6 | `PATCH /tasks/{id}` with `{ "estimated_impact": "reduces risk by 15%" }` returns `200` and the updated value is reflected immediately in the UI. |
| AC-7 | A user without `contributor` role sees the impact field as read-only; the edit control is hidden. |
| AC-8 | Exported CSV contains `estimated_impact` and `impact_category` columns with correct values. |
| AC-9 | Impact edit history shows the last 10 changes with author and timestamp. |
| AC-10 | Bulk-assigning a category to 50 tasks completes without error and updates all 50 records. |

---

## Out of Scope

- **Automated / AI-generated impact estimates** — system will not suggest or auto-populate impact values based on task content, code diffs, or historical data.
- **Quantitative validation** — the system does not validate that numbers or percentages in the free-text are realistic or consistent.
- **Impact aggregation / roll-up** — summing or averaging impact across epics, milestones, or projects is not included in this release.
- **Impact vs. actual outcome tracking** — comparing estimated impact to post-completion measured outcomes is a future capability.
- **Notifications / reminders** — alerting users to tasks missing an impact estimate is out of scope.
- **Localization of the enum labels** — Impact Category labels will be English-only in v1.
- **Mobile native apps** — impact field is web-only in this release; mobile app support to follow.