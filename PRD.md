> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #285
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Deadline Visibility & Tracking Feature

## Status: Work in Progress

---

## Problem & Goal

Teams operating across business and customer contexts lack a unified, reliable view of deadlines. Business deadlines (internal milestones, regulatory dates, board commitments, vendor SLAs) and customer deadlines (contractual deliverables, go-live dates, renewal windows) are stored in disparate tools — spreadsheets, project trackers, email threads, and CRM systems — creating blind spots that lead to missed commitments, strained relationships, and revenue risk.

**Goal:** Provide a single source of truth that surfaces, categorizes, and tracks both business-internal and customer-facing deadlines, with proactive alerting and clear ownership, so stakeholders can act before deadlines are missed.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Account Executive / CSM | Visibility into customer contractual and renewal deadlines |
| Project Manager | Tracking internal milestone and delivery deadlines |
| Engineering Lead | Awareness of technical delivery commitments |
| Executive / VP | Rolled-up view of at-risk deadlines across portfolio |
| Operations / RevOps | Audit trail and reporting on deadline adherence |

---

## Scope

This PRD covers the discovery, ingestion, display, and alerting of:
- **Business deadlines** — internal milestones, regulatory/compliance dates, vendor SLA dates, board/executive commitments, budget cycle dates
- **Customer deadlines** — contractual delivery dates, go-live/launch dates, renewal and expansion windows, SLA response/resolution windows

Integrations with existing tooling (CRM, project management, calendar) are in scope for this phase.

---

## Functional Requirements

### 1. Deadline Ingestion & Data Model

- **FR-1.1** The system must allow manual creation of a deadline record with the following required fields:
  - Deadline name
  - Deadline type (`Business` | `Customer`)
  - Subtype (e.g., Regulatory, Contractual, Milestone, Renewal, SLA)
  - Due date and time (with timezone)
  - Owner (user or team)
  - Associated entity (project, account, contract, or vendor)
  - Priority (`Critical` | `High` | `Medium` | `Low`)
  - Status (`Not Started` | `In Progress` | `At Risk` | `Complete` | `Missed`)

- **FR-1.2** The system must ingest deadlines automatically via integrations with:
  - CRM (Salesforce, HubSpot) — pull renewal dates, contract end dates, and SLA terms
  - Project management tools (Jira, Asana, Linear) — pull milestone and delivery due dates
  - Google Calendar / Outlook — pull calendar-blocked deadline events tagged with a defined keyword or label
  - Contract management systems (DocuSign CLM, Ironclad) — pull executed contract obligation dates

- **FR-1.3** Duplicate detection must flag or suppress records with matching entity + due date + type before saving.

### 2. Deadline Dashboard & Views

- **FR-2.1** A unified deadline dashboard must display all deadlines in a filterable, sortable list view with columns: Name, Type, Subtype, Due Date, Owner, Priority, Status, Days Until Due.

- **FR-2.2** Users must be able to filter by:
  - Deadline type (Business / Customer)
  - Subtype
  - Owner / team
  - Date range
  - Priority
  - Status
  - Associated account or project

- **FR-2.3** A calendar view must show deadlines plotted on a monthly/weekly grid, color-coded by type (Business vs. Customer) and priority.

- **FR-2.4** A "Coming Due" widget must surface deadlines due within the next 7, 14, and 30 days, configurable per user.

- **FR-2.5** An executive summary view must display:
  - Total deadlines by type and status
  - Count of deadlines at risk or missed in the current quarter
  - Percentage of deadlines completed on time (rolling 90 days)

### 3. Alerting & Notifications

- **FR-3.1** The system must send configurable advance notifications to deadline owners at:
  - 30 days before due
  - 14 days before due
  - 7 days before due
  - 48 hours before due
  - Day of due date

- **FR-3.2** Notification channels must include in-app, email, and Slack (configurable per user).

- **FR-3.3** If a deadline status is not updated to `Complete` by the due date, the system must automatically flip status to `Missed` and notify the owner and their manager.

- **FR-3.4** Escalation rules must allow a deadline owner's manager to be notified if a `Critical` or `High` priority deadline remains `At Risk` for more than 5 business days.

### 4. Audit Trail & Reporting

- **FR-4.1** Every status change, owner reassignment, and date modification must be logged with timestamp and acting user.

- **FR-4.2** A deadline adherence report must be exportable as CSV or PDF, filterable by type, team, and date range, showing on-time vs. missed rates.

- **FR-4.3** Reports must be schedulable for automated delivery (weekly/monthly) to designated recipients.

### 5. Permissions & Access Control

- **FR-5.1** Role-based access must restrict editing of customer deadlines to owners, their managers, and admins.

- **FR-5.2** Executive view must be read-only for non-admin roles.

- **FR-5.3** Integrations must authenticate via OAuth 2.0 or API key, with credentials stored encrypted at rest.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A user can create a Business or Customer deadline record in under 2 minutes with all required fields. |
| AC-2 | Deadlines imported from CRM, project tools, and calendar integrations appear in the dashboard within 15 minutes of sync. |
| AC-3 | Duplicate deadline records (same entity + type + due date) are flagged before the record is saved. |
| AC-4 | The dashboard correctly displays deadlines filtered by type, owner, and date range with no data bleed across filters. |
| AC-5 | Notifications are delivered to the correct channels at each configured threshold with zero missed alerts in a 30-day QA test cycle. |
| AC-6 | A deadline not marked `Complete` by its due date is automatically marked `Missed` within 1 hour of the due datetime passing. |
| AC-7 | An escalation notification reaches the owner's manager within 24 hours when a `Critical` deadline is `At Risk` for 5+ business days. |
| AC-8 | The audit log captures every field change with actor and timestamp, with no gaps detectable during QA review. |
| AC-9 | The adherence report exports correctly formatted CSV and PDF with accurate on-time percentages validated against raw data. |
| AC-10 | All integration credentials are stored encrypted and no plaintext secrets appear in logs or API responses. |

---

## Out of Scope

- **Deadline creation by external customers** — customers cannot log in to create or view their own deadlines in this phase; that is deferred to a customer portal initiative.
- **Automated deadline extraction from email body text** — NLP-based email parsing is not included in this phase.
- **Financial penalty or SLA credit calculation** — business logic for computing penalties on missed SLAs is handled by the billing system, not this feature.
- **Native mobile application** — mobile access is via responsive web only; a dedicated iOS/Android app is out of scope.
- **Two-way sync back to source systems** — integrations are read/ingest only; writing deadline status back to Jira, Salesforce, etc. is deferred.
- **Deadline dependency mapping** — linking deadlines in predecessor/successor chains (Gantt-style) is out of scope for this phase.
- **Multi-currency or localization** — internationalization beyond English and UTC-offset timezone support is deferred.