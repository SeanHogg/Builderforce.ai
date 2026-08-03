> **PRD** — drafted by Ada (Sr. Product Mgr) · task #558
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Credential Rotation without Service Restart

**Feature ID:** FR-4.3  
**Status:** Draft  
**Version:** 1.0  

---

## Problem & Goal

### Problem
Currently, the service loads all secrets (database passwords, API keys, TLS certificates, etc.) at startup. When credentials are rotated in the external secret store (e.g., Vault, Kubernetes secrets, mounted files), a full process restart is required to pick up the new values. This causes:
- Unnecessary downtime or rolling restart overhead, breaking long-lived connections.
- Increased operational toil, as SREs must coordinate restarts with rotation schedules.
- Risk of authentication failures and service disruption if restarts are not perfectly timed.

### Goal
Provide a live credential reload mechanism so that updated secrets are automatically picked up by running service instances without any process restart, ensuring continuous availability and compliance with security rotation policies.

---

## Target Users / ICP Roles
- **Site Reliability Engineers (SREs)** responsible for secret rotation automation and service uptime.
- **DevOps & Platform Engineers** who deploy and configure the service across environments.
- **Security Engineers** enforcing credential rotation policies and auditing access.

---

## Scope

### In Scope
- Detect changes to secrets from the configured backend(s) while the service is running.
- Reload secrets into memory and refresh all dependent components (connection pools, clients, internal caches) without dropping in-flight requests.
- Support at least the following secret backends: local file system (e.g., Kubernetes secrets volume), HashiCorp Vault (KV v2), environment variables (for static reload scenarios of env-sourced secrets).
- Provide an optional grace period during which both old and new credentials are valid to avoid authentication failures during rotation.
- Expose observability: reload success/failure metrics, structured logs, a health check endpoint indicating whether the latest secrets are loaded.
- Preserve compatibility: existing startup-time secret loading must continue to work; the live reload feature is additive and can be enabled/disabled.

### Out of Scope
- Rotating or generating new secrets in the external secret store (out-of-band operation remains the responsibility of the operator or a separate rotation tool).
- Reloading non-secret configuration parameters (e.g., feature flags, application config not related to credentials).
- Implementing a new secret store; only supported backends are in scope.
- Handling rotation of secrets that require custom client re-initialization beyond connection refresh (e.g., full SDK re-creation for a third-party API if the SDK does not support key refresh). The service will notify via logs/health when such a manual step is required.
- Automatic re-encryption of secrets at rest within the service.

---

## Functional Requirements

### FR-4.3.1 Secret Change Detection
- The service shall watch the configured secret source for changes using the most efficient mechanism available (inotify for files, Vault agent’s `vault exec` template rendering, or a comparable watch API).
- If native watch is not possible (e.g., environment variables), periodic polling (configurable interval, default 60 seconds) shall be supported as a fallback.

### FR-4.3.2 Reload Triggering
- Automatic mode: a secret change shall trigger an immediate reload without human intervention.
- Manual mode: a dedicated admin API endpoint (e.g., `POST /admin/credentials/reload`) shall allow on-demand reload.
- In automatic mode, reload shall be triggered only after the secret value has stabilized (debounce window, default 5 seconds) to avoid partial updates.

### FR-4.3.3 Graceful Credential Update
- During the reload process, the service shall temporarily accept both old and new credentials for a configurable grace period (default 30 seconds) to cover the propagation window.
- All existing connection pools (database, message brokers, HTTP clients using client certs) shall be instructed to rotate credentials: new connections use the new secret, existing connections remain valid until natural termination or a connection refresh timeout.
- The service must not terminate active requests; new requests after the reload should seamlessly use the updated credentials.

### FR-4.3.4 Multi-Backend Support
- The reload logic must abstract the backend: detection and retrieval shall work consistently whether secrets come from files, Vault, or environment variables (for env-var based secrets, only polling is supported).
- Backend selection is done via configuration; at least one reload-capable backend must be configured to enable the feature.

### FR-4.3.5 Error Handling & Fallback
- If a new secret cannot be loaded (e.g., parse error, backend unreachable), the service shall keep using the last-known-good credentials and report the failure via logs and a health check.
- After a configurable number of consecutive failures, an alert-worthy metric shall be emitted but the service should never crash due to a reload failure.

### FR-4.3.6 Observability
- Emit a structured log entry for every reload attempt, including backend, timestamp, success/failure, and duration.
- Expose Prometheus metrics:
  - `credential_reload_total` (counter) with status label.
  - `credential_reload_duration_seconds` (histogram).
  - `credential_current_age_seconds` (gauge) indicating time since last successful reload.
- Health check endpoint `/health/credentials` shall return 200 only if the last reload was successful and credentials are within a configurable maximum age (e.g., 90% of rotation interval).

### FR-4.3.7 Security & Auditing
- Reload events must be auditable, with the identity of the requestor (for manual reload) or system event logged.
- Secrets must never be written to stdout/stderr or clear-text logs; redaction must apply.

---

## Acceptance Criteria

1. **Live Reload Test:** When a secret (e.g., database password) is updated in the backend, the service automatically picks up the new value within 15 seconds (polling mode) or near-real-time (watch mode) without any process restart.
2. **Zero-Downtime Rotation:** During the grace period (30 seconds), authentication requests using either the old or new secret succeed with no errors in the service logs.
3. **Connection Pool Refresh:** After a database password rotation, new connections are established using the new password, and existing query in progress is not interrupted; no dropped queries or connection errors occur due to rotation.
4. **Health Endpoint:** `/health/credentials` returns HTTP 200 within 1 second after a successful reload and returns 503 if no reload has succeeded in the last configured `max_age`.
5. **Manual Reload:** A `POST /admin/credentials/reload` triggers an immediate reload and returns 200 with a JSON response containing reload status and timestamp.
6. **Fallback Behavior:** If a secret value is corrupted (e.g., malformed certificate), the service retains the prior valid credentials, logs a clear error, and does not crash; metric `credential_reload_total{status="failure"}` increments.
7. **Multi-Backend:** The feature works with file-based secrets (Kubernetes secret volume), Vault dynamic secrets, and env-var sourced credentials (via polling) without code changes.
8. **No Regressions:** Existing startup-only secret loading continues to work when live reload is disabled or when the backend does not support watching.

---

## Out of Scope
- Built-in secret rotation orchestration (e.g., triggering a password change in the database). The service only reloads what has already been rotated externally.
- Integration with custom secret backends not listed; extensibility points for future backends are allowed but not part of this PRD.
- Reloading of non-credential runtime configuration that affects business logic (separate feature).
- Automatic scaling of connection pools based on new credentials (current pool sizes remain unchanged).
- Support for rotating secrets in embedded/clustered state where multiple nodes must coordinate reload order; this design assumes independent per-instance reload.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._