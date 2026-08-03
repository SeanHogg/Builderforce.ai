> **PRD** — drafted by Ada (Sr. Product Mgr) · task #576
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Secrets Lifecycle Policy Verification

## Problem & Goal
Organizations use many secrets (API keys, passwords, certificates, tokens) across diverse systems, but lack automated assurance that secrets are created, rotated, and revoked according to defined security policies. Manual audits are slow, error-prone, and leave gaps that increase risk of credential leaks or misuse.  

**Goal:** Provide a continuous, automated verification capability that ingests secret metadata, evaluates it against configurable lifecycle policies, and surfaces non-compliance through alerts and dashboards. This reduces security risk, accelerates incident response, and simplifies audit evidence collection.

## Target Users / ICP Roles
- **Security Engineers / DevSecOps** – need continuous policy compliance visibility and fast remediation signals.  
- **Compliance Officers & Auditors** – require proof that secrets lifecycles meet standards (SOC2, ISO 27001, etc.).  
- **Platform Engineers** – operate the secret stores and want to trust that policies are consistently monitored.  
- **Incident Responders** – need to quickly identify policy-violating secrets during a breach investigation.

## Scope
- Connect to common secret managers (Vault, AWS Secrets Manager, GCP Secret Manager, Kubernetes Secrets, etc.) to discover secrets and collect metadata.  
- Define lifecycle policies for creation (e.g., minimum strength), rotation (e.g., max age), and revocation (e.g., on user offboarding).  
- Continuously evaluate secrets against applicable policies and mark them as compliant, non-compliant, or unknown.  
- Generate notifications and expose dashboards/reports showing compliance posture.  
- Provide APIs for integration into existing workflows (SIEM, ticketing, alerting channels).

## Functional Requirements

### 1. Policy Definition & Management
- CRUD operations for policies via UI and API.  
- Policies include conditions such as: rotation interval (days), maximum age before revocation, required strength (length/complexity), auto‑revocation trigger on user disable or environment decommission.  
- Scoping: policies can target specific secret types, environments, tags, or owners.  
- Change history and versioning for all policies.

### 2. Secrets Discovery & Metadata Collection
- Pluggable connectors to at least: HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Kubernetes Secrets.  
- Ingest metadata: creation time, last rotation time, secret type, owner, environment, active status.  
- Maintain a normalized inventory; update via periodic sync (configurable interval) or event‑driven webhooks where supported.

### 3. Compliance Evaluation Engine
- Evaluate every secret against all matching policies on a schedule (default daily) and on event triggers (new secret detected, policy change, identity provider event for revocation checks).  
- Compute state: `Compliant`, `NonCompliant` (with clear reason like “rotation overdue by 5 days”), `Exempt` (policy waived for that secret), `Unknown` (metadata missing).  
- Log an audit trail of state changes.

### 4. Alerting & Notification
- Configurable rules: severity (critical, high, medium, low), notification channels (email, Slack, PagerDuty, generic webhook).  
- Alert on first detection of non-compliance and optionally after a configurable persistence threshold (e.g., alert again if still non-compliant after 7 days).  
- Support delivery to multiple channels and role‑based routing.

### 5. Dashboards & Reporting
- Real‑time overview: overall compliance percentage, breakdown by policy, environment, owner, secret type.  
- Drill‑down to individual non‑compliant secrets showing violation details, history, and recommended action.  
- Exportable reports (CSV, PDF) for audit evidence; ability to schedule periodic report delivery.  
- Integration-ready data streaming (e.g., syslog, Kafka) for SIEM tools.

### 6. Access Control & Multi‑Tenancy
- Role‑based access (viewer, editor, admin).  
- Scope data visibility by team, department, or environment (multi‑tenant support).

### 7. API & Extensibility
- RESTful APIs for querying secret compliance status, policy violations, and inventory.  
- API authentication via API keys or OAuth.  
- Webhook triggers for evaluation events that can be consumed by external systems.

## Acceptance Criteria
1. **Ingestion** – Successfully connect to at least two secret managers (e.g., Vault and AWS Secrets Manager) and display an accurate inventory of secrets with metadata within 1 hour of setup.  
2. **Rotation Policy** – Define a policy requiring rotation every 90 days. A secret with `last_rotation` > 90 days is flagged as non‑compliant within one evaluation cycle (≤ 24 hours).  
3. **Revocation Policy** – Define a policy that requires secrets owned by a disabled user to be revoked. Simulate a user disablement in an identity provider; the system detects that the user’s secrets remain active and marks them non‑compliant.  
4. **Alerting** – When a secret becomes non‑compliant, an alert is sent to the configured Slack channel within 5 minutes of detection, containing secret identifier, policy violated, and violation reason.  
5. **Dashboard** – Dashboard shows a “95% compliant” tile for a test environment with 100 secrets, where 5 have overdue rotation; drill‑down lists the 5 non‑compliant secrets with details.  
6. **API** – API endpoint `/api/v1/compliance/violations` returns a paginated list of non‑compliant secrets, filterable by policy and environment, with HTTPS and valid authentication.  
7. **Scale** – System evaluates 100,000 secrets against 50 policies within 30 minutes without errors.

## Out of Scope
- **Automatic remediation** – rotating or revoking secrets automatically. This product only verifies and alerts.  
- **Secret creation or storage** – no new secret generation interface, no secret values stored.  
- **Anomaly detection on secret usage** – no analysis of access patterns or misuse detection.  
- **Lifecycle orchestration** – no built‑in rotation workflows or integration to trigger rotations.  
- **Policies for non‑secret assets** (e.g., certificate trust chains, server configurations).

## Requirements
> Authored by: Business Analyst · task #576

### Requirement Taxonomy
Each requirement is identified by a unique ID (`REQ-SLP-###`), assigned a priority (P0 = must-have for MVP, P1 = core, P2 = important, P3 = nice-to-have), and traced to its parent Functional Requirement section (FR-1…FR-7) and Acceptance Criterion (AC-1…AC-7).

---

### R1 — Policy CRUD & Lifecycle (FR-1)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-001** | The system SHALL provide a REST API (`POST /api/v1/policies`) to create a new lifecycle policy with at minimum: name, description, policy type (rotation / revocation / creation-strength), condition parameters, scope selectors, and severity level. | P0 | FR-1, AC-2, AC-3 |
| **REQ-SLP-002** | The system SHALL provide a REST API (`GET /api/v1/policies` and `GET /api/v1/policies/{id}`) to list and retrieve policies with full detail including current version number, creator, timestamps, and active/inactive status. | P0 | FR-1 |
| **REQ-SLP-003** | The system SHALL provide a REST API (`PUT /api/v1/policies/{id}`) to update a policy; every update SHALL increment the policy version and record the change in an immutable audit log (who, when, what fields changed). | P0 | FR-1 |
| **REQ-SLP-004** | The system SHALL provide a REST API (`DELETE /api/v1/policies/{id}`) to soft-delete (deactivate) a policy; hard deletion SHALL be prohibited. Deactivated policies SHALL still appear in history views with a `deactivated` status. | P1 | FR-1 |
| **REQ-SLP-005** | The system SHALL provide a browser-based UI for policy CRUD operations, displaying policy list with status indicators, a policy editor form with validation, and a policy detail view showing full configuration and change history. | P1 | FR-1 |
| **REQ-SLP-006** | A policy condition SHALL support at minimum these parameter types: rotation max-age (days), revocation trigger (on `user.disabled` / `environment.decommissioned` / `tag.removed`), minimum secret strength (length in characters, required character classes). | P0 | FR-1, AC-2, AC-3 |
| **REQ-SLP-007** | Policy scoping SHALL support targeting by: secret type (e.g., `api_key`, `certificate`, `password`, `token`), environment label (e.g., `production`, `staging`, `development`), tag key-value pairs, and owner identity (user / service account). An unscoped policy SHALL apply to all secrets. | P0 | FR-1 |
| **REQ-SLP-008** | Every policy version SHALL be retrievable via `GET /api/v1/policies/{id}/versions` and `GET /api/v1/policies/{id}/versions/{version}` for full audit trail. | P1 | FR-1 |

---

### R2 — Secrets Discovery & Connectors (FR-2)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-010** | The system SHALL provide a connector plugin interface (gRPC or HTTP contract) that third-party connector implementations must satisfy: `Discover()` returning a stream of `SecretMetadata`, and `HealthCheck()` returning connectivity status. | P0 | FR-2, AC-1 |
| **REQ-SLP-011** | The system SHALL ship with at least two built-in connectors: HashiCorp Vault (KV v2 engine) and AWS Secrets Manager. Each connector SHALL authenticate via the secret manager's native mechanism (Vault token/AppRole, AWS IAM role). | P0 | FR-2, AC-1 |
| **REQ-SLP-012** | The system SHALL ship with connectors for GCP Secret Manager and Kubernetes Secrets as P1 deliverables (must be available within one release cycle after MVP). | P1 | FR-2 |
| **REQ-SLP-013** | Every discovered secret SHALL be normalized into a canonical `SecretMetadata` record containing: `secret_id` (source-specific identifier), `name`, `type`, `owner` (user/service account reference), `environment`, `tags` (map), `created_at`, `last_rotated_at`, `expires_at` (nullable), `status` (active / inactive / pending_deletion). | P0 | FR-2, AC-1 |
| **REQ-SLP-014** | The system SHALL maintain a normalized inventory table; each sync cycle SHALL upsert secrets by source+secret_id and soft-delete secrets no longer present at the source (mark `inventory_status = 'removed'` with timestamp). Removed secrets SHALL be retained for audit for at least 90 days. | P0 | FR-2 |
| **REQ-SLP-015** | Secret values SHALL NOT be stored. The system SHALL only collect and persist metadata (name, type, owner, timestamps, tags, status). Any connector implementation that accidentally retrieves a secret value SHALL drop it before persisting. | P0 | FR-2 (aligns with Out of Scope) |
| **REQ-SLP-016** | Periodic sync interval SHALL be configurable per connector (default: 6 hours, minimum: 15 minutes, maximum: 7 days). Each sync SHALL log start time, end time, secrets discovered, secrets added, secrets removed, and any errors. | P1 | FR-2 |
| **REQ-SLP-017** | Connectors SHALL support event-driven (webhook) triggers where the upstream secret manager supports them; the system SHALL expose a webhook endpoint (`POST /api/v1/connectors/{id}/webhook`) to receive push notifications and trigger immediate re-sync. | P2 | FR-2 |

---

### R3 — Compliance Evaluation Engine (FR-3)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-020** | The evaluation engine SHALL evaluate every active secret against every active policy whose scope matches the secret. Evaluation SHALL produce exactly one of four states per secret-policy pair: `Compliant`, `NonCompliant`, `Exempt`, or `Unknown`. | P0 | FR-3 |
| **REQ-SLP-021** | For `NonCompliant` results, the system SHALL record a machine-readable reason code (e.g., `ROTATION_OVERDUE`, `OWNER_DISABLED`, `EXPIRED`, `WEAK_STRENGTH`, `MISSING_ROTATION_TIMESTAMP`) and a human-readable description (e.g., "Rotation overdue by 12 days — last rotated 2026-03-15, max allowed age 90 days"). | P0 | FR-3, AC-2, AC-3 |
| **REQ-SLP-022** | The `Unknown` state SHALL be assigned when required metadata for a policy condition is absent (e.g., a rotation-age policy applied to a secret with no `last_rotated_at` timestamp). The system SHALL include the specific missing field in the reason. | P0 | FR-3 |
| **REQ-SLP-023** | The `Exempt` state SHALL be assignable manually (via API/UI `POST /api/v1/secrets/{id}/exemptions`) with a required justification, expiry date, and approver reference. Exemptions SHALL be logged in the audit trail. | P1 | FR-3 |
| **REQ-SLP-024** | The system SHALL run a full evaluation cycle on a configurable schedule (default: daily at 02:00 UTC). The maximum duration for a full cycle SHALL be 30 minutes for 100,000 secrets against 50 policies (per AC-7). | P0 | FR-3, AC-7 |
| **REQ-SLP-025** | The system SHALL trigger immediate re-evaluation on these events: (a) a new secret is discovered by a connector sync, (b) a policy is created or updated, (c) a revocation-trigger event is received (user disabled, environment decommissioned). Event-triggered evaluation SHALL complete within 5 minutes of the triggering event. | P0 | FR-3, AC-4 |
| **REQ-SLP-026** | Every state transition for a secret-policy pair (e.g., `Compliant → NonCompliant`, `NonCompliant → Compliant`) SHALL be recorded as an immutable audit event with: timestamp, secret_id, policy_id, previous state, new state, reason, evaluation cycle ID. | P0 | FR-3 |
| **REQ-SLP-027** | The evaluation engine SHALL support a dry-run mode (`POST /api/v1/evaluate/dry-run`) accepting a policy definition and optional scope; it SHALL return which secrets would become non-compliant without persisting results. | P2 | FR-3 |

---

### R4 — Alerting & Notification (FR-4)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-030** | The system SHALL support creation of alert rules via API (`POST /api/v1/alert-rules`) that bind a severity level (critical / high / medium / low), one or more notification channels, an optional scope filter (policy IDs, environment, secret type), and an optional persistence threshold (re-alert after N days of continuous non-compliance). | P0 | FR-4, AC-4 |
| **REQ-SLP-031** | Notification channels SHALL include at minimum: email (SMTP), Slack (incoming webhook), PagerDuty (Events API v2), and generic webhook (HTTP POST with configurable headers and payload template). | P0 | FR-4, AC-4 |
| **REQ-SLP-032** | When a secret transitions to `NonCompliant` for the first time, the system SHALL evaluate all matching alert rules and dispatch notifications to all configured channels within 5 minutes of detection. | P0 | FR-4, AC-4 |
| **REQ-SLP-033** | Each alert notification SHALL contain: secret identifier (name + source), policy name, violation reason, severity level, timestamp of detection, and a direct link to the violation detail in the dashboard. | P0 | FR-4, AC-4 |
| **REQ-SLP-034** | After the initial alert, if the secret remains `NonCompliant` for longer than the configured persistence threshold, the system SHALL send a re-alert. If no persistence threshold is configured, re-alerting SHALL NOT occur. | P1 | FR-4 |
| **REQ-SLP-035** | The system SHALL log every notification dispatch (channel, timestamp, success/failure, payload summary) for auditability. Failed deliveries SHALL be retried with exponential backoff (maximum 3 retries over 15 minutes), and persistent failures SHALL be surfaced on a notification health dashboard. | P1 | FR-4 |
| **REQ-SLP-036** | Alert rules SHALL support role-based routing: rules can be scoped so that violations in environment `production` route to a PagerDuty escalation policy, while `staging` violations route only to a Slack channel. | P2 | FR-4 |

---

### R5 — Dashboards & Reporting (FR-5)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-040** | The system SHALL provide a real-time compliance overview dashboard showing: overall compliance percentage (compliant / total evaluated), trend sparkline (last 30 days), breakdown by policy, breakdown by environment, breakdown by owner, and breakdown by secret type. The dashboard SHALL refresh data at most every 60 seconds. | P0 | FR-5, AC-5 |
| **REQ-SLP-041** | The dashboard SHALL include a summary tile displaying: "X% compliant — Y of Z secrets compliant" where X is the percentage rounded to one decimal place. | P0 | FR-5, AC-5 |
| **REQ-SLP-042** | The dashboard SHALL provide a drill-down from any summary tile to a filtered violations list showing: secret name, policy name, violation reason, duration of non-compliance, severity, and a "View Details" action. | P0 | FR-5, AC-5 |
| **REQ-SLP-043** | The violations detail view SHALL display: full secret metadata, full policy details, complete state change history for that secret-policy pair, and any exemption records. | P1 | FR-5 |
| **REQ-SLP-044** | The system SHALL support scheduled report generation: a user can configure a report (CSV or PDF format) with selected filters (environment, policy, time range) and a delivery schedule (daily, weekly, monthly) to one or more email addresses. | P2 | FR-5 |
| **REQ-SLP-045** | The system SHALL expose a streaming endpoint (Server-Sent Events or WebSocket) at `GET /api/v1/compliance/stream` that pushes real-time compliance state changes as JSON events for integration with SIEM tools and external dashboards. Event format SHALL include: event type, timestamp, secret_id, policy_id, old state, new state, reason. | P2 | FR-5 |
| **REQ-SLP-046** | All dashboard data SHALL be filterable by at minimum: environment, secret type, policy, owner, compliance state, and severity level. Filters SHALL be combinable (AND logic). | P1 | FR-5 |

---

### R6 — Access Control & Multi-Tenancy (FR-6)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-050** | The system SHALL enforce three built-in roles: `viewer` (read-only access to dashboards, reports, and API GET endpoints), `editor` (viewer + create/update policies, manage exemptions, configure alert rules), `admin` (editor + manage connectors, configure system settings, manage users and role assignments). | P0 | FR-6 |
| **REQ-SLP-051** | The system SHALL support multi-tenancy: data visibility SHALL be scopable by organization/tenant. A user in tenant A SHALL NOT see secrets, policies, violations, or alerts belonging to tenant B unless explicitly granted cross-tenant access. | P0 | FR-6 |
| **REQ-SLP-052** | Within a tenant, data visibility SHALL be further scopable by team, department, and environment. A user scoped to environment `staging` SHALL NOT see `production` secrets or their violations. | P1 | FR-6 |
| **REQ-SLP-053** | Authentication SHALL support at minimum: local username/password (with MFA TOTP), OAuth 2.0 / OIDC (supporting common providers: Okta, Azure AD, Google Workspace), and API key authentication for machine-to-machine access. | P0 | FR-6, AC-6 |
| **REQ-SLP-054** | All API endpoints SHALL be served exclusively over HTTPS (TLS 1.2 minimum, TLS 1.3 preferred). HTTP (plaintext) requests SHALL be rejected or redirected. | P0 | FR-6, AC-6 |

---

### R7 — API & Extensibility (FR-7)

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-060** | The system SHALL expose a paginated violations endpoint: `GET /api/v1/compliance/violations` returning a JSON array of violation objects, each containing `secret_id`, `secret_name`, `policy_id`, `policy_name`, `state`, `reason_code`, `reason_description`, `detected_at`, `severity`. | P0 | FR-7, AC-6 |
| **REQ-SLP-061** | The `GET /api/v1/compliance/violations` endpoint SHALL support query parameters: `policy_id` (exact match), `environment` (exact match), `secret_type` (exact match), `severity` (exact match), `state` (default: `NonCompliant`), `page` (default: 1), `page_size` (default: 50, max: 200). | P0 | FR-7, AC-6 |
| **REQ-SLP-062** | The system SHALL expose `GET /api/v1/secrets` (paginated inventory), `GET /api/v1/secrets/{id}` (single secret with metadata and current compliance status across all matching policies). | P0 | FR-7 |
| **REQ-SLP-063** | The system SHALL expose `GET /api/v1/compliance/summary` returning: total secrets, total evaluated, compliant count, non-compliant count, exempt count, unknown count, compliance percentage, and last evaluation cycle timestamp. | P0 | FR-7 |
| **REQ-SLP-064** | All API responses SHALL follow a consistent envelope: `{ "data": ..., "meta": { "page": N, "page_size": N, "total": N, "total_pages": N }, "errors": [] }`. Errors SHALL include an HTTP status code, a machine-readable error code, and a human-readable message. | P0 | FR-7 |
| **REQ-SLP-065** | The system SHALL expose webhook configuration for outbound events: users can register a URL to receive HTTP POST callbacks on evaluation completion, state changes, or new violation detection. Webhook deliveries SHALL include a signature header (`X-SLP-Signature`) for payload verification using a shared secret. | P2 | FR-7 |
| **REQ-SLP-066** | The system SHALL provide an OpenAPI 3.0 specification document at `GET /api/v1/openapi.json` describing all endpoints, request/response schemas, and authentication requirements. | P1 | FR-7 |
| **REQ-SLP-067** | API rate limiting SHALL be enforced: default 1000 requests per minute per authenticated principal, configurable by tenant. Rate-limited responses SHALL return HTTP 429 with a `Retry-After` header. | P1 | FR-7 |

---

### R8 — Non-Functional Requirements

| ID | Requirement | Priority | Traces To |
|----|------------|----------|-----------|
| **REQ-SLP-070** | **Performance:** The system SHALL evaluate 100,000 secrets against 50 policies within 30 minutes (per AC-7). Dashboard queries SHALL return within 2 seconds for datasets up to 1,000,000 secret-policy evaluations. | P0 | AC-7 |
| **REQ-SLP-071** | **Availability:** The system SHALL target 99.5% uptime (allowing <= 3.65 hours of downtime per month). Scheduled maintenance windows SHALL be configurable and communicated to tenants. | P1 | — |
| **REQ-SLP-072** | **Data Retention:** Evaluation audit logs SHALL be retained for a minimum of 1 year. Secret metadata for removed secrets SHALL be retained for a minimum of 90 days. Policy version history SHALL be retained indefinitely. | P1 | — |
| **REQ-SLP-073** | **Encryption:** All data at rest (secret metadata, policy definitions, audit logs, user credentials) SHALL be encrypted using AES-256 or equivalent. TLS 1.2+ SHALL encrypt all data in transit. | P0 | — |
| **REQ-SLP-074** | **Backup & Recovery:** The system SHALL perform automated daily backups of all persistent state. Recovery Point Objective (RPO) SHALL be ≤ 24 hours; Recovery Time Objective (RTO) SHALL be ≤ 4 hours. | P1 | — |
| **REQ-SLP-075** | **Observability:** The system SHALL emit structured logs (JSON format), metrics (Prometheus-compatible at `/metrics`), and distributed traces (OpenTelemetry). Logs SHALL include correlation IDs for end-to-end request tracing. | P1 | — |
| **REQ-SLP-076** | **Accessibility:** The web dashboard SHALL meet WCAG 2.1 Level AA compliance. | P2 | — |

---

### Traceability Matrix

| Acceptance Criterion | Primary Requirements |
|---------------------|---------------------|
| AC-1 — Ingestion | REQ-SLP-010, REQ-SLP-011, REQ-SLP-013, REQ-SLP-014 |
| AC-2 — Rotation Policy | REQ-SLP-001, REQ-SLP-006, REQ-SLP-021 |
| AC-3 — Revocation Policy | REQ-SLP-001, REQ-SLP-006, REQ-SLP-021 |
| AC-4 — Alerting | REQ-SLP-025, REQ-SLP-030, REQ-SLP-031, REQ-SLP-032, REQ-SLP-033 |
| AC-5 — Dashboard | REQ-SLP-040, REQ-SLP-041, REQ-SLP-042 |
| AC-6 — API | REQ-SLP-053, REQ-SLP-054, REQ-SLP-060, REQ-SLP-061 |
| AC-7 — Scale | REQ-SLP-024, REQ-SLP-070 |

### Priority Summary

| Priority | Definition | Count |
|----------|-----------|-------|
| **P0** | Must-have for MVP; system cannot ship without these. | 25 |
| **P1** | Core capability; required within one release after MVP. | 14 |
| **P2** | Important differentiator; scheduled post-MVP. | 7 |
| **P3** | Nice-to-have; backlog for future consideration. | 0 |

**Total Requirements:** 46

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._