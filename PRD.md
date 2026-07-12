> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #326
> _Each agent that updates this PRD signs its change below._

# PRD: Project Management Tool Integration Audit & Activation

## Problem & Goal

Teams onboarding to the platform frequently stall because their project management tools (Jira or Linear) are not fully connected, issues are not imported, and real-time status sync is not operational. This creates duplicate work, stale data, and loss of visibility into engineering progress.

**Goal:** Deliver a reliable, verifiable integration layer that confirms Jira and Linear are authenticated, all relevant issues are imported, and bidirectional status sync is active and observable.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Engineering Manager | Visibility into issue status without leaving the platform |
| DevOps / Platform Engineer | Configuring and validating the integration |
| Product Manager | Confidence that backlog and sprint data are current |
| IT / Workspace Admin | Managing OAuth credentials and permissions |

---

## Scope

This PRD covers:

- OAuth connection setup and health checks for **Jira (Cloud & Data Center)** and **Linear**
- Initial and incremental issue import pipelines
- Real-time and scheduled bidirectional status synchronization
- A diagnostics/audit surface to verify each integration layer is active

---

## Functional Requirements

### 1. Connection

| ID | Requirement |
|---|---|
| F-CON-01 | User can initiate OAuth 2.0 authorization flow for Jira Cloud from the Integrations settings page |
| F-CON-02 | User can initiate OAuth 2.0 authorization flow for Linear from the Integrations settings page |
| F-CON-03 | Jira Data Center / Server connections are supported via API token + base URL |
| F-CON-04 | Connection status (Connected / Disconnected / Error) is displayed per integration with a last-verified timestamp |
| F-CON-05 | Expired or revoked tokens trigger an alert and prompt re-authentication |
| F-CON-06 | Users can disconnect an integration and revoke stored credentials |

### 2. Issue Import

| ID | Requirement |
|---|---|
| F-IMP-01 | On first connection, all issues from selected projects/teams are imported within 30 minutes |
| F-IMP-02 | Import scope is configurable: user selects which Jira projects or Linear teams to include |
| F-IMP-03 | Imported issues include: ID, title, description, assignee, priority, status, labels, parent/epic, and creation/update timestamps |
| F-IMP-04 | An import progress indicator shows total issues found, imported, and any failures |
| F-IMP-05 | Failed imports are logged with reason and retried automatically up to 3 times |
| F-IMP-06 | Incremental imports run every 15 minutes to capture newly created issues |

### 3. Status Sync

| ID | Requirement |
|---|---|
| F-SYN-01 | Status changes made in Jira/Linear are reflected in the platform within 5 minutes via webhook |
| F-SYN-02 | Status changes made in the platform are pushed back to Jira/Linear within 5 minutes |
| F-SYN-03 | Status field mappings are configurable (e.g., "In Review" in Linear → "In Review" in platform) |
| F-SYN-04 | Sync conflicts (both sides changed simultaneously) are resolved by last-write-wins with a conflict log entry |
| F-SYN-05 | Webhook registration is handled automatically on connection; webhook health is monitored every 60 minutes |
| F-SYN-06 | If a webhook fails, the system falls back to polling every 5 minutes and alerts the admin |

### 4. Diagnostics & Audit

| ID | Requirement |
|---|---|
| F-AUD-01 | An Integration Health dashboard displays: connection status, last import time, last sync event, webhook status, and error count (24 h) |
| F-AUD-02 | Admins can manually trigger a re-import or a sync test from the dashboard |
| F-AUD-03 | All sync events are logged with timestamp, direction, issue ID, old status, and new status |
| F-AUD-04 | Logs are retained for 30 days and exportable as CSV |

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-01 | Given a valid OAuth flow, when the user completes authorization, then connection status shows **Connected** with a verified timestamp within 10 seconds |
| AC-02 | Given a newly connected Jira project with 500 issues, when the initial import runs, then all 500 issues appear in the platform within 30 minutes with no data loss |
| AC-03 | Given a newly connected Linear team, when an issue status is changed in Linear, then the platform reflects the new status within 5 minutes |
| AC-04 | Given a status change in the platform, when sync runs, then the corresponding Jira/Linear issue reflects the updated status within 5 minutes |
| AC-05 | Given a broken webhook, when the system detects the failure, then it falls back to polling and surfaces an error alert to the admin within 10 minutes |
| AC-06 | Given the Integration Health dashboard, when an admin views it, then all four indicators (connection, import, sync, webhook) show current state with no data older than 60 minutes |
| AC-07 | Given an incremental import cycle, when a new issue is created in Jira or Linear, then it appears in the platform within 15 minutes |
| AC-08 | Given a disconnection action, when the user confirms, then the OAuth token is revoked and no further sync events occur |

---

## Out of Scope

- **Jira Server versions below 8.x** — only Data Center 8+ and Cloud are supported
- **Two-way sync of fields beyond status** (e.g., description edits, attachments, comments) — future phase
- **Linear Webhooks v1 (deprecated)** — only Webhooks v2 API
- **Migration of historical activity/audit logs** from Jira/Linear into the platform
- **Custom workflow automation** triggered by status changes (handled by separate Automations module)
- **Real-time collaborative editing** of issue content within the platform
- **Support for other PM tools** (Asana, Monday.com, GitHub Issues) in this release