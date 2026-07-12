> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #288
> _Each agent that updates this PRD signs its change below._

# PRD: Integration Discovery & Status Visibility

## Problem & Goal

Engineering and product teams lack a centralized, reliable view of which third-party integrations (GitHub, Jira, Slack, CI/CD pipelines, and others) are actively connected to their workspace or platform instance. This creates operational blind spots, onboarding friction, and audit/compliance gaps.

**Goal:** Deliver a queryable integration status layer that surfaces all connected integrations, their health/auth state, configuration metadata, and last-activity signals — enabling teams to instantly answer *"what is connected and is it working?"*

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform / DevOps Engineer** | Verify CI/CD and SCM connections are live before deployments |
| **Engineering Manager** | Audit which tools are wired into the team workspace |
| **Product Manager** | Confirm Jira and Slack integrations support workflow automations |
| **Security / Compliance Officer** | Enumerate all OAuth tokens, scopes, and connected apps for review |
| **New Team Member (Onboarding)** | Understand the current toolchain without tribal knowledge |

---

## Scope

### In Scope

- Detection and status reporting for the following integration categories:
  - **Source Control:** GitHub (GitHub.com, GitHub Enterprise)
  - **Project Management:** Jira (Cloud and Data Center)
  - **Messaging / Notifications:** Slack
  - **CI/CD:** GitHub Actions, Jenkins, CircleCI, GitLab CI, Buildkite, ArgoCD, and generic webhook-based pipelines
- Connection health status (connected, degraded, disconnected, token expired)
- Authentication method visibility (OAuth 2.0, PAT, API Key, Webhook secret)
- Permission/scope summary per integration
- Last successful sync or event timestamp
- Workspace/org-level and user-level integration differentiation

### Out of Scope

- Creating or modifying integrations (read/discovery only in v1)
- Integrations outside the defined categories (e.g., Salesforce, Zendesk, PagerDuty) — deferred to v2
- Detailed event log streaming or full audit trail (covered by dedicated audit logging feature)
- Billing or seat-count data from connected tools

---

## Functional Requirements

### FR-1: Integration Inventory Endpoint
- The system **must** expose an API endpoint (`GET /integrations`) that returns all configured integrations for the authenticated workspace.
- Response **must** include: `integration_id`, `type`, `provider`, `status`, `auth_method`, `scopes`, `connected_at`, `last_activity_at`, `connected_by` (user or service account).

### FR-2: Status Classification
- Each integration **must** be classified into one of four states:
  - `CONNECTED` — auth valid, last heartbeat/event within expected window
  - `DEGRADED` — auth valid but activity stale or partial errors detected
  - `AUTH_EXPIRED` — token/credential requires renewal
  - `DISCONNECTED` — explicitly removed or permanently unreachable

### FR-3: GitHub Integration Detection
- Detect installed GitHub Apps and OAuth App connections at org and repo level.
- Surface repository access scope (all repos vs. selected repos).
- Flag if webhook delivery has failed in the last 24 hours.

### FR-4: Jira Integration Detection
- Detect Jira Cloud (via Atlassian OAuth 2.0) and Jira Data Center (via PAT or Basic Auth) connections.
- Report connected Jira project keys and permission level (read / read-write).

### FR-5: Slack Integration Detection
- Detect Slack app installations at workspace level.
- Report granted OAuth scopes (e.g., `chat:write`, `channels:read`).
- Indicate if the bot token is active.

### FR-6: CI/CD Integration Detection
- Detect connected CI/CD providers via registered webhooks, stored API keys, or installed apps.
- Report pipeline provider name, trigger type (push, PR, schedule), and last pipeline event timestamp.

### FR-7: UI Integration Dashboard
- A dashboard view **must** display all integrations in a scannable list/table with status badges, provider logo, and last-activity timestamp.
- Users **must** be able to filter by `type`, `status`, and `auth_method`.
- Clicking an integration row **must** expand a detail panel showing full metadata from FR-1.

### FR-8: Stale / Expiring Auth Alerts
- The system **must** surface in-app warnings when a token is expired or will expire within 7 days.
- Notifications **must** be sent to the integration owner via email and (if Slack is connected) via Slack DM.

### FR-9: Permission & Role Gating
- Only users with `Admin` or `Owner` role **must** be able to view auth credentials summary and `connected_by` metadata.
- All workspace members **may** view integration type and status.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `GET /integrations` returns a correctly structured response for a workspace with at least one integration of each category (GitHub, Jira, Slack, CI/CD) within ≤ 500 ms (p95). |
| AC-2 | A workspace with an expired GitHub OAuth token shows that integration as `AUTH_EXPIRED` within 15 minutes of expiry. |
| AC-3 | The dashboard renders all connected integrations with correct status badges; filtering by `status=DEGRADED` returns only degraded integrations. |
| AC-4 | A non-admin member can see integration type and status but **cannot** see token values, scopes, or `connected_by` fields via API or UI. |
| AC-5 | An integration with no recorded event in > 72 hours transitions to `DEGRADED` state automatically. |
| AC-6 | A Slack DM and email notification is sent to the integration owner when token expiry is ≤ 7 days away (verified via test-mode trigger). |
| AC-7 | GitHub webhook delivery failures (3 consecutive failures) are reflected as `DEGRADED` status within one polling cycle (≤ 5 minutes). |
| AC-8 | All four CI/CD providers (GitHub Actions, Jenkins, CircleCI, GitLab CI) are correctly identified by provider name in the inventory when configured. |
| AC-9 | The integration detail panel displays `connected_at`, `last_activity_at`, `auth_method`, and `scopes` for admin users. |
| AC-10 | Integration inventory is exportable as JSON and CSV from the dashboard. |

---

## Out of Scope

- **Write operations:** Creating, editing, revoking, or re-authenticating integrations (v1 is discovery/read-only)
- **Non-listed providers:** PagerDuty, Datadog, Salesforce, Zendesk, Linear, Figma, etc. (v2 backlog)
- **Full event/audit log:** Per-event history stream for integration activity
- **SSO / Identity Provider integrations:** SAML, OKTA, Azure AD status (separate IdP feature)
- **Cost or rate-limit tracking** against third-party API quotas
- **Mobile application** views of the integration dashboard
- **Auto-remediation:** Automatic token refresh or re-auth flows (flagged for v2)