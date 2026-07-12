> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #328
> _Each agent that updates this PRD signs its change below._

# PRD: CI/CD Pipeline Connectivity & Deploy Data Observability

## Problem & Goal

Engineering teams lack a reliable, unified way to verify that CI/CD systems (GitHub Actions, Jenkins, CircleCI, GitLab CI, etc.) are **actively connected** to the platform and that **deploy event data is flowing end-to-end** without gaps, failures, or silent drops. This creates blind spots in deployment tracking, DORA metrics, change-failure correlation, and incident attribution.

**Goal:** Deliver a diagnostic and monitoring capability that confirms CI/CD integrations are authenticated, reachable, and emitting well-formed deploy payloads — and surfaces actionable remediation when they are not.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform / DevOps Engineer** | Validate integration wiring during setup and ongoing ops |
| **Engineering Manager** | Confirm deploy data is complete enough for DORA / velocity reporting |
| **Site Reliability Engineer (SRE)** | Correlate deploys with incidents; needs zero data gaps |
| **Developer (IC)** | Understand why a deploy event didn't appear in the UI |

---

## Scope

### In Scope

- Health-check and connectivity status for supported CI/CD integrations:
  - GitHub Actions
  - Jenkins
  - GitLab CI/CD
  - CircleCI
  - Buildkite
  - Azure DevOps Pipelines
- Deploy event ingestion validation (schema, required fields, delivery confirmation)
- Real-time and historical deploy data flow visibility
- Alerting on integration failures, stale connections, and dropped events
- Remediation guidance surfaced in-product

### Out of Scope

*(see dedicated section below)*

---

## Functional Requirements

### FR-1 — Integration Connection Status

- **FR-1.1** The system MUST display a per-integration connection status: `Connected`, `Degraded`, `Disconnected`, or `Never Configured`.
- **FR-1.2** Status MUST reflect the most recent successful handshake or webhook receipt, with a timestamp.
- **FR-1.3** The system MUST detect credential/token expiry and surface it as a distinct `Auth Failed` sub-state.
- **FR-1.4** For webhook-based integrations (GitHub Actions, Jenkins), the system MUST record the last inbound webhook timestamp and payload hash.
- **FR-1.5** For polling-based integrations, the system MUST log the last successful poll cycle timestamp and result count.

### FR-2 — Deploy Data Flow Validation

- **FR-2.1** Every inbound deploy event MUST be validated against a canonical deploy schema (service name, environment, deploy ID, timestamp, status, commit SHA).
- **FR-2.2** The system MUST emit an ingest receipt (acknowledgment) per event, including validation pass/fail and any field-level errors.
- **FR-2.3** The system MUST track and display an **event delivery rate** (events received / events expected) per integration per time window (1 h, 24 h, 7 d).
- **FR-2.4** The system MUST flag a `Data Gap` when no deploy events are received from an integration that had prior activity, within a configurable silence threshold (default: 24 h).
- **FR-2.5** Failed or malformed events MUST be quarantined, logged with full payload, and made inspectable for up to 30 days.

### FR-3 — Diagnostic Tooling

- **FR-3.1** A **Test Connection** action MUST be available per integration, triggering an end-to-end synthetic probe and returning a pass/fail result within 10 seconds.
- **FR-3.2** A **Deploy Event Inspector** view MUST allow users to search, filter, and inspect raw and parsed deploy events by integration, time range, service, and environment.
- **FR-3.3** The system MUST provide a structured error log per integration showing the last 100 errors with error code, message, affected field, and timestamp.

### FR-4 — Alerting & Notifications

- **FR-4.1** The system MUST support configurable alerts for: `Integration Disconnected`, `Auth Expired`, `Data Gap Detected`, `High Validation Error Rate` (threshold: >5% of events in a 1 h window).
- **FR-4.2** Alerts MUST be deliverable to: in-app notification center, email, Slack, PagerDuty.
- **FR-4.3** Alert suppression / snooze MUST be supported (minimum granularity: 1 h, up to 7 d).

### FR-5 — Remediation Guidance

- **FR-5.1** Each error state MUST link to a context-aware remediation guide (inline or doc link) specific to the integration type and error class.
- **FR-5.2** The system MUST provide a **Setup Checklist** per integration type confirming: webhook URL registered, secret configured, required scopes granted, test event received.

### FR-6 — Audit & History

- **FR-6.1** All connection state changes MUST be logged in an immutable audit trail with actor (user or system), timestamp, and previous/new state.
- **FR-6.2** Deploy event volume metrics MUST be retained for a minimum of 90 days for trend analysis.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a correctly configured GitHub Actions integration, the connection status displays `Connected` within 60 seconds of the first successful webhook receipt. |
| AC-2 | Given an expired API token, the status updates to `Auth Failed` within one polling cycle (≤ 5 min) and an alert is dispatched. |
| AC-3 | Given a deploy event missing a required field (`service_name`), the event is quarantined, a validation error is logged, and the ingest receipt reflects `FAILED` with field-level detail. |
| AC-4 | Given no deploy events received for 24 h from a previously active integration, a `Data Gap` alert fires and appears in the in-app notification center. |
| AC-5 | The Test Connection action returns a pass/fail result in ≤ 10 seconds for all supported integration types. |
| AC-6 | The Deploy Event Inspector returns filtered results within 3 seconds for queries spanning up to 7 days of data. |
| AC-7 | A user can trace any deploy event from CI/CD source → ingest → parsed record without leaving the product UI. |
| AC-8 | Setup Checklist for each supported integration type shows 100% completion state only when all prerequisite conditions are verified programmatically (not self-reported). |
| AC-9 | All connection state changes appear in the audit log within 60 seconds of occurrence. |
| AC-10 | Alerts are delivered to Slack within 2 minutes of the triggering condition being confirmed. |

---

## Out of Scope

- **Build log ingestion or artifact storage** — integration tracks deploy events only, not full pipeline logs.
- **CI/CD pipeline configuration management** — the system observes pipelines; it does not create, modify, or trigger them.
- **Custom / homegrown CI systems** — only the named supported integrations are in scope for this iteration; generic webhook support is a future phase.
- **Deploy approval workflows** — not a gating or change-management tool.
- **Cost or resource usage analytics** for CI/CD pipelines.
- **Code diff or PR content analysis** as part of deploy event processing.
- **Multi-region data residency** configuration — addressed in a separate infrastructure PRD.
- **Mobile UI** for the diagnostic views — web only in this release.