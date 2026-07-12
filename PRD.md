> **PRD** — drafted by Ada (Sr. Product Mgr) · task #232
> _Each agent that updates this PRD signs its change below._

# PRD: Deadline Targets (Business + Customer)

## Problem & Goal

Teams currently lack a unified mechanism to define, track, and surface deadline targets across both internal business milestones and customer-facing commitments. Deadlines live in disparate tools (spreadsheets, project trackers, CRM notes), leading to missed commitments, poor visibility for stakeholders, and reactive rather than proactive risk management.

**Goal:** Introduce a first-class Deadline Targets feature that allows users to set, monitor, and receive alerts on two distinct deadline types — **Business Deadlines** (internal milestones, regulatory dates, sprint goals) and **Customer Deadlines** (contractual due dates, SLA windows, delivery commitments) — within a single, authoritative source of truth.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Project Manager / Program Manager | Create and manage deadline targets; monitor overall health across portfolios |
| Account Manager / Customer Success Manager | Track and report on customer-facing commitments; flag at-risk deliverables |
| Executive / VP | High-level visibility into on-track vs. at-risk deadlines; business health dashboards |
| Engineer / IC Contributor | View deadlines assigned to their work items; receive timely reminders |
| Finance / Legal | Track regulatory and contractual deadline compliance |

---

## Scope

This PRD covers the **v1 release** of Deadline Targets. It addresses:

- Creation and categorization of Business and Customer deadline targets
- Association of deadline targets with existing work items, projects, or accounts
- Status tracking and health indicators
- Notifications and alerts
- Reporting views

---

## Functional Requirements

### 1. Deadline Target Creation

**FR-1.1** Users can create a Deadline Target with the following required fields:
- **Name** — human-readable label
- **Type** — `Business` | `Customer`
- **Target Date** — calendar date (and optionally a specific time + timezone)
- **Owner** — assigned user or team

**FR-1.2** Users can populate optional fields:
- **Description** — freeform notes or context
- **Associated Entity** — link to a Project, Work Item, Account, or Contract record
- **Priority** — `Critical` | `High` | `Medium` | `Low`
- **External Reference** — contract ID, ticket number, or URL

**FR-1.3** Customer Deadline Targets must allow association with a specific customer account or contact record.

**FR-1.4** Business Deadline Targets must allow association with internal cost centers, regulatory bodies, or strategic initiatives via a freeform tag or structured field.

---

### 2. Deadline Status & Health

**FR-2.1** Each Deadline Target automatically displays one of four system-computed statuses:
- `On Track` — target date is in the future and no blockers flagged
- `At Risk` — within a configurable warning threshold (default: 14 days) of the target date with open dependencies or low completion
- `Overdue` — target date has passed without a completion event
- `Completed` — owner has manually marked complete, or a linked work item reached a terminal state

**FR-2.2** Users can manually override status with a written justification (override is logged in audit history).

**FR-2.3** A health score (percentage) is derived from the ratio of completed linked tasks to total linked tasks and surfaces alongside status.

---

### 3. Notifications & Alerts

**FR-3.1** Owners and watchers receive configurable reminder notifications at:
- 30 days before target date
- 14 days before target date
- 7 days before target date
- 1 day before target date
- On the target date

**FR-3.2** Users can customize or disable individual reminder intervals per Deadline Target.

**FR-3.3** When status transitions to `At Risk` or `Overdue`, all owners and watchers are notified immediately via in-app notification and email.

**FR-3.4** Notification channels supported in v1: **in-app**, **email**. Slack and webhook integrations are planned for v2.

---

### 4. Views & Reporting

**FR-4.1** A **Deadline Targets List View** displays all targets the user can access, filterable by:
- Type (Business / Customer)
- Status
- Owner
- Priority
- Date range (target date window)
- Associated entity

**FR-4.2** A **Timeline / Gantt View** renders deadline targets on a date axis alongside associated project milestones.

**FR-4.3** A **Summary Dashboard Widget** shows:
- Total active deadlines
- Count by status (`On Track`, `At Risk`, `Overdue`)
- Breakdown by type (Business vs. Customer)
- Top 5 nearest upcoming deadlines

**FR-4.4** Users can export Deadline Targets data to CSV and PDF.

**FR-4.5** Customer Deadline Targets are surfaced within the relevant Account or Customer record page (contextual embed).

---

### 5. Permissions & Access Control

**FR-5.1** Role-based access:
- **Admin** — full CRUD on all deadline targets
- **Manager** — full CRUD on targets within their team or account
- **Contributor** — can view and update completion status on assigned targets; cannot delete
- **Viewer** — read-only access

**FR-5.2** Customer Deadline Targets marked `Confidential` are visible only to users with explicit access grants, regardless of role.

---

### 6. Audit & History

**FR-6.1** All changes to a Deadline Target (field edits, status changes, manual overrides, completion events) are logged in an immutable audit trail with timestamp and actor.

**FR-6.2** Audit history is viewable inline on the Deadline Target detail page.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | A user can create a Business Deadline Target and a Customer Deadline Target; both appear in the List View with correct type labels. |
| AC-02 | Status automatically changes to `At Risk` when the target date is ≤14 days away and linked tasks are not fully complete. |
| AC-03 | Status automatically changes to `Overdue` when the target date passes without a completion event. |
| AC-04 | Owner receives an email and in-app notification at each configured reminder interval. |
| AC-05 | An immediate notification is sent to all watchers when status transitions to `At Risk` or `Overdue`. |
| AC-06 | A Customer Deadline Target linked to an account is visible on that account's record page. |
| AC-07 | List View filters by Type, Status, Owner, Priority, and date range return accurate, paginated results. |
| AC-08 | CSV export of filtered Deadline Targets includes all required and optional fields. |
| AC-09 | A Contributor cannot delete a Deadline Target; a Viewer cannot edit any field. |
| AC-10 | Every field change is captured in audit history with actor identity and timestamp. |
| AC-11 | A manual status override persists the override reason in the audit log and displays a visual indicator that status was manually set. |
| AC-12 | The Summary Dashboard Widget renders correctly and reflects real-time counts matching the List View totals. |

---

## Out of Scope

- **Slack / webhook notifications** — deferred to v2
- **Two-way sync with external calendars** (Google Calendar, Outlook) — future release
- **Automated deadline creation via AI suggestion** — future release
- **Customer-portal-facing deadline visibility** (sharing deadlines directly with end customers via a portal) — future release
- **Billing or SLA penalty tracking** tied to missed Customer Deadlines — handled by Finance tooling; integration considered for v3
- **Recurring / repeating deadline targets** — v2
- **Mobile native app support** — web responsive only in v1
- **Multi-language / localization** beyond English — post-v1