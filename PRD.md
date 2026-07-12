> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #138
> _Each agent that updates this PRD signs its change below._

# PRD: OKR 5 — Security, Governance & Production Hardening

## Problem & Goal

Enterprise buyers evaluating Builderforce require demonstrable proof of auditability, data governance, and production-grade reliability before approving procurement or expanding seat counts. Today the platform lacks formal policy enforcement, immutable audit trails, SIEM integrations, resilient agent infrastructure, and a self-hosted deployment path. This OKR closes those gaps so Builderforce can pass enterprise security reviews, comply with internal IT policies, and sustain production workloads at scale.

**Goal:** Earn enterprise trust by shipping auditable governance tooling, immutable logging with SIEM export, load-balanced and fault-tolerant agent infrastructure, and a Docker-based self-hosted distribution — all validated against real enterprise acceptance criteria.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **CISO / Security Engineer** | Immutable audit logs, SIEM integration, policy enforcement evidence |
| **IT / Compliance Admin** | Governance portal, policy pack management, audit report exports |
| **Platform / DevOps Engineer** | Agent fleet health, failover configuration, Docker self-hosted setup |
| **Builderforce Admin (internal)** | Governance-auditor agent, policy violation alerting |
| **Enterprise Procurement / Legal** | Evidence artifacts for security questionnaires and vendor reviews |

---

## Scope

This OKR covers five tightly coupled capability areas delivered in a single production release milestone:

1. **Database Policy Packs & Governance-Auditor Agent**
2. **Governance Portal** (`/governance/policies` + `/governance/audits`)
3. **Immutable Audit Log + SIEM Export**
4. **Agent Fleet Load Balancing + Auto-Failover**
5. **Docker Self-Hosted Builderforce**

---

## Functional Requirements

### 1. Database Policy Packs & Governance-Auditor Agent

**FR-1.1** Define a `PolicyPack` schema with fields: `id`, `name`, `version`, `rules[]`, `severity` (critical / high / medium / low), `created_at`, `updated_at`, `enabled`.

**FR-1.2** Ship a default library of at least five (5) built-in policy packs covering: PII data exposure, overprivileged DB roles, unencrypted columns, missing row-level security, and stale credentials.

**FR-1.3** Allow admins to create, clone, enable/disable, and version custom policy packs via API and UI.

**FR-1.4** Introduce a `governance-auditor` agent role that runs continuously, evaluates all active policy packs against connected database schemas on a configurable schedule (default: hourly), and emits structured violation events.

**FR-1.5** Governance-auditor violations must carry: `violation_id`, `policy_pack_id`, `rule_id`, `severity`, `resource_type`, `resource_id`, `detail`, `detected_at`, `resolved_at` (nullable), `status` (open / acknowledged / resolved).

**FR-1.6** Admins can manually trigger an on-demand audit scan from the portal or API (`POST /api/governance/audits/run`).

---

### 2. Governance Portal

**FR-2.1** Implement route `/governance/policies` as a protected admin page listing all policy packs with status, version, last-run time, and open violation count.

**FR-2.2** Policy detail view shows individual rules, rule descriptions, remediation guidance, and historical violation trend chart (last 30 days).

**FR-2.3** Implement route `/governance/audits` as an audit log explorer with: time-range filter, severity filter, policy/resource filter, full-text search, and paginated result table.

**FR-2.4** Audit entries are expandable to show full JSON detail, linked resource, and a remediation checklist.

**FR-2.5** Provide a **Download Report** action on `/governance/audits` that exports filtered results as PDF and CSV with a tamper-evident hash footer.

**FR-2.6** Access to all `/governance/*` routes is gated by the `governance:read` permission; policy mutation requires `governance:write`.

---

### 3. Immutable Audit Log + SIEM Export

**FR-3.1** All platform events that affect security posture must be written to a dedicated `audit_log` table with append-only enforcement (no UPDATE or DELETE permitted at the DB layer via row-level policy or equivalent).

**FR-3.2** Auditable event categories (minimum): user auth (login, logout, MFA change, password reset), RBAC changes, policy pack mutations, agent invocations, data query executions, API key creation/revocation, governance scan results.

**FR-3.3** Each audit record contains: `event_id` (UUID), `event_type`, `actor_id`, `actor_ip`, `target_type`, `target_id`, `payload` (JSON), `timestamp` (UTC), `hash` (SHA-256 chained from prior record).

**FR-3.4** Provide a hash-chain verification endpoint (`GET /api/audit/verify`) that returns chain integrity status and first-broken-link position if tampered.

**FR-3.5** Implement SIEM export via:
- **Webhook push** — configurable HTTPS endpoint, HMAC-signed payloads, retry with exponential back-off.
- **Syslog forward** — RFC-5424 over TLS to a configurable host:port.
- **Amazon S3 / compatible object store** — batched NDJSON files, configurable flush interval (min 1 min).

**FR-3.6** SIEM connector configuration is managed in Settings > Integrations with test-ping capability.

**FR-3.7** Audit log data must be retained for a minimum of 90 days on-platform; retention policy configurable up to 7 years.

---

### 4. Agent Fleet Load Balancing + Auto-Failover

**FR-4.1** The agent runtime must support a multi-instance fleet model where N agent workers register with a central coordinator.

**FR-4.2** Implement a work-queue-based dispatch model (e.g., backed by Redis Streams or equivalent) so task assignments are distributed across healthy workers with least-connection or round-robin strategy, configurable per deployment.

**FR-4.3** Each agent worker emits a heartbeat every 10 seconds; the coordinator marks a worker `unhealthy` after 3 missed heartbeats (30 s).

**FR-4.4** In-flight tasks from an `unhealthy` worker are automatically re-queued and reassigned to a healthy worker within 60 seconds of failure detection.

**FR-4.5** Fleet health is visible in an **Agent Fleet** dashboard: per-worker status, task throughput, queue depth, error rate, and uptime.

**FR-4.6** Expose `GET /api/agents/fleet/health` returning aggregate and per-worker health JSON; suitable for external load-balancer health checks.

**FR-4.7** Support horizontal scale-out: adding a new worker container to the fleet requires only environment variable configuration (no code changes, no downtime).

---

### 5. Docker Self-Hosted Builderforce

**FR-5.1** Publish an official `builderforce/server` Docker image on Docker Hub and GitHub Container Registry, tagged by semantic version and `latest`.

**FR-5.2** Provide a production-ready `docker-compose.yml` that orchestrates: app server, agent worker(s), PostgreSQL, Redis, and optional NGINX reverse proxy — all startable with `docker compose up -d`.

**FR-5.3** All required configuration is injectable via environment variables documented in a `.env.example` file; no secrets are baked into the image.

**FR-5.4** First-run initialization (DB migrations, seed admin user) executes automatically on `docker compose up` via an init container or entrypoint script; subsequent restarts are idempotent.

**FR-5.5** Ship a `builderforce-cli` helper (`bf`) packaged in the image that supports: `bf migrate`, `bf seed`, `bf health`, `bf backup`, and `bf restore`.

**FR-5.6** Self-hosted instance must pass the same governance, audit log, and agent fleet feature set as cloud-hosted; no feature gating between deployment modes.

**FR-5.7** Publish a **Self-Hosted Setup Guide** covering prerequisites, install steps, TLS configuration, backup strategy, and upgrade procedure.

---

## Acceptance Criteria

### Governance & Policy Packs

- [ ] All 5+ built-in policy packs execute without errors against a test schema and produce correctly structured violation records.
- [ ] A custom policy pack can be created via API, triggered on-demand, and its violations appear in the portal within 30 seconds.
- [ ] Disabling a policy pack stops new violations from being generated within the next scheduled scan cycle.
- [ ] Governance portal pages load under 2 seconds with 10,000+ audit records present.
- [ ] PDF/CSV export includes a verifiable hash footer that changes when file content is modified.

### Immutable Audit Log

- [ ] Attempting a direct SQL `UPDATE` or `DELETE` on `audit_log` returns a permission-denied error for all application roles.
- [ ] Hash-chain verification passes on an unmodified log; manually altering one record causes `/api/audit/verify` to report the correct broken-link index.
- [ ] All 8 auditable event categories generate records with all required fields populated.
- [ ] SIEM webhook delivery achieves < 5 seconds end-to-end latency under normal conditions and retries successfully after a simulated endpoint outage.
- [ ] S3 export produces valid NDJSON files queryable by Athena/Splunk.

### Agent Fleet

- [ ] Stopping one worker container mid-task causes that task to be re-queued and completed by a remaining worker within 60 seconds.
- [ ] Adding a second worker container (no restart of existing workers) results in new tasks being distributed across both workers within one dispatch cycle.
- [ ] Fleet health endpoint returns HTTP 200 with accurate per-worker data; returns HTTP 503 when all workers are unhealthy.
- [ ] Under a 2× normal load test, p95 task dispatch latency does not increase by more than 20% vs. single-worker baseline.

### Docker Self-Hosted

- [ ] A clean `docker compose up -d` on a fresh Linux host (with Docker 24+) produces a fully functional Builderforce instance in under 5 minutes.
- [ ] Re-running `docker compose up -d` on an existing deployment does not reset data or re-run destructive migrations.
- [ ] `bf health` returns green for all services; `bf backup` produces a restorable archive verified by `bf restore` on a second host.
- [ ] Self-hosted instance passes governance, audit, and fleet acceptance criteria identical to cloud.

### Access Control

- [ ] A user without `governance:read` receives HTTP 403 on all `/governance/*` routes and API endpoints.
- [ ] A user with `governance:read` but not `governance:write` can view but cannot create or mutate policy packs.

---

## Out of Scope

- **SOC 2 / ISO 27001 certification process** — tooling supports evidence gathering but formal audit and certification are a separate workstream.
- **Multi-tenant data isolation** — row-level isolation within a single deployment is in scope; full multi-tenant SaaS account separation is not.
- **Kubernetes Helm chart** — Docker Compose is the supported self-hosted path for this OKR; Helm chart delivery is a future OKR.
- **Custom SIEM connectors beyond Webhook, Syslog, S3** — Splunk HEC, Datadog, and similar vendor-specific agents are future scope.
- **Automated policy remediation / auto-fix** — the auditor detects and reports violations; automated database mutations to remediate them are out of scope.
- **Agent task priority queuing** — all tasks share a single priority tier in this release; priority lanes are future scope.
- **SSO / SAML integration** — authentication hardening is a separate OKR track.
- **Billing or license enforcement** on self-hosted instances.