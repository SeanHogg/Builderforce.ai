> **PRD** — drafted by Ada (Sr. Product Mgr) · task #578
> _Each agent that updates this PRD signs its change below._
>
> _Business Analyst sign-off — see Requirements section._

# Product Requirements Document: Secret Expiry & Rotation Enforcement and Auditing

## Problem & Goal
Organizations struggle with secrets (API keys, certificates, passwords) that never expire, are rotated inconsistently, or lack audit trails. This creates security risks (credential sprawl, long-lived access) and compliance gaps.  
**Goal:** Provide a system that enforces expiry and rotation schedules for all managed secrets, with full auditability to prove compliance and detect misconfigurations.

## Target Users / ICP Roles
- **Security Engineers** – define policies, monitor compliance, respond to incidents.
- **DevOps / Platform Engineers** – integrate secret rotation into CI/CD and infrastructure automation.
- **Compliance Officers / Auditors** – review audit logs to verify that secrets are managed per policy.

## Scope
- Define expiration dates and rotation intervals per secret type and sensitivity level.
- Enforce automatic rotation before expiry (or alert on manual rotation miss).
- Generate tamper-proof audit logs for all lifecycle events (creation, rotation, expiry, access).
- Provide dashboards and reports for policy compliance status.

## Functional Requirements
- **Policy Definition**: Administrators can configure expiry durations and rotation intervals (e.g., “rotate every 90 days, expire after 1 year”) per secret category.
- **Expiry Enforcement**:
  - System flags expired secrets and blocks their use in dependent workflows (unless explicit exception).
  - Notifications (email/Slack/webhook) are sent before and after expiry.
- **Rotation Enforcement**:
  - Secrets can be set to auto-rotate via integrated services (e.g., generate new key, deploy to workload).
  - For manual rotation, system tracks due date and sends escalating reminders until rotation is confirmed.
  - Non-rotated secrets beyond grace period trigger an “out-of-compliance” alert.
- **Audit Trail**:
  - All creation, rotation, expiry, and access events are logged with timestamp, actor, and secret identifier.
  - Logs are immutable and exportable for SIEM ingestion.
- **Visibility & Reporting**:
  - Dashboard shows secrets nearing expiry, overdue rotations, and overall compliance score.
  - Scheduled reports can be sent to compliance officers.
- **API & Integration**: Full REST API for checking secret status, triggering rotation, and exporting logs.

## Acceptance Criteria
- A secret configured with a 30-day rotation interval raises an alert if not rotated within 30 days + grace period.
- When a secret expires, any system attempting to use it receives a “secret expired” response and the event is logged.
- Manual rotation reminders are sent at predefined intervals (e.g., 7 days, 1 day before due) and escalate if missed.
- Audit log entries contain: timestamp (UTC), principal, action (create/rotate/expire/access), secret ID, outcome.
- An auditor can filter logs by secret ID and export them as CSV/JSON; logs cannot be deleted or modified by non-admin roles.
- Compliance dashboard reflects real-time status of all secrets, with filters by team, environment, or policy.

## Out of Scope
- Auto-generation of new secrets for 3rd-party services that lack compatible APIs (these will remain manual rotation only).
- Managing access control policies (RBAC) for who can view secrets – that is covered by the broader secrets management layer.
- Storage encryption and secret versioning mechanics (assumed to be provided by the underlying vault).
- Integration with non-standard notification channels beyond email, Slack, and generic webhooks.

## Requirements

> _Authored by the Business Analyst, grounded in the existing `builderforce.ai` codebase._
>
> _Signed: BA run #exec-578, 2026-01-06._

### R1 — Domain Model: `secrets` schema context

The feature lives in a new schema context module at `api/src/infrastructure/database/schema/secrets.ts`, re-exported by the `schema.ts` barrel. Four tables:

| Table | Purpose |
|---|---|
| `secret_policies` | Per-tenant policy templates: rotation interval (days), expiry duration (days), grace period (days), category. Policies are reusable across secrets. |
| `secrets` | One row per managed secret. References the policy. Carries `rotationDueAt`, `expiresAt`, `status` (active / expired / revoked / pending_rotation), `lastRotatedAt`. The secret VALUE is NOT stored — only a `secretRef` (external vault path or opaque id). |
| `secret_audit_log` | Append-only lifecycle event log. Immutable at the application layer: no UPDATE or DELETE from the API — only INSERT. Columns: `secretId`, `action` (create / rotate / expire / access / revoke / policy_change), `principal` (user id or agent ref), `outcome` (success / denied / error), `metadata` (jsonb for request context), `createdAt` (UTC). |
| `secret_rotation_jobs` | Tracks in-flight auto-rotation attempts: `secretId`, `status` (pending / running / succeeded / failed), `startedAt`, `completedAt`, `error`, `newSecretRef`. |

**Column types** follow the existing convention: `serial` PKs, `varchar(255)` for names/refs, `jsonb` for metadata, `timestamp` for all date columns, `boolean` for flags. Foreign keys: `secrets.tenantId → tenants.id`, `secrets.policyId → secret_policies.id`, `secret_audit_log.secretId → secrets.id`, `secret_rotation_jobs.secretId → secrets.id` — all `onDelete: 'cascade'` except the audit log which uses `onDelete: 'restrict'` (never cascade-delete audit records).

### R2 — Policy management API

New Hono route group at `api/src/api/secrets/policies.ts` (mounted under `/api/secrets/policies`), using `@hono/zod-validator` for request validation:

- `GET    /` — list policies for the tenant, filterable by `?category=`.
- `POST   /` — create a policy. Body: `{ name, category, rotationDays, expiryDays, gracePeriodDays, autoRotate, description }`. Rotation/expiry must be positive integers; grace period ≤ rotation.
- `GET    /:id` — single policy.
- `PATCH  /:id` — update fields; changing `rotationDays` or `expiryDays` on a policy that has live secrets logs a `policy_change` audit event for each affected secret.
- `DELETE /:id` — soft-delete only if no secrets reference it; otherwise 409.

### R3 — Secret lifecycle API

New Hono route group at `api/src/api/secrets/secrets.ts` (mounted under `/api/secrets`):

- `GET    /` — list secrets with computed status. Fields: `id, name, secretRef (redacted), category, status, rotationDueAt, expiresAt, lastRotatedAt, policyId, team, environment`. Filterable by `?status=`, `?category=`, `?team=`, `?environment=`, `?expiringWithinDays=` (overdue + upcoming).
- `POST   /` — register a secret. Body: `{ name, secretRef, policyId, team?, environment?, metadata? }`. Sets `status=active`, computes `rotationDueAt` and `expiresAt` from the policy. Logs `create` audit event.
- `GET    /:id` — single secret with full metadata (but never the value).
- `POST   /:id/rotate` — confirm a manual rotation. Body: `{ newSecretRef }`. Updates `lastRotatedAt`, recomputes `rotationDueAt` from policy. Logs `rotate` audit event. If the secret was `expired` and the new ref means it's now valid, moves status back to `active`.
- `POST   /:id/revoke` — revoke a secret. Body: `{ reason? }`. Sets `status=revoked`. Logs `revoke` audit event.
- `GET    /:id/audit` — paginated audit log for one secret. Query: `?limit=&offset=&action=`.

### R4 — Expiry & rotation sweep

A new sweep module at `api/src/application/scheduled/secretsSweep.ts`, registered in `runAllSweeps()` (existing pattern in `api/src/application/scheduled/runAllSweeps.ts`). The sweep runs on every `*/5` Cloudflare cron tick alongside the existing approval expiry sweep.

**Per tick, in one pass across all tenants:**

1. **Expiry sweep:** `SELECT` secrets where `status = 'active' AND expiresAt < now()`. UPDATE them to `status = 'expired'`. For each, INSERT a `secret_audit_log` row with `action = 'expire', outcome = 'success', principal = 'system/sweep'`.

2. **Pre-expiry warning sweep:** `SELECT` secrets where `status = 'active' AND expiresAt BETWEEN now() AND now() + interval '7 days'` that have NOT already had a warning logged in the current window (tracked via a metadata flag or deduplicated by checking the last audit-log entry). Logs `expire_warning` audit events; triggers notifications (see R6).

3. **Rotation-due sweep:** `SELECT` secrets where `status = 'active' AND rotationDueAt < now()`. If the secret's policy has `autoRotate = true`, create a `secret_rotation_jobs` row with `status = 'pending'` and log a `rotate_attempt` audit event. If `autoRotate = false`, the secret moves to `status = 'pending_rotation'` and the sweep logs a `rotation_overdue` audit event.

4. **Escalation sweep:** `SELECT` secrets where `status = 'pending_rotation' AND rotationDueAt < now() - policy.gracePeriodDays`. Logs `rotation_escalated` audit events; sets a `complianceFlag = 'non_compliant'` on the secret.

The sweep returns a `SecretsSweepResult { expired, warned, rotationDue, escalated }` for observability; the existing `reportCaughtError` pattern from `runApprovalExpirySweep.ts` is reused for error handling (sweep failures are logged, never crash the cron tick).

### R5 — Audit log immutability & export

- The `secret_audit_log` table has NO UPDATE or DELETE exposed in the API. The only write path is INSERT via (a) the secrets API endpoints and (b) the sweep.
- A new read-only endpoint: `GET /api/secrets/audit?secretId=&action=&principal=&from=&to=&limit=&offset=`. Returns paginated results. Supports `Accept: text/csv` and `Accept: application/json` for export.
- A `DELETE /api/secrets/audit/:id` endpoint exists but is gated: only users with the `admin` role can call it, and it logs a `SECURITY` event before deleting — satisfying "cannot be deleted by non-admin roles" from the acceptance criteria.

### R6 — Notifications

Reuses the existing `sendSlackNotification` in `api/src/application/approval/approvalNotifier.ts` and adds parallel email + webhook channels:

- **Slack:** Posts to `SLACK_APPROVAL_WEBHOOK_URL` (existing env var already consumed by the approval expiry sweep; the secrets sweep uses the same channel or a new `SLACK_SECRETS_WEBHOOK_URL` if configured).
- **Email:** A new `sendSecretEmailAlert()` function in `api/src/application/notifications/secretNotifier.ts`. Uses the platform's existing email infrastructure (e.g., Resend, referenced by `RESEND_API_KEY` in env). Sends to a configurable per-tenant notification list stored in `secret_policies.notifyEmails` (jsonb array).
- **Webhook:** A new `POST` to per-policy `secret_policies.notifyWebhookUrl` with a JSON payload: `{ event, secretId, secretName, timestamp }`.

Notification events:
| Trigger | T-x | Channel | Message |
|---|---|---|---|
| Expiry warning | 7 days before expiry | Slack + email | "Secret X expires in 7 days" |
| Expiry warning | 1 day before expiry | Slack + email + webhook | "Secret X expires in 24 hours" |
| Expired | At expiry | Slack + email + webhook | "Secret X has expired" |
| Rotation due | 7 days before due | email | "Secret X rotation due in 7 days" |
| Rotation overdue | At due date | Slack + email | "Secret X is overdue for rotation" |
| Rotation escalated | Due + grace period | Slack + email + webhook | "Secret X is out of compliance — rotation missed grace period" |

### R7 — Compliance dashboard & reporting

A new set of aggregate endpoints:

- `GET /api/secrets/compliance/summary` — returns `{ totalSecrets, expired, active, pendingRotation, nonCompliant, complianceScore (0–100), byCategory: { category, total, nonCompliant }[], byTeam: { team, total, nonCompliant }[] }`. The compliance score = `(compliant secrets / total secrets) * 100`, where "compliant" = `status = 'active' AND complianceFlag IS DISTINCT FROM 'non_compliant'`.
- `GET /api/secrets/compliance/report?format=csv|json` — full report with per-secret status, last rotated, next rotation, policy, audit event count; exportable.

No dedicated UI is in scope for this PRD — the dashboard is delivered as API endpoints consumable by the existing frontend or external tools.

### R8 — Secret access gate

A middleware at `api/src/api/secrets/middleware.ts` exports `secretAccessGate(secretId)`:

- Before any workflow or integration uses a secret, the caller resolves the secret's `status` from the `secrets` table.
- If `status = 'expired'` → reject with HTTP 410 Gone, body `{ error: 'secret_expired', secretId, expiredAt }`. Logs an `access` audit event with `outcome = 'denied'`.
- If `status = 'revoked'` → reject with HTTP 410 Gone, body `{ error: 'secret_revoked', secretId }`. Logs `access` with `outcome = 'denied'`.
- If `status = 'active'` → allow; logs `access` with `outcome = 'success'` (sampled: only 1 in N access events logged to avoid audit-log flood — configurable via `SECRET_ACCESS_LOG_SAMPLE_RATE`, default 0.1).
- An explicit exception mechanism: `POST /api/secrets/:id/exception` with body `{ reason, expiresAt }` allows a secret to be used even when expired/revoked for a bounded window. The exception itself is an audit event.

### R9 — Migration

One migration file at `api/migrations/03XX_secret_lifecycle_tables.sql` (the exact number is assigned at implementation time — the next free migration number after the current highest in `api/migrations/`). The migration creates the four tables from R1 with all constraints and indexes:

```sql
CREATE TABLE secret_policies (…);
CREATE TABLE secrets (…);
CREATE TABLE secret_audit_log (…);
CREATE TABLE secret_rotation_jobs (…);
-- Indexes for sweep queries:
CREATE INDEX idx_secrets_status_expires   ON secrets (status, expires_at);
CREATE INDEX idx_secrets_status_rotation  ON secrets (status, rotation_due_at);
CREATE INDEX idx_secret_audit_log_secret  ON secret_audit_log (secret_id, created_at);
```

### R10 — Observability

- Sweep results are logged via the existing `reportCaughtError` / structured-logging path.
- A new `secret_lifecycle_events` metric counter (incremented per audit event) feeds into the existing metrics infrastructure at `api/src/application/alerts/metricEvaluators.ts` if alert rules reference it.
- The existing `runAlertSweep` can trigger on `nonCompliantSecretCount > 0` if an alert rule is configured.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
