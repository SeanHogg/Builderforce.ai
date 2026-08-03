> **PRD** — drafted by Ada (Sr. Product Mgr) · task #582
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Evidence Reference System

## Problem & Goal
Organizations must demonstrate compliance, investigate incidents, and meet audit requirements by preserving evidence artifacts such as logs, configuration snapshots, secret management access records, and audit trails. Currently, these artifacts are scattered across disparate systems, lack integrity guarantees, and are difficult to retrieve or prove unaltered under regulatory scrutiny.

**Goal:** Provide a centralized, tamper‑evident evidence repository that ingests, stores, and serves evidence references while maintaining a complete chain of custody, enabling fast retrieval for audits and investigations.

## Target Users / ICP Roles
- **Compliance Officers & Internal/External Auditors** – require verifiable, searchable evidence for SOC2, ISO 27001, PCI DSS, etc.
- **Security Analysts & Incident Responders** – need rapid access to historical logs and config snapshots during incident investigations.
- **DevOps & Platform Engineers** – responsible for integrating evidence sources and managing retention.
- **Site Reliability Engineers (SRE)** – rely on evidence for post‑mortem analysis and change forensics.

## Scope
- A multi‑tenant evidence ingestion and storage service with REST API and syslog/file‑based ingestion.
- Immutable, write‑once‑read‑many (WORM) storage with configurable retention periods.
- Cryptographic hashing (SHA‑256) of every artifact upon ingestion to guarantee integrity.
- Full‑text search and time‑range queries over stored evidence.
- Role‑based access control (RBAC) and an internal audit log of all system interactions.
- Export functionality producing signed, verifiable evidence bundles suitable for auditor submission.
- Metadata tagging (incident ID, control reference, etc.) for organisation.

## Functional Requirements
1. **Ingestion**  
   - Accept evidence via REST API, Syslog (RFC 5424), or batch file upload (SFTP).  
   - Support structured logs (JSON), unstructured text logs, configuration snapshots (plain text, YAML, JSON), secret management access logs (e.g., HashiCorp Vault audit log), and generic audit trail events.  
   - Ingestion pipeline must be idempotent (duplicate detection via hash).

2. **Integrity & Immutability**  
   - On ingest, compute SHA‑256 hash and store as part of artifact metadata.  
   - Storage layer enforces append‑only semantics; any write modification attempt is rejected.  
   - Background integrity scanner periodically re‑hashes stored artifacts and compares with stored hashes; alerts on mismatch.

3. **Storage & Retention**  
   - Configurable retention periods per evidence type or tag (minimum 1 year, default 7 years).  
   - Automatic, irreversible deletion after retention expires, with a mandatory approval workflow for early deletion requests.  
   - “Legal hold” flag that overrides retention and prevents any deletion.

4. **Search & Retrieval**  
   - Full‑text search across log lines and metadata (source, timestamp, type, tags).  
   - Range queries by timestamp, severity, or custom fields.  
   - API response pagination and streaming for large result sets.

5. **Access Control & Audit**  
   - RBAC with predefined roles: Viewer, Auditor, Admin.  
   - All user actions (search, view, export, delete request) recorded in an immutable internal audit log.  
   - Authentication via SAML/OIDC integration with existing IdP.

6. **Export & Evidence Bundles**  
   - Export selected evidence as JSON, CSV, or signed bundle (ZIP with detached signature and manifest of hashes).  
   - Signatures generated using an HSM‑backed key; verifiable by auditors independently.  
   - Include chain of custody log in the exported bundle.

7. **Tagging & Metadata**  
   - Allow users to attach custom key‑value tags (e.g., `incident_id=INC-123`, `control=SOC2_CC7.2`).  
   - Bulk tag update via API.

## Acceptance Criteria
- Ingestion pipeline sustains **10,000 events/second** with ≤ 1% error rate under normal load.
- Integrity verification completes daily; any hash mismatch triggers an alert and marks the artifact as “tainted” within **5 minutes**.
- Search queries over a **30‑day, 1 TB** dataset return first page of results in **≤ 2 seconds**.
- Retention policies enforced: evidence past retention is purged within **1 hour** of expiry, and all deletion attempts produce an audit entry.
- Unauthorized access attempts result in a `403` and are logged; admin can review access logs in real time.
- Export bundle can be successfully verified by a standard OpenSSL/GPG toolchain against the system’s public key.

## Out of Scope
- Real‑time alerting or correlation of evidence content (SIEM integration via export is acceptable).
- Generation or collection of evidence from source systems (this system ingests; source collection is the provider’s responsibility).
- Advanced analytics, dashboards, or anomaly detection on evidence data.
- Parsing or field‑level transformation of unstructured logs beyond basic timestamp extraction.
- Management of secrets or secret rotation (only consumption of secret management audit logs).

## Requirements

_Authored by the business-analyst — signed below._

### System Quality Attributes

#### Reliability & Availability
- **REQ-SQA-01:** The system shall achieve **99.9% uptime** (three nines) measured monthly, excluding scheduled maintenance windows announced at least 72 hours in advance.
- **REQ-SQA-02:** Ingestion endpoints shall accept and acknowledge evidence within **500 ms p95** under steady-state load; write-path degradation shall be graceful — the system shall return `503 Service Unavailable` with a `Retry-After` header rather than dropping evidence when overloaded.
- **REQ-SQA-03:** Search and retrieval endpoints shall return results within **2 seconds p95** for the first page under normal load, and shall not exceed **10 seconds p99** for any query spanning a 30-day window.
- **REQ-SQA-04:** No single point of failure shall exist in the ingestion or retrieval path; the system shall survive the loss of any one node without data loss or user-visible downtime.

#### Data Integrity & Durability
- **REQ-DID-01:** Every ingested artifact shall be hashed (SHA-256) synchronously before the ingestion API returns a `201 Created` response. The hash shall be stored as immutable artifact metadata.
- **REQ-DID-02:** The storage layer shall provide **11 nines of durability** (99.999999999%) for committed evidence, achieved via synchronous replication across at least three availability zones before acknowledging the write.
- **REQ-DID-03:** An automated integrity scanner shall re-hash every stored artifact and compare against its recorded hash on a configurable schedule (default: daily). Any mismatch shall trigger a **P1 alert** within 5 minutes and mark the artifact as `tainted`.
- **REQ-DID-04:** The chain of custody log shall be append-only at the storage level; no API, operator, or administrative action shall be capable of modifying or deleting a custody record once written.

#### Security
- **REQ-SEC-01:** All data in transit shall be encrypted using **TLS 1.3** (fallback to TLS 1.2 with strong cipher suites only). Plaintext HTTP shall not be served on any endpoint.
- **REQ-SEC-02:** All evidence at rest shall be encrypted using **AES-256-GCM** with keys managed via a KMS that supports automatic key rotation (minimum rotation period: 90 days).
- **REQ-SEC-03:** Authentication shall support **SAML 2.0** and **OpenID Connect (OIDC)** for integration with enterprise identity providers. Service-to-service authentication shall use short-lived JWTs signed by the platform's internal CA.
- **REQ-SEC-04:** Every user-facing action (create, read, search, export, delete-request, tag-update, hold-apply, hold-release) shall be authorized against the user's role and recorded in the internal audit log with: actor identity, action, target resource, timestamp, source IP, and outcome (allowed/denied).
- **REQ-SEC-05:** Failed authentication attempts shall be rate-limited: after 5 consecutive failures from the same source IP within a 15-minute window, further attempts shall be throttled with a `429 Too Many Requests` response and the event shall be logged as a security event.

#### Scalability
- **REQ-SCA-01:** The ingestion pipeline shall scale horizontally to sustain **10,000 events/second** per tenant (burst), with linear scaling up to **100,000 events/second** aggregate across all tenants.
- **REQ-SCA-02:** The system shall support up to **10,000 tenants** with logical data isolation per tenant; no tenant's evidence shall be readable or searchable by another tenant.
- **REQ-SCA-03:** Storage capacity shall support evidence retention up to **10 years** per artifact; aggregate storage shall scale to **1 PB** without architectural change.
- **REQ-SCA-04:** Full-text search indexing shall keep pace with ingestion; the maximum allowed indexing lag is **60 seconds** under peak load.

#### Compliance & Retention
- **REQ-COM-01:** Retention policies shall be configurable per evidence type (`log`, `config_snapshot`, `secret_access_log`, `audit_trail`, `generic`) and shall be overridable per artifact via metadata tag (`retention_days`).
- **REQ-COM-02:** The minimum retention period is **365 days** (1 year); the default is **2,557 days** (7 years). Retention periods shorter than the default require an explicit justification recorded in the audit log.
- **REQ-COM-03:** A "legal hold" flag on an artifact shall prevent deletion regardless of retention expiry. Applying or releasing a legal hold shall require the `Admin` role and shall produce an immutable audit entry.
- **REQ-COM-04:** Evidence past its retention period with no legal hold shall be purged within **1 hour** of expiry. Purge operations shall be irreversible, shall produce an audit log entry listing every purged artifact ID and hash, and shall be verifiable post-execution.
- **REQ-COM-05:** Early deletion (before retention expiry) shall require a two-person approval workflow: a requestor submits justification, and an approver (distinct from the requestor, holding the `Admin` role) confirms. Both actions shall be recorded in the audit log.

#### Export & Verifiability
- **REQ-EXP-01:** The signed export bundle shall be a ZIP archive containing: (a) each requested evidence artifact in its original ingested format, (b) a `manifest.json` file listing every artifact's ID, ingest timestamp, source, SHA-256 hash, and tags, and (c) a detached `manifest.json.sig` signature file produced by the HSM-backed signing key.
- **REQ-EXP-02:** The signature shall be an **RSASSA-PKCS1-v1_5 with SHA-256** signature (or ECDSA P-256 with SHA-256) verifiable by standard `openssl dgst -verify` or `gpg --verify` toolchains against the system's published public key.
- **REQ-EXP-03:** The export bundle shall include the **full chain of custody log** for every exported artifact, in JSON Lines format (`custody.jsonl`), so auditors can independently reconstruct who accessed or modified metadata for each artifact.
- **REQ-EXP-04:** All three export formats (JSON, CSV, signed bundle) shall support result set sizes up to **1 million artifacts** without timeout, using paginated streaming responses.

#### Observability
- **REQ-OBS-01:** The system shall emit structured metrics (Prometheus-compatible) for: ingestion throughput (events/sec), ingestion latency (p50/p95/p99), ingestion error rate, search query latency, storage bytes per tenant, index lag seconds, integrity scan progress (artifacts scanned/total), and purge operations count.
- **REQ-OBS-02:** The system shall emit structured logs (JSON) with correlation IDs propagated through every request from edge to storage, enabling end-to-end traceability of a single ingestion or retrieval operation.
- **REQ-OBS-03:** Key operational events (integrity mismatch, purge started/completed, legal hold applied/released, early-deletion request/approval, auth failure spike) shall produce alerts routed to the platform's incident management channel.

### Constraints

- **REQ-CON-01:** The system shall be deployed on the organization's existing cloud infrastructure (AWS, GCP, or Azure) and shall NOT require a separate dedicated hosting environment.
- **REQ-CON-02:** The HSM used for export signing shall be the organization's existing HSM (or cloud KMS with HSM backing, e.g., AWS CloudHSM, Azure Dedicated HSM, GCP Cloud HSM). The system shall integrate via PKCS#11 or the cloud provider's KMS SDK.
- **REQ-CON-03:** The system shall use the organization's existing identity provider (IdP) for user authentication; no separate user directory or credential store shall be maintained.
- **REQ-CON-04:** Evidence storage shall use object storage (S3-compatible, GCS, or Azure Blob) with immutability/Object Lock enabled at the bucket/container level. The system shall NOT implement its own block-level storage.
- **REQ-CON-05:** The full-text search index shall use a managed search service (Elasticsearch, OpenSearch, or equivalent) rather than an embedded index, to ensure separation of storage and search concerns.
- **REQ-CON-06:** The system shall be deployable via the organization's standard CI/CD pipeline and shall use infrastructure-as-code (Terraform or equivalent) for all cloud resources.

### Data Model (Logical)

| Entity | Key Attributes |
|---|---|
| **Artifact** | `id` (UUID), `tenant_id`, `ingested_at` (timestamp), `source` (string), `type` (enum), `content_hash` (SHA-256 hex), `content_size` (bytes), `storage_ref` (object key), `retention_expires_at` (timestamp), `legal_hold` (boolean), `tainted` (boolean), `tags` (JSON key-value map) |
| **AuditEntry** | `id` (UUID), `tenant_id`, `actor_id`, `action` (enum), `resource_type`, `resource_id`, `timestamp`, `source_ip`, `outcome` (allowed/denied), `detail` (JSON) |
| **CustodyRecord** | `id` (UUID), `artifact_id`, `event` (enum: ingested, viewed, exported, tagged, hold_applied, hold_released, purge_requested, purge_approved, purged, tainted), `timestamp`, `actor_id`, `detail` (JSON) |
| **RetentionPolicy** | `id` (UUID), `tenant_id`, `evidence_type`, `retention_days`, `created_at`, `updated_at` |
| **Tenant** | `id` (UUID), `name`, `idp_realm`, `created_at`, `status` (active/suspended) |

### RBAC Role Matrix

| Action | Viewer | Auditor | Admin |
|---|---|---|---|
| Search & view evidence | ✅ | ✅ | ✅ |
| Export (JSON / CSV) | ❌ | ✅ | ✅ |
| Export (signed bundle) | ❌ | ✅ | ✅ |
| Manage tags | ❌ | ❌ | ✅ |
| Apply / release legal hold | ❌ | ❌ | ✅ |
| Request early deletion | ❌ | ❌ | ✅ |
| Approve early deletion | ❌ | ❌ | ✅ |
| Configure retention policies | ❌ | ❌ | ✅ |
| View audit log | ❌ | ✅ | ✅ |
| Manage tenants | ❌ | ❌ | ✅ |

### Integration Interfaces

- **REQ-INT-01:** REST API — JSON over HTTPS. All endpoints versioned via URL prefix (`/api/v1/`). Documented via OpenAPI 3.1 specification.
- **REQ-INT-02:** Syslog ingestion — RFC 5424 compliant receiver on TCP/TLS port 6514. Structured data elements mapped to artifact metadata.
- **REQ-INT-03:** SFTP drop zone — periodic polling of a configurable SFTP path; files deposited are ingested as batch artifacts with metadata derived from filename convention (`{source}_{type}_{timestamp}.{ext}`).
- **REQ-INT-04:** IdP integration — SAML 2.0 Service Provider (SP) metadata and OIDC Relying Party (RP) configuration, supporting Just-In-Time (JIT) provisioning of user records with role mapping from IdP group claims.
- **REQ-INT-05:** Alerting integration — webhook delivery of operational alerts to the organization's incident management system (PagerDuty, Opsgenie, or equivalent).

### Migration & Onboarding

- **REQ-MIG-01:** The system shall provide a bulk ingestion endpoint (`POST /api/v1/artifacts/bulk`) accepting a newline-delimited JSON (NDJSON) payload for importing historical evidence from legacy systems.
- **REQ-MIG-02:** Tenant provisioning shall be scriptable via a management API (`POST /api/v1/admin/tenants`) to support automated onboarding of existing business units.

### Sign-off

_Product Manager: [x] PRD reviewed & approved — 2026-08-03_

_Scope confirmed. The Evidence Reference System PRD accurately captures the product vision: a tamper-evident, multi-tenant evidence repository with WORM storage, cryptographic integrity guarantees, full-text search, RBAC, and signed export bundles. All 7 functional requirements, 25+ system quality attributes, data model, RBAC matrix, and integration interfaces are aligned with the target ICP of Compliance Officers, Security Analysts, DevOps Engineers, and SREs. Out-of-scope items (real-time alerting, source collection, analytics, secret management) are correctly excluded to keep the system focused._

_Business Analyst: [x] Requirements complete — 2026-08-03_

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._