> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #278
> _Each agent that updates this PRD signs its change below._

# PRD: Timeline & Deadlines Visibility — "Are We On Track?"

## Problem & Goal

Teams operating across business and customer contexts lose visibility into whether projects, commitments, and deliverables are progressing on schedule. Business-side deadlines (board commitments, revenue milestones, vendor contracts, regulatory filings) and customer-facing deadlines (go-live dates, SLA windows, contracted delivery dates) exist in separate tools, spreadsheets, or mental models — making it impossible to answer the simple question: *"Are we on track?"*

**Goal:** Build a unified timeline and deadline tracking layer that aggregates business and customer deadlines, computes real-time health status for each, surfaces risks before they become misses, and gives every stakeholder a single source of truth.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Executive / VP** | Portfolio-level on-track/at-risk/missed snapshot; board-ready rollup |
| **Program / Project Manager** | Day-to-day deadline management, dependency tracking, escalation triggers |
| **Account Manager / CSM** | Customer-committed dates, SLA countdown, renewal risk visibility |
| **Engineering Lead** | Sprint and release milestone alignment with external commitments |
| **Finance / Legal / Ops** | Contractual, regulatory, and vendor deadline compliance |

---

## Scope

### In Scope

- Deadline ingestion from internal project trackers (Jira, Linear, Asana, Monday.com) and CRM/CS tools (Salesforce, HubSpot, Gainsight)
- Manual deadline entry for commitments not captured in connected tools
- Separation and tagging of **Business Deadlines** vs **Customer Deadlines**
- Real-time health calculation per deadline (On Track / At Risk / Off Track / Missed)
- Configurable buffer/warning thresholds per deadline type or owner
- Cross-deadline dependency mapping
- Automated status notifications and escalation alerts
- Role-based dashboards and exportable timeline views
- Audit trail of deadline changes (original date, revised date, reason, owner)

---

## Functional Requirements

### FR-1: Deadline Ingestion & Creation
- **FR-1.1** Connect to at minimum Jira, Linear, Asana, and Salesforce via OAuth; sync deadlines on a configurable schedule (minimum: every 15 minutes).
- **FR-1.2** Allow manual creation of a deadline with fields: title, type (Business | Customer), owner, target date, dependent deadlines, priority tier (P1–P3), and description.
- **FR-1.3** Support bulk import via CSV with field mapping wizard.
- **FR-1.4** Detect and deduplicate deadlines synced from multiple sources against the same underlying commitment.

### FR-2: Deadline Classification & Tagging
- **FR-2.1** Every deadline must carry a `type` label: **Business** (internal milestones, board commitments, regulatory, financial close, vendor contracts) or **Customer** (contracted delivery, SLA, go-live, renewal).
- **FR-2.2** Support user-defined sub-tags (e.g., "Regulatory," "Enterprise Tier," "Series B Commitment") for filtering and grouping.
- **FR-2.3** Allow an owner and a secondary stakeholder to be assigned per deadline.

### FR-3: Health Status Engine
- **FR-3.1** Compute a health status for each deadline using the following default logic:

  | Status | Condition |
  |---|---|
  | **On Track** | Completion forecast ≤ target date; all dependencies on track |
  | **At Risk** | Forecast within configurable warning buffer (default: 10% of total duration or 5 business days, whichever is greater) OR a dependency is At Risk |
  | **Off Track** | Forecast exceeds target date but not yet passed |
  | **Missed** | Target date passed without confirmed completion |

- **FR-3.2** Allow admins to override default buffer thresholds globally or per deadline.
- **FR-3.3** Expose a manual health override with a mandatory reason field; override is logged and visible to all stakeholders.
- **FR-3.4** Re-evaluate and update health status on each data sync and on any manual update.

### FR-4: Dependency Mapping
- **FR-4.1** Allow any deadline to declare one or more upstream dependencies (blockers) and downstream dependents.
- **FR-4.2** Visually render a dependency graph in a Gantt-style and a network/graph view.
- **FR-4.3** Automatically propagate risk upstream: if a deadline moves At Risk or Off Track, flag all downstream dependents.
- **FR-4.4** Detect and warn on circular dependencies at save time.

### FR-5: Dashboards & Views
- **FR-5.1** **Executive Summary View:** Total counts by status (On Track / At Risk / Off Track / Missed) split by Business vs Customer, with trend sparklines over the last 30/60/90 days.
- **FR-5.2** **Timeline View:** Interactive Gantt showing all active deadlines, color-coded by health status, filterable by type, owner, tag, priority, and date range.
- **FR-5.3** **Deadline Detail Panel:** Full history, dependency graph, linked source tickets/records, all status changes with timestamps and owners.
- **FR-5.4** **Customer Deadline View:** Scoped to a specific customer account, showing all committed dates, SLA windows remaining, and next milestone.
- **FR-5.5** Support saved filtered views shareable via URL.

### FR-6: Alerts & Notifications
- **FR-6.1** Send configurable deadline-approaching alerts at T-30, T-14, T-7, T-3, T-1 days (admin-configurable per tier or deadline).
- **FR-6.2** Send immediate alerts when health status changes to At Risk, Off Track, or Missed.
- **FR-6.3** Deliver alerts via email, Slack, and in-app notification; recipients configurable per deadline (owner, stakeholders, escalation path).
- **FR-6.4** Provide a daily digest option summarizing all deadlines changing status in the prior 24 hours.
- **FR-6.5** Support escalation routing: if a deadline reaches Off Track and no action is logged within 24 hours, notify the owner's manager (resolved via HRIS or manual escalation chain).

### FR-7: Audit Trail & Change Management
- **FR-7.1** Log every change to a deadline: field changed, previous value, new value, actor, timestamp.
- **FR-7.2** Record all date slips with a mandatory `slip reason` field from a predefined taxonomy (Scope Change, Dependency Block, Resource Constraint, External / Customer, Technical Blocker, Other).
- **FR-7.3** Expose a "Slip Rate" metric per team, owner, and deadline type over configurable time windows.
- **FR-7.4** Retain audit logs for a minimum of 24 months.

### FR-8: Reporting & Export
- **FR-8.1** Generate a "Deadline Health Report" exportable as PDF and CSV, filterable by date range, type, owner, and status.
- **FR-8.2** Provide an embeddable status widget (iframe or public URL, access-controlled) for use in executive dashboards or customer-facing status pages.
- **FR-8.3** Expose all deadline data via REST API (read + write) with API key authentication.

---

## Acceptance Criteria

### AC-1: Ingestion & Sync
- [ ] A deadline created or updated in a connected source system appears in the product within 15 minutes of the next scheduled sync.
- [ ] Duplicate deadlines from two integrated sources representing the same commitment are merged into one record, with both source links visible.
- [ ] CSV import of 500 deadlines completes without error in under 2 minutes with a clear error report for any invalid rows.

### AC-2: Health Status Accuracy
- [ ] A deadline whose forecast completion date is within the warning buffer transitions to **At Risk** automatically on the next sync without manual intervention.
- [ ] A deadline whose target date passes with no completion logged transitions to **Missed** within 15 minutes of the target date/time.
- [ ] A manually overridden health status displays a visible "Override Active" badge and the override reason to all viewers.
- [ ] When an upstream dependency changes to Off Track, all immediate downstream dependents reflect At Risk status within one sync cycle.

### AC-3: Dashboards
- [ ] The Executive Summary View loads in under 3 seconds for a portfolio of up to 2,000 active deadlines.
- [ ] Filtering the Timeline View by any combination of type, owner, tag, and status returns correct results with no omissions or false inclusions.
- [ ] A Customer Deadline View for a named account shows only deadlines tagged to that account and no others.

### AC-4: Alerts
- [ ] A T-7 alert is delivered to the configured Slack channel and owner email within 5 minutes of the trigger time.
- [ ] A status-change alert (e.g., On Track → At Risk) is delivered within 5 minutes of the triggering sync.
- [ ] Escalation notification is sent to the owner's manager within 24 hours of an Off Track status with no logged action, and a test case confirms this does not fire if an action comment is logged within the window.

### AC-5: Audit & Compliance
- [ ] Every date change on a deadline is logged with actor, timestamp, old value, new value, and slip reason — verifiable in the audit trail UI and via API.
- [ ] Audit logs are non-deletable by any user role including admin (soft-delete only with superadmin flag required).
- [ ] Slip Rate report for a given owner returns values consistent with the underlying audit log for the same time window (zero discrepancy).

### AC-6: API
- [ ] REST API returns a full deadline record including health status, dependencies, and last-modified timestamp via a single `GET /deadlines/{id}` call.
- [ ] `PATCH /deadlines/{id}` with a date change requires a `slip_reason` field; requests missing it return HTTP 422 with a descriptive error.

---

## Out of Scope

- **Full project management replacement** — this is a deadline visibility and health layer, not a task management or work execution tool.
- **Time tracking or resource capacity planning** — no time-logging, utilization, or headcount planning features.
- **Billing or invoicing triggers** tied to milestone completion (finance system integration is read-only for deadline context only).
- **Customer-facing self-service portal** — customers do not log into this product; external sharing is limited to the embeddable widget and PDF exports.
- **AI-generated forecasting or ML-based slip prediction** — health status is rule-based in V1; predictive modeling is a future phase.
- **Mobile native application** — responsive web only in V1; native iOS/Android is deferred.
- **Granular permissions below the role level** — field-level or record-level ACLs are not in scope for V1; role-based access (Admin, Editor, Viewer) is sufficient.
- **Two-way writeback to source systems** — integrations are read-only ingestion; updating a deadline in this product does not push changes back to Jira, Salesforce, etc., in V1.