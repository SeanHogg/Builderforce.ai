> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #256
> _Each agent that updates this PRD signs its change below._

# PRD: Integration Connection — Guided Setup & Data Flow Validation

## Problem & Goal

Engineering and product teams adopting a new platform struggle to connect their existing toolchain (GitHub, Jira, Slack, CI/CD pipelines, monitoring services). Setup is fragmented, error-prone, and opaque — users complete configuration steps but have no confidence that data is actually flowing until something breaks later.

**Goal:** Deliver a guided, step-by-step integration setup experience that walks users through connecting each external service, validates credentials and webhooks in real time, and confirms live data flow before marking an integration as active.

---

## Target Users / ICP Roles

| Role | Pain Point |
|---|---|
| **Platform / DevOps Engineer** | Configuring webhooks, tokens, and service accounts across multiple tools is tedious and error-prone |
| **Engineering Manager** | Needs assurance that integrations are live before the team relies on them |
| **IT / Ops Administrator** | Responsible for security of credentials; needs audit trail of what was connected and by whom |
| **Product Manager (onboarding)** | Wants time-to-first-value minimised; integration failures stall adoption |

---

## Scope

This PRD covers the first-time and re-connection setup flow for the following integrations:

- **Source control:** GitHub (Cloud & Enterprise Server)
- **Project tracking:** Jira (Cloud & Data Center)
- **Messaging:** Slack
- **CI/CD:** GitHub Actions, Jenkins, CircleCI, GitLab CI
- **Monitoring / Observability:** PagerDuty, Datadog, New Relic

Scope includes credential entry, permission granting, webhook/event subscription configuration, real-time validation, live data-flow verification, and ongoing health status surfaced in a connection dashboard.

---

## Functional Requirements

### FR-1 — Integration Catalogue
- Display a catalogue of all supported integrations with name, logo, category, and current connection status (Not Connected / Connecting / Active / Degraded / Disconnected).
- Allow filtering by category (Source Control, Project Tracking, Messaging, CI/CD, Monitoring).
- Surface a prominent CTA to begin setup for any unconnected integration.

### FR-2 — Guided Setup Wizard
- Provide a multi-step wizard (≤ 6 steps) per integration with a visible progress indicator.
- Each step must include: purpose description, required inputs, inline help text, and links to external docs.
- Steps must be resumable; partial progress is persisted so users can leave and return.
- Support both OAuth 2.0 authorization flows and manual API token / webhook secret entry depending on integration type.

### FR-3 — Credential & Permission Validation
- After credential entry, immediately call the integration's API to verify:
  - Credentials are valid and not expired.
  - The authenticated identity has the minimum required permissions (e.g., repo read, webhook create).
- Display a clear success or failure state with a human-readable error message and remediation instructions within 5 seconds.
- Block progression to the next step on validation failure.

### FR-4 — Webhook & Event Subscription Setup
- For integrations that push data (GitHub, Jira, Slack, CI/CD), automatically create or guide creation of the required webhook/event subscription.
- Display the generated endpoint URL, secret token, and required event types in a copy-friendly UI component.
- Offer an automated registration path (platform creates webhook via API) where the integration supports it; fall back to manual instructions with verification step.

### FR-5 — Live Data-Flow Verification
- After webhook/subscription setup, prompt the user to trigger a test event in the source system (or trigger one automatically where supported).
- Display a real-time listener (polling or websocket) showing:
  - Waiting for event…
  - Event received — timestamp, event type, payload summary.
  - Verification passed / failed.
- Do not mark the integration Active until at least one valid test event has been received and parsed successfully.
- Provide a manual override ("Skip verification — mark active anyway") with a visible warning that data flow is unconfirmed; log this action in the audit trail.

### FR-6 — Integration Health Dashboard
- After activation, show each connected integration as a card with: status indicator, last event received timestamp, event volume (last 24 h), and latency metric.
- Surface alerts for: no events received in the last configurable window (default 1 hour), authentication errors (401/403), webhook delivery failures.
- Provide a "Re-validate" action per integration that re-runs FR-3 and FR-5 flows on demand.
- Allow authorized users to disconnect, rotate credentials, or reconfigure an integration.

### FR-7 — Notifications & Alerts
- Send an in-app and email notification to the configuring user when:
  - Setup is completed successfully.
  - An integration transitions to Degraded or Disconnected.
  - A credential is approaching expiration (configurable; default 14 days).
- Optionally route health alerts to a connected Slack channel once Slack integration is active.

### FR-8 — Audit & Security
- Log all create, update, disconnect, and override actions with: actor, timestamp, IP, and change summary.
- Credentials (API tokens, webhook secrets) must be stored encrypted at rest (AES-256) and never returned in plaintext after initial entry.
- Support scoped permission model: only Admins can connect/disconnect integrations; Members can view status.

---

## Acceptance Criteria

### Setup Wizard
- [ ] A user can initiate setup for any catalogue integration from zero prior configuration.
- [ ] Partially completed wizards are saved; returning to the page resumes from the last incomplete step.
- [ ] OAuth flow completes within the wizard without a full page redirect losing state.
- [ ] Manual token entry field masks input and never exposes the stored value after save.

### Validation
- [ ] Invalid credentials surface a specific, actionable error message within 5 seconds.
- [ ] Insufficient-permission errors identify exactly which permissions are missing.
- [ ] A wizard cannot advance past the credential step with a validation failure.

### Webhook / Data-Flow Verification
- [ ] Automated webhook registration succeeds for GitHub, Slack, PagerDuty, and Datadog (where API supports it).
- [ ] The live listener detects and displays a test event within 30 seconds of the event being sent.
- [ ] Integration status is set to Active only after a successful test event is received (or skip-verification override is explicitly chosen).
- [ ] Skip-verification override is recorded in the audit log.

### Health Dashboard
- [ ] All active integrations display last-event timestamp updated within 60 seconds of a new event.
- [ ] A Degraded alert fires and is visible in the dashboard within 5 minutes of the first missed event in the configured window.
- [ ] Re-validate completes full credential + data-flow check and updates status accordingly.

### Security & Access Control
- [ ] A Member-role user can view integration status but cannot see the edit/disconnect controls.
- [ ] Stored tokens are not present in any API response payload after initial creation.
- [ ] Audit log entries are present for every connection, disconnection, credential rotation, and skip-verification event.

---

## Out of Scope

- **Self-hosted / on-premise agent installation** for firewalled environments (planned for a subsequent release).
- **Integration marketplace / third-party developer SDK** for adding new integration types.
- **Bi-directional data write-back** (e.g., creating Jira tickets from within the platform) — connection scope is inbound data ingestion only.
- **SSO / SAML configuration** — handled by the Authentication settings module.
- **Billing or usage metering** tied to the number of integrations.
- **Mobile native app** setup flows — web responsive only at this stage.
- **Custom webhook transformations or field mapping** — out of scope for v1 setup; addressed in a Data Mapping PRD.