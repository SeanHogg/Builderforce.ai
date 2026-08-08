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

> _Authored by the Business Analyst — traceable to FR-4.3.1 through FR-4.3.7._

### REQ-1: Backend Abstraction Layer
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-1.1 | The system SHALL define a `SecretBackend` interface abstracting secret retrieval and change detection, with a `fetch()` method returning a `Map<string, string>` of credential name → value pairs and a `watch(onChange)` method subscribing to change notifications. | FR-4.3.1, FR-4.3.4 | P0 |
| REQ-1.2 | Implementations SHALL be provided for: **FileBackend** (reads secret files from a directory; uses `fs.watch` / inotify), **VaultBackend** (reads from HashiCorp Vault KV v2; uses polling + optional Vault Agent template), and **EnvBackend** (reads from `process.env` at configurable keys; polling-only, no watch). | FR-4.3.4 | P0 |
| REQ-1.3 | Backend selection SHALL be driven by configuration (e.g., `SECRET_BACKEND=file|vault|env`). When none is configured, live reload is disabled and startup-only loading applies with no change detection. | FR-4.3.4, AC #8 | P0 |
| REQ-1.4 | The backend interface SHALL be extensible so new backends (e.g., AWS Secrets Manager, Azure Key Vault) can be added by implementing the interface without changes to reload orchestration. | FR-4.3.4 (future-proofing) | P2 |

### REQ-2: Change Detection & Reload Triggering
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-2.1 | In **watch mode** (FileBackend), the system SHALL use OS-level file watchers (`fs.watch` / `inotify`) to detect secret file modifications and trigger reload within 2 seconds of a stable write. | FR-4.3.1, AC #1 | P0 |
| REQ-2.2 | In **polling mode** (EnvBackend, VaultBackend, or fallback), the system SHALL poll the backend at a configurable interval (`CREDENTIAL_POLL_INTERVAL_SECONDS`, default 60). Polling SHALL be the fallback when native watch is unavailable. | FR-4.3.1, AC #1 | P0 |
| REQ-2.3 | A **debounce window** (`CREDENTIAL_DEBOUNCE_SECONDS`, default 5) SHALL suppress reloads triggered within the window of a prior event, ensuring the secret value has stabilized before reload. | FR-4.3.2 | P1 |
| REQ-2.4 | A **manual reload endpoint** `POST /admin/credentials/reload` SHALL trigger an immediate reload regardless of watch/polling state. The endpoint SHALL return `200 OK` with JSON `{ "status": "success" | "failure", "timestamp": "<ISO8601>", "backend": "<backend>", "duration_ms": <number> }`. | FR-4.3.2, AC #5 | P1 |
| REQ-2.5 | The manual reload endpoint SHALL be protected by an admin authorization check (existing admin middleware) and SHALL log the identity of the requestor. | FR-4.3.7 | P0 |

### REQ-3: Graceful Credential Rotation
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-3.1 | During reload, the system SHALL atomically swap the in-memory credential store (old → new) so that readers always see a consistent set of credentials, never a partially-updated map. | FR-4.3.3 | P0 |
| REQ-3.2 | A **grace period** (`CREDENTIAL_GRACE_PERIOD_SECONDS`, default 30) SHALL be observed: for the duration of the grace period after a successful reload, both old and new credentials SHALL be accepted for authentication. After the grace period expires, only the new credentials are valid. | FR-4.3.3, AC #2 | P0 |
| REQ-3.3 | The system SHALL maintain a **credential version counter** incremented on each successful reload, and expose it via the health endpoint so operators can confirm which version is active. | FR-4.3.6 | P2 |
| REQ-3.4 | Database connection pools (via the existing `buildDatabase` / Drizzle infrastructure) SHALL be notified on reload: a new pool using new credentials SHALL be warmed up before the old pool is drained. In-flight queries on the old pool SHALL complete naturally; new queries SHALL route to the new pool. No connections SHALL be forcibly terminated. | FR-4.3.3, AC #3 | P0 |
| REQ-3.5 | HTTP client instances using client TLS certificates SHALL re-read their certificate/key material on reload. Existing keep-alive connections using old certs SHALL complete; new connections SHALL use the new material. | FR-4.3.3 | P1 |
| REQ-3.6 | Active HTTP requests SHALL NOT be aborted or retried due to a reload; the reload SHALL be invisible to in-flight request handlers. | FR-4.3.3 | P0 |

### REQ-4: Error Handling & Fallback
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-4.1 | If a reload attempt fails (backend unreachable, secret parse error, malformed value), the system SHALL retain the last-known-good credentials and continue operating without interruption. | FR-4.3.5, AC #6 | P0 |
| REQ-4.2 | A **consecutive failure counter** SHALL track how many successive reload attempts have failed. When the counter exceeds `CREDENTIAL_MAX_CONSECUTIVE_FAILURES` (default 3), the `credential_reload_total{status="alert"}` metric SHALL be emitted. | FR-4.3.5 | P1 |
| REQ-4.3 | The system SHALL NEVER crash, panic, or exit due to a reload failure. All reload errors SHALL be caught and handled gracefully. | FR-4.3.5, AC #6 | P0 |
| REQ-4.4 | On the first successful reload after one or more failures, the consecutive failure counter SHALL reset to zero and a recovery log entry SHALL be emitted. | FR-4.3.5 | P1 |

### REQ-5: Observability
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-5.1 | Every reload attempt SHALL emit a **structured log entry** (JSON) containing: `{ "event": "credential_reload", "backend": "<backend>", "status": "success"|"failure", "duration_ms": <number>, "timestamp": "<ISO8601>" }`. On failure, an `error` field with a sanitized message (no secret values) SHALL be included. | FR-4.3.6 | P0 |
| REQ-5.2 | The system SHALL expose a Prometheus **Counter** `credential_reload_total` with labels `{backend, status}` where `status` is `success`, `failure`, or `alert`. | FR-4.3.6, AC #6 | P0 |
| REQ-5.3 | The system SHALL expose a Prometheus **Histogram** `credential_reload_duration_seconds` with label `{backend}` and buckets `[0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30]`. | FR-4.3.6 | P0 |
| REQ-5.4 | The system SHALL expose a Prometheus **Gauge** `credential_current_age_seconds` indicating the time in seconds since the last successful reload. | FR-4.3.6 | P0 |
| REQ-5.5 | A **health check endpoint** `GET /health/credentials` SHALL return `200 OK` with body `{ "status": "healthy", "last_reload": "<ISO8601>", "version": <number>, "backend": "<backend>", "age_seconds": <number> }` when the last reload succeeded AND `age_seconds` < `CREDENTIAL_MAX_AGE_SECONDS`. | FR-4.3.6, AC #4 | P0 |
| REQ-5.6 | The health check SHALL return `503 Service Unavailable` with body `{ "status": "unhealthy", "reason": "<stale|failed|never_reloaded>", ... }` when credentials are stale (exceeded max age) or a reload has never succeeded. | FR-4.3.6, AC #4 | P0 |
| REQ-5.7 | The existing application-level `/health` endpoint SHALL include a `credentials` subsection with the same status so aggregated monitoring tools see credential health alongside other health signals. | FR-4.3.6 | P2 |

### REQ-6: Security & Audit
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-6.1 | Secrets SHALL NEVER appear in log output, error messages, response bodies, or metric labels. All secret values SHALL be redacted (replaced with `[REDACTED]`) before any logging or serialization. | FR-4.3.7 | P0 |
| REQ-6.2 | Reload events SHALL be written to an **audit log** (structured, separate from application logs) containing: `{ "event": "credential_reload", "trigger": "automatic"|"manual", "requestor": "<user_id|system>", "backend": "<backend>", "status": "success"|"failure", "timestamp": "<ISO8601>" }`. | FR-4.3.7 | P1 |
| REQ-6.3 | The in-memory credential store SHALL be stored in a variable that is NOT enumerable or serializable, preventing accidental exposure via `console.log`, debug endpoints, or error stack traces. | FR-4.3.7 | P0 |
| REQ-6.4 | The manual reload endpoint SHALL require admin-level authentication. Unauthenticated requests SHALL receive `401 Unauthorized`; authenticated non-admin requests SHALL receive `403 Forbidden`. | FR-4.3.7, REQ-2.5 | P0 |

### REQ-7: Configuration & Startup Compatibility
| ID | Requirement | Maps To | Priority |
|----|------------|---------|----------|
| REQ-7.1 | Live credential reload SHALL be controlled by a feature flag `CREDENTIAL_LIVE_RELOAD_ENABLED` (default `false`). When disabled, the system SHALL load secrets once at startup and run no watchers, pollers, or health checks. | AC #8 | P0 |
| REQ-7.2 | When live reload is enabled, secrets SHALL still be loaded at startup via the same backend abstraction. The initial load SHALL use the same `fetch()` path as reload, ensuring consistency. | AC #8 | P0 |
| REQ-7.3 | The following environment variables / config keys SHALL be recognized, each with sensible defaults: | FR-4.3.1–FR-4.3.7 | P0 |
| | — `CREDENTIAL_LIVE_RELOAD_ENABLED` (bool, default `false`) | | |
| | — `CREDENTIAL_BACKEND` (`file` | `vault` | `env`, required when enabled) | | |
| | — `CREDENTIAL_FILE_DIR` (string, for FileBackend; default `/etc/secrets`) | | |
| | — `CREDENTIAL_VAULT_ADDR` (string, for VaultBackend; required) | | |
| | — `CREDENTIAL_VAULT_TOKEN` (string, for VaultBackend; required) | | |
| | — `CREDENTIAL_VAULT_PATH` (string, for VaultBackend; required) | | |
| | — `CREDENTIAL_ENV_PREFIX` (string, for EnvBackend; default `SECRET_`) | | |
| | — `CREDENTIAL_POLL_INTERVAL_SECONDS` (int, default 60) | | |
| | — `CREDENTIAL_DEBOUNCE_SECONDS` (int, default 5) | | |
| | — `CREDENTIAL_GRACE_PERIOD_SECONDS` (int, default 30) | | |
| | — `CREDENTIAL_MAX_CONSECUTIVE_FAILURES` (int, default 3) | | |
| | — `CREDENTIAL_MAX_AGE_SECONDS` (int, default 0 = disabled) | | |
| REQ-7.4 | All configuration SHALL be validated at startup; invalid or contradictory combinations (e.g., live reload enabled but no backend configured) SHALL cause a clear startup error with a descriptive message — NOT a silent fallback to startup-only mode. | — | P1 |

### Traceability Matrix

| Acceptance Criterion | Functional Reqs | Requirements |
|---------------------|----------------|--------------|
| AC #1 — Live Reload within 15s | FR-4.3.1 | REQ-2.1, REQ-2.2 |
| AC #2 — Zero-Downtime Rotation | FR-4.3.3 | REQ-3.2, REQ-3.6 |
| AC #3 — Connection Pool Refresh | FR-4.3.3 | REQ-3.4 |
| AC #4 — Health Endpoint | FR-4.3.6 | REQ-5.5, REQ-5.6 |
| AC #5 — Manual Reload | FR-4.3.2 | REQ-2.4, REQ-2.5 |
| AC #6 — Fallback Behavior | FR-4.3.5 | REQ-4.1, REQ-4.3, REQ-5.2 |
| AC #7 — Multi-Backend | FR-4.3.4 | REQ-1.1, REQ-1.2, REQ-1.3 |
| AC #8 — No Regressions | FR-4.3.4 | REQ-7.1, REQ-7.2 |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._