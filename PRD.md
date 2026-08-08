> **PRD** — drafted by Ada (Sr. Product Mgr) · task #569
> _Each agent that updates this PRD signs its change below._

# Evidence References (Logs, Config Snapshots, Probe Results)

## Problem & Goal
Investigations, audits, and incident response are slowed by evidence scattered across siloed tools. Logs, configuration snapshots, and probe results lack a common reference model, making correlation and traceability manual and error-prone. The goal is to provide a unified, lightweight mechanism to attach, reference, and retrieve operational evidence within the platform, ensuring every decision or finding is backed by a non-repudiable, auditable trail.

## Target Users / ICP Roles
- **Site Reliability Engineers (SREs)** – attaching logs/configs to incident timelines.
- **Security Analysts** – collecting forensic evidence during IR.
- **Compliance Auditors** – reviewing evidence for control attestations.
- **Platform/DevOps Engineers** – linking probe results to change tickets.
- **Ideal Customer Profile** – organisations with ≥50 engineers, regulated industries, or mature observability practices.

## Scope
- A central evidence referencing service that ingests, stores, and links evidence (logs, config snapshots, probe results) to platform entities (incidents, changes, audits).
- Immutable evidence records with metadata and provenance.
- Manual addition (copy-paste, file upload) and API-driven ingestion.
- Search, filter, and retrieval of evidence references by context, type, time range.
- Basic rendering of evidence content (plain text, syntax highlighting).
- Role-based access control and evidence integrity (hash, signatures).
- Short- to medium-term retention governed by policy.

## Functional Requirements
1. **Evidence Types** – Support log excerpts, full configuration snapshots, and probe/check result payloads (plain text, JSON, YAML, structured formats).
2. **Context Association** – Bind each evidence reference to one or more context identifiers (e.g., incident ID, change request, audit trail UUID).
3. **Evidence Creation**  
   - Manual: UI with text editor or file upload.  
   - Programmatic: REST API accepting evidence payload along with context and type.  
   - Webhook integration for automated attachment from alerting or monitoring tools.
4. **Metadata & Immutability** – Automatically capture:
   - Capture timestamp  
   - Ingested-by user or system identity  
   - Original source system  
   - Evidence type  
   - Content hash (SHA-256) for integrity  
   - Optional custom tags  
   Once created, an evidence record is immutable (no editing of content).
5. **Search & Filter** – Query by context ID, evidence type, date range, source, tags. Full-text search within content optional (basic keyword index).
6. **Viewing** – Inline display of evidence with line numbers, syntax highlighting (if format detected), collapsible long content. Show metadata pane.
7. **Export** – Export selection as a bundled report (PDF/JSON) with integrity hashes.
8. **Permissions** – Roles: Evidence Viewer, Evidence Creator, Admin. Fine-grained access can be scoped by project/team contexts.
9. **Retention** – Configurable per evidence type or context; evidence soft-deleted after expiration; audit log retains deletion event.

## Acceptance Criteria
- A user can attach a log snippet to an incident via UI; the evidence record is created, stored, and displayed with all metadata.
- API endpoint accepts evidence payload, returns a reference ID and content hash; subsequent GET retrieves identical content and metadata.
- Evidence objects cannot be modified (write-once); attempted modification returns 403.
- Search returns results within 2 seconds for up to 10,000 references; pagination supported.
- Evidence references are exportable with hashes; imported bundle validates integrity.
- Deleting evidence via UI/API marks it as retired and logs the action; standard users cannot permanently purge.
- RBAC: user without “Evidence Viewer” role cannot fetch evidence for a context.
- Webhook ingestion: when an alert system sends a probe result JSON, a new evidence reference is linked to the specified ticket ID.

## Out of Scope
- Real-time log streaming or historical log analytics (e.g., ELK stack).
- Automatic collection of evidence without explicit trigger (no agent-based scraping).
- Full configuration management DB (CMDB) integration (references only, not diffing or versioning configurations).
- Probes execution or scheduling (only result consumption).
- Long-term archival (beyond 90 days) or cold storage (handled by external data lake).
- Advanced content redaction, correlation, or anomaly detection on evidence data.

## Requirements

> Authored by the Business Analyst · task #569

### REQ-1: Evidence Data Model

Each evidence record SHALL conform to the following canonical schema:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | UUID (v7) | Auto | Unique evidence reference identifier. |
| `context_ids` | UUID[] | Yes | One or more platform entity IDs this evidence is bound to (e.g. incident ID, change request ID, audit UUID). At least one required. |
| `evidence_type` | Enum | Yes | `log_excerpt`, `config_snapshot`, `probe_result`, `other`. Extensible. |
| `content` | Text / Blob | Yes | The raw evidence payload (plain text, JSON, YAML, or structured). Max 10 MB per record. |
| `mime_type` | String | Auto | Detected or declared content type: `text/plain`, `application/json`, `application/x-yaml`, `application/octet-stream`. |
| `source_system` | String | No | Originating system label (e.g. `prometheus`, `datadog`, `terraform`, `manual`). |
| `captured_at` | ISO 8601 | Auto | Server-side timestamp at ingestion. |
| `ingested_by` | String | Auto | User ID or system identity that submitted the evidence. |
| `content_hash` | String (hex) | Auto | SHA-256 digest of the content payload, computed at ingestion. |
| `tags` | String[] | No | Freeform tags for categorisation (max 20 tags, each ≤64 chars). |
| `status` | Enum | Auto | `active` (default), `retired` (soft-deleted), `expired` (retention policy). |
| `retired_at` | ISO 8601 | Conditional | Populated when status transitions to `retired` or `expired`. |
| `retired_by` | String | Conditional | Identity that triggered soft-deletion. |
| `created_at` | ISO 8601 | Auto | Record creation timestamp. |
| `updated_at` | ISO 8601 | Auto | Always equals `created_at` for evidence (immutable after write); reflects metadata-only changes (status, tags). |

**Rules:**
- R1.1: `content` and metadata fields (except `tags` and status fields) are write-once. Any attempt to modify `content` after creation MUST be rejected with HTTP 403 and a descriptive error.
- R1.2: `tags` MAY be appended or removed post-creation by users with Evidence Creator role or Admin; tag mutations MUST be audit-logged.
- R1.3: `context_ids` MAY be extended (additional context IDs appended) post-creation; existing IDs MUST NOT be removed. Extensions require Evidence Creator role.
- R1.4: `content_hash` MUST be recomputed and verified when content is validated on read. If the hash no longer matches, the record is flagged as `compromised` and an alert raised.

### REQ-2: Evidence Ingestion API

#### REQ-2.1: Create Evidence

**POST /api/v1/evidence**

Request body (JSON):
```json
{
  "context_ids": ["uuid", ...],
  "evidence_type": "log_excerpt | config_snapshot | probe_result | other",
  "content": "<string | base64-encoded for binary>",
  "source_system": "string (optional)",
  "tags": ["string", ...],
  "mime_type_override": "string (optional)"
}
```

Response (201 Created):
```json
{
  "id": "uuid",
  "content_hash": "sha256hex",
  "created_at": "ISO8601",
  "status": "active"
}
```

- Authentication: Required (Bearer token or API key).
- Authorisation: Caller MUST possess `evidence:create` permission.
- Validation:
  - `context_ids` MUST contain at least one valid UUID.
  - `evidence_type` MUST be a recognised enum value.
  - `content` MUST be non-empty and ≤10 MB.
  - If `mime_type_override` is provided, it MUST match the detected format or the request is rejected (400).
- Content-type negotiation: Accepts `application/json` and `multipart/form-data` (for file uploads).
- Rate limit: 100 requests/minute per authenticated principal.

#### REQ-2.2: Retrieve Evidence

**GET /api/v1/evidence/{id}**

Response (200):
```json
{
  "id": "uuid",
  "context_ids": ["uuid", ...],
  "evidence_type": "log_excerpt",
  "content": "<string>",
  "mime_type": "text/plain",
  "source_system": "prometheus",
  "captured_at": "ISO8601",
  "ingested_by": "user-id",
  "content_hash": "sha256hex",
  "tags": ["tag1"],
  "status": "active",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

- Authentication: Required.
- Authorisation: Caller MUST possess `evidence:view` AND be scoped to at least one of the evidence record's `context_ids` (project/team membership check).
- If `status` is `retired` or `expired`, only Admins may retrieve (return 404 for non-Admins).

#### REQ-2.3: Search Evidence

**GET /api/v1/evidence?context_id={uuid}&evidence_type={type}&source={source}&tag={tag}&status={status}&from={ISO}&to={ISO}&q={keyword}&page={int}&page_size={int}**

- All parameters optional; combining filters narrows results (AND logic).
- `q` performs keyword search against content (basic inverted index; not full-text relevance ranking in MVP).
- Response (200): Paginated list with `total`, `page`, `page_size`, `results[]`.
- Performance: Response MUST return within 2 seconds for up to 10,000 matching records.
- Authorisation: Results MUST be scoped to contexts the caller can access; records where the caller lacks `evidence:view` on ALL context_ids MUST be excluded (not leaked in count).

#### REQ-2.4: Retire Evidence (Soft-Delete)

**DELETE /api/v1/evidence/{id}**

- Sets `status` → `retired`, populates `retired_at`, `retired_by`.
- Content and metadata are preserved; record is hidden from non-Admin queries.
- Authorisation: Caller MUST possess `evidence:delete` OR be an Admin.
- Permanent purge is NOT available via API (out of scope; handled by retention background job).
- Response: 204 No Content.
- Audit event logged: `evidence.retired` with actor, timestamp, evidence ID.

#### REQ-2.5: List Evidence Tags

**GET /api/v1/evidence/tags?context_id={uuid}**

- Returns unique tags across all evidence (optionally scoped to a context).
- Response (200): `{ "tags": ["string", ...] }`.

#### REQ-2.6: Export Evidence Bundle

**POST /api/v1/evidence/export**

Request body:
```json
{
  "evidence_ids": ["uuid", ...],
  "format": "json | pdf"
}
```

Response (200):
- `format=json`: Returns a JSON bundle with `{ exported_at, evidence: [...] }` where each record includes `content_hash` and `content`.
- `format=pdf`: Returns a PDF with each evidence record rendered (metadata header + content with syntax highlighting).
- Bundle MUST include a top-level integrity hash (SHA-256 of concatenated content hashes in order).
- Max 100 records per export request.

#### REQ-2.7: Validate Import Bundle

**POST /api/v1/evidence/validate**

Request body: The exported JSON bundle.

Response (200):
```json
{
  "valid": true|false,
  "mismatches": [
    { "evidence_id": "uuid", "expected_hash": "...", "actual_hash": "..." }
  ]
}
```

### REQ-3: Webhook Ingestion

**POST /api/v1/hooks/evidence**

- Unauthenticated endpoint secured by per-source webhook secret (HMAC signature verification in header `X-Evidence-Signature`).
- Payload shape matches REQ-2.1 Create Evidence with an additional `secret_id` field identifying the webhook configuration.
- On success, evidence is created and linked to the specified `context_ids`; response mirrors REQ-2.1 (201).
- On signature mismatch: 401 Unauthorized.
- Webhook configurations are managed by Admins via **GET/POST/DELETE /api/v1/admin/webhooks**:
  - `id`, `name`, `secret_hash` (stored as bcrypt), `allowed_source_systems`, `default_tags`, `enabled` boolean.
- Rate limit: 300 requests/minute per webhook configuration.

### REQ-4: User Interface Requirements

#### REQ-4.1: Evidence Attachment (Create)

- Available from incident detail, change request detail, and audit trail views as an "Attach Evidence" action.
- Opens a modal with:
  - **Context pre-filled** (the entity the user is viewing).
  - **Evidence type** dropdown (log_excerpt, config_snapshot, probe_result, other).
  - **Content input**: text editor area (with line numbers) OR file upload drop-zone (drag-and-drop, ≤10 MB).
  - **Source system** text field (free-text with autocomplete from previously used values).
  - **Tags** input (free-tag with autocomplete from REQ-2.5).
- On submit, calls REQ-2.1; on success, the evidence appears in the entity's evidence list.
- Loading and error states MUST be surfaced inline.

#### REQ-4.2: Evidence Viewer

- Renders evidence content:
  - **Plain text / log excerpts**: monospace font, line numbers, word-wrap toggle.
  - **JSON**: syntax-highlighted with collapsible nodes (tree view).
  - **YAML**: syntax-highlighted.
  - **Other**: rendered as plain text.
- Content exceeding 500 lines is collapsed with a "Show all" toggle.
- **Metadata pane**: sidebar or collapsible section showing all metadata fields (`id`, `context_ids`, `evidence_type`, `mime_type`, `source_system`, `captured_at`, `ingested_by`, `content_hash`, `tags`, `status`, `created_at`).
- "Copy content" and "Copy hash" buttons.
- "Export" action (triggers REQ-2.6 for this single record).

#### REQ-4.3: Evidence List & Search

- Tab or section on incident/change/audit detail views showing attached evidence.
- **Search bar**: keyword search within evidence content for the current context.
- **Filters**: evidence type dropdown, source system, date range picker, tags multi-select.
- Results displayed as cards with: evidence type icon, source system, first 2 lines of content preview, capture timestamp, status badge.
- Clicking a card opens the Evidence Viewer (REQ-4.2).

#### REQ-4.4: Evidence Export (UI)

- Multi-select checkboxes on evidence list.
- "Export selected" button → triggers REQ-2.6; browser downloads the bundle.
- "Export all filtered" option for bulk export.

### REQ-5: Role-Based Access Control (RBAC)

Three evidence-specific roles, managed within the existing platform RBAC framework:

| Role | Permissions |
|---|---|
| **Evidence Viewer** | `evidence:view` — can search and retrieve evidence for contexts they are a member of. |
| **Evidence Creator** | `evidence:view`, `evidence:create`, `evidence:tag` — can attach evidence, modify tags. |
| **Evidence Admin** | All of above + `evidence:delete` — can soft-delete evidence, manage webhooks, configure retention policies. |

- R5.1: Platform Admins inherit Evidence Admin by default.
- R5.2: Fine-grained scoping: a principal's `evidence:view` is constrained to contexts (projects/teams) they belong to. Cross-context access requires explicit assignment or Admin role.
- R5.3: API responses MUST NOT include evidence records (or their metadata) for contexts the caller cannot access. The existence of such records MUST NOT be inferable from response counts or error messages.
- R5.4: All evidence access, creation, tag mutation, and deletion events are recorded in the platform audit log with principal, action, timestamp, evidence ID, and context IDs.

### REQ-6: Retention Policy

- R6.1: Default retention period is 90 days from `created_at`.
- R6.2: Retention periods are configurable per `evidence_type` and per `context_id` (project/team) by an Evidence Admin.
  - Configuration endpoint: **PUT /api/v1/admin/retention** with body `{ "scope": { "context_id"?: uuid, "evidence_type"?: string }, "days": int }`.
  - A `days` value of `-1` means indefinite retention.
- R6.3: A scheduled background job runs daily:
  - Identifies evidence where `created_at + retention_days < now()` and `status = active`.
  - Transitions them to `status = expired`, sets `retired_at`, `retired_by = system`.
  - Logs an audit event `evidence.expired` per record.
- R6.4: Expired/retired evidence is hidden from non-Admin queries and excluded from search results.
- R6.5: Permanent data purging from storage is OUT OF SCOPE for MVP (but the schema and status model support it as a future background job on `expired` records beyond a hard-delete threshold, e.g. 365 days).

### REQ-7: Audit Logging

Every mutating operation on evidence SHALL produce an immutable audit event:

| Event | Trigger | Payload |
|---|---|---|
| `evidence.created` | POST /api/v1/evidence | `evidence_id`, `context_ids`, `evidence_type`, `content_hash`, `actor`, `source_system` |
| `evidence.accessed` | GET /api/v1/evidence/{id} | `evidence_id`, `actor` |
| `evidence.searched` | GET /api/v1/evidence?q=... | `actor`, `query_params`, `result_count` |
| `evidence.tags_updated` | Tag mutation | `evidence_id`, `actor`, `added_tags`, `removed_tags` |
| `evidence.retired` | DELETE /api/v1/evidence/{id} | `evidence_id`, `actor` |
| `evidence.expired` | Retention job | `evidence_id`, `retention_policy_days` |
| `evidence.exported` | POST /api/v1/evidence/export | `actor`, `evidence_ids[]`, `format`, `bundle_hash` |

- R7.1: Audit events are stored in the platform audit log with a minimum 7-year retention (per SOC 2 / compliance posture).
- R7.2: Audit events are NOT deletable by any role (even Admin).
- R7.3: Audit log is queryable by Admins via **GET /api/v1/admin/audit?entity_type=evidence&from=...&to=...&actor=...**.

### REQ-8: Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Availability** | Evidence API 99.9% uptime SLA. Read path is prioritised over write path. |
| **Latency** | Create: ≤500ms p95. Retrieve: ≤200ms p95. Search: ≤2s for 10K records. Export: ≤5s for 100 records. |
| **Scalability** | Support ≥100,000 evidence records per tenant. Search performance degrades linearly with record count. |
| **Durability** | Evidence content stored with replication (≥3 copies). Content hash verified on every read. |
| **Security** | All API traffic over TLS 1.3. Content encrypted at rest (AES-256). Secrets (webhook keys, API keys) stored as hashed values only. |
| **Data Residency** | Evidence content stored in the same region as the tenant's primary data store. |
| **API Versioning** | URL-path versioning (`/api/v1/...`). Backward-compatible changes within v1; breaking changes require v2. |

### REQ-9: Integration & Dependencies

- **Platform Auth Service**: Evidence API delegates authentication to the platform's existing IdP/OAuth2 service. Accepts the platform's standard Bearer token.
- **Platform Context Service**: Context ID validation (checking that a supplied incident/change/audit UUID exists) is delegated. Evidence service MUST NOT create dangling references but MAY accept context IDs that resolve to a tombstone (deleted entity).
- **Platform Audit Service**: Audit events are emitted to the platform's central audit log.
- **Platform Notification Service**: Hash-mismatch compromises (see R1.4) MUST generate a notification to the context's owners and the security team.
- **Storage Backend**: Evidence content stored in an append-only object store (S3-compatible) with the evidence ID as the object key. Metadata stored in a relational database (PostgreSQL) with row-level security enforcing context scoping.

### REQ-10: Error Handling & Edge Cases

| Scenario | HTTP Status | Behaviour |
|---|---|---|
| Missing required field | 400 | Descriptive error with field name. |
| Invalid context_id (malformed UUID) | 400 | "context_ids[0]: must be a valid UUID". |
| Content exceeds 10 MB | 413 | "Payload too large. Maximum 10 MB per evidence record." |
| Unsupported evidence_type | 400 | "evidence_type must be one of: …". |
| Evidence not found or not authorised | 404 | Identical response whether absent or forbidden (prevents enumeration). |
| Attempt to modify immutable field | 403 | "Evidence content is immutable. Create a new evidence record for updated data." |
| Attempt to mutate retired/expired evidence | 410 | "Evidence record is retired/expired and cannot be modified." |
| Rate limit exceeded | 429 | Retry-After header; "Too many requests." |
| Webhook signature mismatch | 401 | "Invalid webhook signature." |
| Export exceeds 100 records | 400 | "Maximum 100 evidence records per export. Use paginated search and export in batches." |
| Concurrent tag update conflict | 409 | "Evidence tags were modified by another request. Retry with current state." |

### REQ-11: Assumptions

- A11.1: The platform's existing incident, change request, and audit entities have stable UUIDs that can be used as `context_ids`.
- A11.2: The platform has an existing RBAC framework (role/permission model) that evidence roles plug into.
- A11.3: The platform has an existing audit log service; evidence emits events into it rather than maintaining its own.
- A11.4: File uploads and paste-based content are the primary manual ingestion paths; a rich-text/structured evidence builder is deferred.
- A11.5: Evidence content is treated as opaque by the service; no server-side parsing, enrichment, or transformation occurs beyond MIME detection and hash computation.

### REQ-12: Out-of-Scope Clarifications (Traceability)

| Functional Requirement | In Scope (MVP) | Deferred / Out of Scope |
|---|---|---|
| Evidence types (FR-1) | log_excerpt, config_snapshot, probe_result, other | Custom extensible type registries |
| Context association (FR-2) | One or more context UUIDs per record | Hierarchical or inherited contexts |
| Evidence creation (FR-3) | UI (modal), REST API, Webhook | Bulk CSV import, CLI tool, SDK |
| Immutability (FR-4) | Write-once content, append-only tags & context_ids | Cryptographic signing (planned v2) |
| Search & filter (FR-5) | Structured filters + basic keyword index | Full-text search with relevance ranking (planned v2) |
| Viewing (FR-6) | Syntax highlighting for JSON/YAML, line numbers, collapsible | Diff viewer, side-by-side compare |
| Export (FR-7) | JSON + PDF with integrity hashes | Scheduled recurring exports |
| Permissions (FR-8) | Three roles (Viewer, Creator, Admin) with context scoping | Attribute-based access control (ABAC) |
| Retention (FR-9) | Configurable per-type/per-context, daily expiry job | Tiered storage (hot/warm/cold), legal hold |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._