> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #337
> _Each agent that updates this PRD signs its change below._

# PRD: Auto-Detect Integration Gaps

## Problem & Goal

Developers and platform engineers connect third-party services (GitHub, Slack, PagerDuty, etc.) to the platform but frequently leave integrations in a partially configured state. A connected GitHub organization with no deploy webhooks, a Slack workspace with no alert routing rules, or a cloud provider with no cost-threshold notifications are all "connected but useless" configurations that silently fail when they matter most.

**Goal:** Automatically detect and surface incomplete or misconfigured integrations so users can resolve gaps before they cause incidents, missed notifications, or broken workflows — without waiting for a failure to reveal the problem.

---

## Target Users / ICP Roles

| Role | Pain Point |
|---|---|
| **Platform Engineer** | Sets up integrations once; gaps are invisible until production breaks |
| **DevOps / SRE** | Relies on webhooks and alerts being wired correctly; debugging silence is expensive |
| **Engineering Manager** | Needs confidence that observability and deployment pipelines are fully operational |
| **Developer (IC)** | Frustrated when PRs or deploys don't trigger expected automations |

---

## Scope

This feature applies to all first-party and officially supported third-party integrations managed within the platform. The initial release targets the five highest-volume integration categories:

1. Source control (GitHub, GitLab, Bitbucket)
2. CI/CD pipelines (GitHub Actions, CircleCI, Jenkins)
3. Cloud providers (AWS, GCP, Azure)
4. Incident management (PagerDuty, Opsgenie)
5. Communication (Slack, Microsoft Teams)

---

## Functional Requirements

### FR-1 — Gap Detection Engine

- The system **must** evaluate every connected integration against a per-integration checklist of required and recommended configuration steps.
- Detection **must** run automatically on a scheduled interval (default: every 6 hours) and also be triggerable on demand by any user with `integration:read` permission.
- Detection **must** run automatically immediately after any integration is first connected or its credentials are updated.
- Gap checks **must** be versioned so that new checks added after an integration was connected are evaluated retroactively.

### FR-2 — Gap Classification

Each detected gap **must** be classified by:

| Attribute | Values |
|---|---|
| **Severity** | `critical`, `warning`, `informational` |
| **Category** | `missing_webhook`, `missing_permission`, `incomplete_routing`, `stale_credential`, `misconfiguration` |
| **Status** | `open`, `acknowledged`, `resolved` |

- `critical` gaps are those that completely prevent a core workflow (e.g., no deploy webhook means zero deploy events reach the platform).
- `warning` gaps are those that degrade but do not block functionality.
- `informational` gaps are best-practice recommendations.

### FR-3 — Gap Catalog

- The platform **must** maintain a human-readable catalog of all possible gap checks, grouped by integration type.
- Each catalog entry **must** include: gap ID, name, description, severity, remediation steps (plain text + deeplink to the relevant settings page), and the API/event signal used to detect it.
- The catalog **must** be extensible by internal teams without requiring a platform release (configuration-driven).

**Minimum checks at launch (illustrative, not exhaustive):**

| Integration | Gap | Severity |
|---|---|---|
| GitHub | No `push` or `deployment` webhook configured | critical |
| GitHub | Webhook secret not set | critical |
| GitHub | `pull_request` webhook missing | warning |
| GitHub Actions | No workflow connected to a monitored repo | warning |
| AWS | No CloudTrail log destination configured | critical |
| AWS | Cost anomaly alert threshold not set | warning |
| PagerDuty | No escalation policy linked to a service | critical |
| Slack | No channel mapped to any alert rule | critical |
| Slack | Bot token missing `channels:read` scope | critical |

### FR-4 — User-Facing Gap Dashboard

- A dedicated **Integrations Health** view **must** list all connected integrations with a status badge: `Healthy`, `Needs Attention`, or `Critical`.
- Selecting an integration **must** expand to show all open gaps for that integration, each with its severity, description, and a one-click remediation link.
- Users **must** be able to acknowledge a gap with an optional note (suppresses repeated notifications for 7 days; does not resolve the gap).
- Filters **must** be available for: severity, category, integration type, and status.

### FR-5 — Proactive Notifications

- When a `critical` gap is newly detected, the platform **must** send a notification within 5 minutes to:
  - The user who connected the integration.
  - Any user with the `org:admin` or `integrations:manage` role.
- Notification channels **must** include: in-app notification, email. Slack/Teams delivery **must** be available if those integrations are themselves healthy.
- `warning` gaps **must** trigger a daily digest (default: 09:00 user's local time) rather than immediate alerts.
- `informational` gaps **must** appear only in the dashboard; no push notifications.

### FR-6 — Gap Resolution Detection

- The detection engine **must** re-evaluate an integration within 10 minutes of any configuration change event received from the provider (e.g., GitHub webhook ping, OAuth token refresh).
- When a gap transitions from `open` to `resolved`, affected users **must** receive a resolution notification via the same channel as the original alert.
- Resolved gaps **must** be retained in audit history for 90 days.

### FR-7 — API Access

- All gap data **must** be accessible via REST API (`GET /integrations/{id}/gaps`, `GET /gaps?severity=critical`).
- The API **must** support filtering by severity, status, integration ID, and category.
- API responses **must** include pagination and conform to the platform's existing API contract standards.

### FR-8 — Permissions

- Reading gap data requires `integration:read`.
- Acknowledging a gap requires `integration:write`.
- No user may suppress or delete gap records permanently; acknowledgement is the only suppression mechanism.

---

## Acceptance Criteria

1. **Detection coverage:** All FR-3 launch checks are implemented and pass automated contract tests verifying correct gap IDs, severities, and remediation links.
2. **Scheduled detection:** The detection engine runs for all connected integrations on a 6-hour cadence with ≤ 2-minute jitter; verified by monitoring logs.
3. **On-connect detection:** A gap check completes within 60 seconds of a new integration being saved; verified by integration test.
4. **Critical notification latency:** A `critical` gap notification is delivered to all target recipients within 5 minutes of detection in ≥ 99% of cases under normal load.
5. **Dashboard accuracy:** The Integrations Health dashboard reflects the current gap state with data no older than 10 minutes, verified by end-to-end test.
6. **Acknowledgement:** A user with `integration:write` can acknowledge a gap; the gap status updates to `acknowledged` immediately and the gap does not re-trigger notifications for 7 days unless severity escalates.
7. **Resolution detection:** When a previously detected gap is remediated in the provider (e.g., webhook added), the platform marks it `resolved` within 10 minutes of receiving the provider change event or within 6 hours if no event is received.
8. **API correctness:** All `/gaps` endpoints return correct data, honour filter parameters, and conform to the API schema; verified by contract tests with ≥ 95% coverage of documented fields.
9. **Catalog extensibility:** A new gap check can be added via configuration (no code deployment) and is evaluated in the next scheduled detection run; verified by a canary check in staging.
10. **Audit retention:** Resolved gaps remain queryable via API for 90 days after resolution.
11. **No false positives baseline:** False-positive rate for `critical` gaps across the launch check set is < 1% measured over the first 30 days post-launch.

---

## Out of Scope

- **Custom / community integrations** not officially supported by the platform — gap checks for these are not included in v1.
- **Auto-remediation** — the system surfaces gaps and guides users to fix them; it does not automatically modify provider configuration on the user's behalf.
- **Security vulnerability scanning** of integration tokens or secrets beyond staleness detection.
- **Cross-integration dependency mapping** (e.g., "your PagerDuty gap affects your on-call Slack workflow") — considered for a future graph-based health model.
- **SLA or compliance reporting** built on top of gap data.
- **Mobile push notifications** for gap alerts.
- **Bulk acknowledgement** of multiple gaps simultaneously.
- **Provider-side configuration changes** initiated from within the platform (e.g., creating a webhook in GitHub directly from the remediation UI) — deeplinks to provider settings pages are the v1 remediation UX.