> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #327
> _Each agent that updates this PRD signs its change below._

# PRD: Slack / Microsoft Teams Integration Status Checker

## Problem & Goal

Users and workspace administrators lack a clear, immediate way to determine whether their Slack or Microsoft Teams account is properly connected and whether the correct channels are linked to the relevant entities (projects, alerts, notifications, etc.) within the platform. This causes missed notifications, silent failures, and support burden. The goal is to surface connection and channel-linking status in a reliable, human-readable way so users can self-diagnose and resolve integration issues without engineering involvement.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Workspace Admin** | Verify org-level OAuth connection is active and authorized |
| **Project Manager / Team Lead** | Confirm the correct channel is linked to their project or alert group |
| **Developer / End User** | Quickly check why notifications are not arriving |
| **Customer Success / Support** | Diagnose integration health for a customer without backend access |

---

## Scope

This PRD covers:

- Status checks for **Slack** and **Microsoft Teams** integrations
- Two distinct status dimensions:
  1. **Connection status** — Is the OAuth/bot integration authenticated and active?
  2. **Channel link status** — Is a specific channel mapped to the expected resource (project, alert, workspace, etc.)?
- UI surface(s): settings page, integration dashboard panel, and inline contextual indicators
- API endpoint(s) that back the status checks

---

## Functional Requirements

### FR-1: Connection Status Detection

- **FR-1.1** The system must check whether a valid, non-expired OAuth token exists for the configured Slack workspace or Teams tenant.
- **FR-1.2** The system must verify the bot/app has not been removed from the workspace (active scope validation).
- **FR-1.3** Connection status must be one of three discrete states:
  - `Connected` — token valid, bot present, scopes intact
  - `Degraded` — token exists but one or more required scopes are missing or bot is removed from a required channel
  - `Disconnected` — no token, revoked token, or app uninstalled
- **FR-1.4** Status must refresh automatically (poll interval ≤ 5 minutes) and on manual user trigger ("Re-check" button).

### FR-2: Channel Link Status Detection

- **FR-2.1** For each linked resource (project, alert rule, notification group), the system must display which channel (name + ID) is currently linked.
- **FR-2.2** The system must validate that the linked channel still exists in the workspace and that the bot is a member of that channel.
- **FR-2.3** Channel link status must be one of three discrete states:
  - `Linked & Reachable` — channel exists and bot is a member
  - `Linked but Unreachable` — channel is recorded but bot is not a member or channel is archived/deleted
  - `Not Linked` — no channel has been associated with this resource
- **FR-2.4** When status is `Linked but Unreachable`, the UI must display the specific reason (e.g., "Bot not in channel," "Channel archived," "Channel not found").

### FR-3: Status UI Indicators

- **FR-3.1** Integration settings page must show a top-level status badge per integration (Slack / Teams) reflecting connection state.
- **FR-3.2** Each resource row (project, alert, etc.) must display an inline channel status indicator.
- **FR-3.3** Status indicators must use consistent iconography: ✅ Connected/Linked, ⚠️ Degraded/Unreachable, ❌ Disconnected/Not Linked.
- **FR-3.4** Clicking any non-green status indicator must open a contextual panel with:
  - Plain-English explanation of the issue
  - Actionable next step (e.g., "Re-authorize," "Invite bot to channel," "Link a channel")
  - Direct deep-link to the relevant settings or external workspace admin page where applicable

### FR-4: Status API

- **FR-4.1** Expose a `GET /integrations/{provider}/status` endpoint returning connection state, token metadata (expiry, scopes), and per-resource channel link status.
- **FR-4.2** Response must include a `last_checked_at` timestamp.
- **FR-4.3** Endpoint must be callable by CI/CD pipelines and monitoring tools (API key auth supported).
- **FR-4.4** HTTP status codes must be semantically correct: `200` for any resolvable status (including degraded), `503` only for internal check failure.

### FR-5: Notifications & Alerts

- **FR-5.1** If connection status transitions to `Disconnected` or `Degraded`, send an in-app notification and email to workspace admins within 15 minutes.
- **FR-5.2** Do not send repeated alerts for the same unresolved issue within a 24-hour window (deduplication).

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a valid, active OAuth token, the integration page shows `Connected` within one polling cycle (≤ 5 min) of connection. |
| AC-2 | Given a revoked or expired token, the status updates to `Disconnected` within one polling cycle and the UI displays a "Re-authorize" CTA. |
| AC-3 | Given a channel is linked but the bot is removed, status updates to `Linked but Unreachable` with reason "Bot not in channel" displayed. |
| AC-4 | Given a channel is archived after being linked, status shows `Linked but Unreachable` with reason "Channel archived." |
| AC-5 | Given no channel is configured for a resource, status shows `Not Linked` and a "Link a Channel" CTA is displayed. |
| AC-6 | The `GET /integrations/{provider}/status` API returns a valid JSON response with `connection_status`, `channel_links[]`, and `last_checked_at` fields. |
| AC-7 | Workspace admin receives an in-app + email alert within 15 minutes of a connection transitioning to `Disconnected`. |
| AC-8 | A second alert for the same unresolved disconnection is not sent within 24 hours of the first. |
| AC-9 | Manual "Re-check" button triggers an immediate status refresh and updates the UI within 10 seconds. |
| AC-10 | Status checks work independently for Slack and Teams; an issue with one does not affect the displayed status of the other. |

---

## Out of Scope

- Initial OAuth setup / connection flow (covered by a separate Integration Setup PRD)
- Channel creation or bot installation automation
- Support for integrations other than Slack and Microsoft Teams (e.g., Google Chat, Discord)
- Message delivery confirmation / read receipts
- Audit logging of who changed channel link configuration
- Mobile app surface (web only for this iteration)
- SLA guarantees on real-time webhook delivery; this PRD covers status visibility only, not delivery reliability improvements