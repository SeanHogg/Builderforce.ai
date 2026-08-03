> **PRD** — drafted by Ada (Sr. Product Mgr) · task #579
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: GAP ID System

## Problem & Goal
**Problem:** The current product ecosystem lacks a unified identifier to correlate user actions, transactions, and support tickets across microservices. This results in fragmented customer views, delayed troubleshooting, and reporting inaccuracies.
**Goal:** Introduce a universally unique `GAP ID` (Generated Accountable Persona Identifier) that is persistent, cross-service, non-reversible, and automatically attached to every critical action, enabling seamless tracing and single-customer-view aggregation.

## Target Users / ICP Roles
- **Customer Support Agents:** Query all user history from one identifier without hopping between systems.
- **DevOps / SRE Engineers:** Trace a failing request across service logs, metrics, and traces.
- **Data Analysts & BI:** Join datasets for funnel, retention, and ROI analysis without fuzzy matching.
- **Product Managers:** View holistic user journeys across product lines to make informed prioritization decisions.

## Scope
### In Scope
- Generation specification and pseudo-random structure of GAP ID.
- Attachment rules: when and how GAP ID joins API requests, events, analytics payloads, and error reports.
- Read API for internal services and admin panel.
- Immutability guarantees and privacy safeguards (non-reversible, non-PII-derivable).
- Migration strategy for existing user records (associate historical data with new GAP IDs).
- Rate-limiting and idempotency handling for generation.

### Out of Scope
- External customer-facing display (GAP ID is never shown to end users).
- Authentication or authorization logic (GAP ID does not replace bearer tokens or API keys).
- Cross-partner or inter-company data sharing (only within the current product suite).
- Real-time notification of ID lifecycle events.
- Multi-region master-master ID generation conflicts (post-MVP consideration).
- Billing or metering related to ID issuance.

## Functional Requirements
1. **ID Generation**
   - Generate an opaque, URL-safe string of exactly 24 characters.
   - Include a 4-character service prefix (`gap_`) and a 2-character checksum/discriminator for basic offline validation.
   - IDs MUST be universally unique (collision probability < 1e-15).
   - Never encode personally identifiable information (PII), timestamps, or sequential data within the ID.

2. **ID Attachment**
   - Auto-inject the GAP ID into:
     - HTTP request headers (`X-GAP-ID`) for all internal service calls originating from user action.
     - Structured log payload (field `gap_id`).
     - Analytics/event streams (top-level attribute `gap_id`).
     - Error and crash reports.
   - Must propagate downstream to any service called synchronously or asynchronously (via span context).

3. **ID Retrieval & Lookup**
   - Provide a gRPC/REST endpoint: `GET /internal/v1/gap-id/resolve?external_user_id=<id>&namespace=<tenant>`
   - Support privacy-preserving reverse lookup only by hashed mapping, never exposing the mapping data to 3rd parties.

4. **Immutability & Storage**
   - Once generated for a user, GAP ID MUST NEVER change.
   - Mapping between native user ID <-> GAP ID stored in an encrypted, access-controlled datastore.
   - Enable soft-deletion policy: mapping retains for 90 days post account deletion for audit/compliance.

5. **Migration & Backfilling**
   - Utility to bulk-assign GAP IDs to existing users without a GAP ID.
   - Updated historical data events re-processed with the new identifier where technically feasible (e.g., re-index logs).

## Acceptance Criteria
- A newly created user gets a GAP ID assigned within 200ms of account creation.
- GAP ID appears in >99.9% of sampled log and analytics payloads post-integration.
- No two active user accounts share the same GAP ID (validated via continuous integration test).
- Lookup endpoint returns correct GAP ID in <100ms p95 latency.
- Migration script successfully assigns GAP IDs to all existing users without interruption to production traffic.
- Customer support team can trace a complete user journey in a single dashboard query using GAP ID.
- ID does not contain PII, sequential counters, or timestamps; validated by automated audit tool.
- Architecture review confirms no single point of failure in generation and no region-conflict edge cases.

## Out of Scope
- Tools/UI for customers to view or manage their own GAP ID.
- Export or API to expose GAP ID to third-party integrations or external vendors.
- Automatic repair of broken/missing GAP ID chains in old archived data.
- Integration with biometric or liveness detection systems.
- Replacement of existing user ID in customer-facing emails, invoices, or promotions.

## Requirements

### RQ-1 — ID Generation Service

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-1.1 | The `GapIdGenerator` module SHALL produce a 24-character URL-safe base64url string (RFC 4648 §5, no padding) on every invocation. | P0 | Non-negotiable structure constraint from FR-1. |
| RQ-1.2 | Every generated ID SHALL have the literal prefix `gap_` (4 characters) followed by 18 random characters then a 2-character checksum, totalling 24 characters. | P0 | Enables offline prefix-based routing and basic integrity check. |
| RQ-1.3 | The random component SHALL be sourced from a cryptographically secure PRNG (CSPRNG) with ≥128 bits of entropy. | P0 | Collision probability < 1e-15 depends on sufficient entropy. |
| RQ-1.4 | The 2-character checksum SHALL be computed as a CRC-8-CCITT over the 18-character random payload, hex-encoded. | P1 | Lightweight offline validation; must not be used as a security primitive. |
| RQ-1.5 | The ID SHALL NOT encode any PII, user attributes, tenant identifiers, timestamps, sequential counters, or machine fingerprints. | P0 | Non-reversibility guarantee from FR-1. A compliance audit tool MUST validate this. |
| RQ-1.6 | Generation SHALL complete in < 5ms p99 (single-threaded, no I/O) and be callable synchronously. | P0 | Must not add latency to the user-creation critical path (AC: 200ms total). |
| RQ-1.7 | The generator SHALL be stateless — it MUST NOT rely on a database sequence, distributed counter, or coordination service to produce IDs. | P0 | Eliminates single point of failure and region-conflict edge cases. |
| RQ-1.8 | A generated ID SHALL be idempotently retryable: if the caller provides a `gap_id_hint` and that hint passes validation, the service SHALL return the hinted ID rather than generating a new one. | P1 | Prevents duplicate generation when a write fails and is retried. |

### RQ-2 — ID Attachment & Propagation

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-2.1 | An `X-GAP-ID` HTTP header SHALL be injected into every internal service-to-service request that originates from a user-authenticated context, via a shared middleware or interceptor. | P0 | Primary propagation mechanism per FR-2. |
| RQ-2.2 | The header SHALL be stripped from any response before it leaves the service mesh; it MUST NEVER be returned to an external client. | P0 | Privacy safeguard: GAP ID is internal-only. |
| RQ-2.3 | Structured logs emitted by any service SHALL include a top-level `gap_id` field when a GAP ID is present in the request context. | P0 | Enables log correlation across services. |
| RQ-2.4 | Analytics/event payloads (e.g., Segment, RudderStack, or internal event bus messages) SHALL include `gap_id` as a top-level attribute on every event associated with a user action. | P0 | Enables single-customer-view aggregation in BI tools. |
| RQ-2.5 | Error and crash reports (Sentry, DataDog RUM, or equivalent) SHALL include `gap_id` in the error context/tags. | P1 | Critical for SRE debugging workflows. |
| RQ-2.6 | The GAP ID SHALL be propagated across async boundaries: it SHALL be attached to span context (OpenTelemetry `Baggage` or equivalent) so that downstream services in a trace receive it even across message queues and async job workers. | P1 | Ensures end-to-end traceability for async workflows. |
| RQ-2.7 | A `gap_id` field SHALL be added to the tenant's audit-log schema; every audit event that names a user SHALL carry the user's GAP ID. | P1 | Supports compliance and SOC 2 audit trails. |

### RQ-3 — Lookup & Resolution API

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-3.1 | A REST endpoint `GET /internal/v1/gap-id/resolve` SHALL accept query parameters `external_user_id` (string, required) and `namespace` (string, required; the tenant/workspace identifier). | P0 | Primary lookup interface per FR-3. |
| RQ-3.2 | The endpoint SHALL return a JSON response `{ "gap_id": "<id>", "external_user_id": "<id>", "namespace": "<ns>", "created_at": "<ISO8601>" }` on success. | P0 | Standardised response contract. |
| RQ-3.3 | When no mapping exists for the given `external_user_id` + `namespace`, the endpoint SHALL return HTTP 404 with body `{ "error": "not_found", "detail": "..." }`. | P1 | Clear failure semantics. |
| RQ-3.4 | The endpoint SHALL authenticate callers via internal service-to-service mTLS or a shared bearer token; it SHALL NOT be reachable from the public internet. | P0 | Access control per FR-3's privacy-preserving constraint. |
| RQ-3.5 | Lookup latency SHALL be < 100ms p95 under normal load (per AC). | P0 | Non-negotiable performance SLO. |
| RQ-3.6 | The lookup SHALL be read-only; it MUST NOT create a mapping for an unknown `external_user_id`. | P1 | Separation of concerns: mapping creation belongs to the user lifecycle, not the lookup path. |
| RQ-3.7 | The internal datastore query SHALL use a hashed/indexed lookup key (SHA-256 of `namespace + ":" + external_user_id`) so the raw `external_user_id` is never stored in plaintext in the mapping index. | P0 | Privacy-preserving reverse lookup per FR-3. |

### RQ-4 — Storage, Immutability & Lifecycle

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-4.1 | The mapping between `native_user_id` and `gap_id` SHALL be stored in a dedicated, access-controlled datastore table: `gap_id_mappings (id, namespace, external_user_id_hash, gap_id, created_at, deleted_at)`. | P0 | Physical data model per FR-4. |
| RQ-4.2 | The `gap_id` column SHALL have a UNIQUE constraint. The `(namespace, external_user_id_hash)` pair SHALL have a UNIQUE constraint. | P0 | Enforces 1:1 immutability per FR-4. |
| RQ-4.3 | An UPDATE to the `gap_id` field SHALL be rejected at the database level (no UPDATE privilege on that column for the application role; only INSERT and SELECT). | P0 | Immutability enforced at the data layer, not just application logic. |
| RQ-4.4 | The mapping row SHALL be soft-deleted (SET `deleted_at = NOW()`) on user account deletion; the row SHALL be retained for 90 days, after which a scheduled cleanup job MAY hard-delete it. | P1 | Supports audit/compliance retention window per FR-4. |
| RQ-4.5 | The `external_user_id_hash` SHALL be computed as `SHA-256(namespace + ":" + external_user_id)` and stored as a hex-encoded string. The raw `external_user_id` SHALL NOT appear in the mapping table. | P0 | Privacy: even if the mapping table is compromised, user IDs are not exposed. |
| RQ-4.6 | All data at rest in the `gap_id_mappings` table SHALL be encrypted (TDE or column-level encryption). | P1 | Defense-in-depth for the mapping datastore. |

### RQ-5 — Migration & Backfilling

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-5.1 | A one-shot migration script SHALL assign GAP IDs to every existing user record that lacks one, processing in batches of ≤1,000 rows per transaction to avoid long-running locks. | P0 | Required for existing-user coverage per FR-5. |
| RQ-5.2 | The script SHALL be idempotent: re-running it SHALL skip users that already have a GAP ID. | P0 | Safe to retry on partial failure. |
| RQ-5.3 | The script SHALL log progress (batch number, rows processed, rows skipped, errors) to structured logs. | P1 | Observability during backfill. |
| RQ-5.4 | The script SHALL be runnable as a dry-run mode (`--dry-run`) that reports how many users would be assigned but makes no changes. | P1 | Operator confidence before production execution. |
| RQ-5.5 | Historical analytics events SHALL be re-processed (backfilled) with the newly assigned GAP ID where the event pipeline supports replay/backfill; at minimum, a `gap_id` column SHALL be added to the events datastore and populated for all records where the user's GAP ID is known. | P2 | Nice-to-have for historical BI continuity; dependent on event pipeline capabilities. |

### RQ-6 — Rate Limiting & Resilience

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-6.1 | A per-namespace rate limiter SHALL cap ID generation to 10,000 requests per second. Burst allowance: 20,000. | P1 | Prevents abuse without constraining legitimate bulk operations. |
| RQ-6.2 | When rate-limited, the service SHALL return HTTP 429 with a `Retry-After` header. | P1 | Standard backpressure signal. |
| RQ-6.3 | The lookup endpoint SHALL be rate-limited independently at 50,000 requests per second per namespace. | P2 | Lookup is read-heavy and cheap; higher ceiling appropriate. |
| RQ-6.4 | The generation service SHALL include a circuit breaker: if the underlying datastore is unreachable for > 5 seconds, fail open with a logged warning and enqueue the mapping for async reconciliation. | P2 | Avoids blocking user creation when the mapping store is degraded. |

### RQ-7 — Observability & Audit

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| RQ-7.1 | Generation, lookup, and migration operations SHALL emit Prometheus-compatible metrics: request count, latency histogram (p50/p90/p99), error count, and rate-limit hits. | P1 | Standard SRE dashboarding. |
| RQ-7.2 | Every generation SHALL log an audit event (to the tenant audit log) recording: timestamp, namespace, `gap_id` (not the raw `external_user_id`), and the calling service identity. | P1 | SOC 2 audit trail. |
| RQ-7.3 | An automated compliance audit tool (scheduled daily) SHALL validate that no generated GAP ID contains PII patterns, timestamps, or sequential counters. | P1 | Continuous enforcement of the non-reversibility requirement. |
| RQ-7.4 | An automated uniqueness test SHALL run in CI on every deployment: generate 100,000 IDs and assert zero collisions. | P1 | Continuous enforcement of uniqueness guarantee. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._