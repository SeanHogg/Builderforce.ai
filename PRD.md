> **PRD** — drafted by Ada (Sr. Product Mgr) · task #769
> _Each agent that updates this PRD signs its change below._
> - Requirements authored by Product Manager (code-creator + test-generator + documentation-agent) — 2025-06-30

# Epic Assignee → Manifest Owner Auto-Update

## Problem & Goal
Manifests that represent epics must reflect the current epic owner. Today, when an epic’s assignee changes, the manifest’s `Owner` field is not automatically updated. Teams must manually recreate the epic or edit the manifest, which is error‑prone, delays delivery visibility, and introduces inconsistency.  
**Goal:** Automatically propagate epic assignee changes to the linked manifest’s `Owner` field in near‑real time, without recreating the epic or requiring manual intervention.

## Target Users / ICP Roles
- **Primary:** Release Train Engineers, DevOps engineers, and Scrum Masters who maintain manifest artifacts tied to epics.
- **Secondary:** Product Managers and Epic Owners who need accurate ownership metadata in downstream automation.

## Scope
- Detect assignee changes on an epic in the tracking system.
- Identify the manifest associated with that epic via an existing link (e.g., epic key, custom field, or predefined mapping).
- Update only the `Owner` field of the manifest.
- Operate automatically; no manual workflow or epic recreation.
- Support both assignment and unassignment events.
- Provide per‑project enable/disable configuration.

## Functional Requirements
1. **Event Detection**  
   The system listens to “assignee changed” events for epics within configured projects.

2. **Manifest Association**  
   When an event is received, the system resolves the corresponding manifest using the epic’s identifier (e.g., Jira issue key).  
   - If no manifest is associated, the event is discarded (no error).

3. **Owner Update**  
   - On assignment: set `Owner` to the new assignee’s canonical identifier (e.g., username, email, or as configured per project).  
   - On unassignment: set `Owner` to a configurable placeholder (default: “Unassigned”) or leave empty per project settings.

4. **Timeliness**  
   The manifest update must complete within **60 seconds** of the assignee change event being published.

5. **Audit Logging**  
   Each update logs: epic key, old assignee, new assignee, manifest identifier, timestamp, and whether the update succeeded.

6. **Epic Preservation**  
   The epic itself is not modified beyond the assignee change. Its key, ID, history, and metadata are unchanged—no new issue creation or recreation occurs.

7. **Configuration**  
   - Boolean project‑level flag to enable/disable the auto‑update.  
   - Configurable placeholder for unassigned owner.  
   - Configuration may be stored in project settings or manifest‑specific metadata.

## Acceptance Criteria
1. **Happy Path:**  
   Given an epic with assignee `UserA` and an associated manifest where `Owner = UserA`,  
   when the assignee is changed to `UserB`,  
   then within 60 seconds the manifest `Owner` is updated to `UserB` without any manual action and the epic’s attributes (key, ID, etc.) remain unaltered.

2. **Unassignment:**  
   Given an assignee is set to “none” (unassigned),  
   then the manifest `Owner` is set to the configured placeholder (e.g., “Unassigned”) or removed, according to project configuration.

3. **Audit Trail:**  
   The system logs the old assignee, new assignee, manifest ID, and a timestamp for each triggered update.

4. **No Epic Recreation:**  
   Verify that the epic’s issue history shows only the assignee change; no new issue creation, no change of key or summary, and no side‑effects that resemble a recreation.

5. **Toggle Off:**  
   When the feature is disabled at the project level, a change to an epic’s assignee does **not** cause any manifest update.

## Out of Scope
- Automatic creation of a manifest from an epic; only existing associations are handled.
- Updating any manifest field other than `Owner` (e.g., title, description, status).
- Bi‑directional sync (updating the epic when the manifest’s Owner changes).
- Bulk assignee operations where multiple epics are changed in a single transaction; behavior is undefined.
- Migration or backfill of historical assignee changes.
- A UI for manually triggering the sync or viewing the configuration beyond project settings.

## Requirements

### REQ-001 — Project Configuration Model
**Priority:** P0 (blocking)  
**Stakeholder:** DevOps / RTE

The system SHALL persist per-project configuration for the auto‑update feature with the following attributes:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | UUID | Yes | — | The project this config applies to |
| `enabled` | boolean | Yes | `false` | Whether epic→manifest Owner sync is active for this project |
| `unassignedPlaceholder` | string | No | `"Unassigned"` | Value written to `Owner` when an epic is unassigned. Empty string `""` means clear the field. |
| `updatedAt` | timestamp | Yes | now() | Last modification time |

- Configuration SHALL be queryable via the existing project-settings infrastructure.
- Changing `enabled` from `true` to `false` SHALL stop future syncs immediately; it does NOT revert prior updates.
- Each project may have at most one configuration record (1:1).
- If no configuration record exists for a project, the feature is treated as disabled (`enabled = false`).

### REQ-002 — Event Ingestion
**Priority:** P0 (blocking)  
**Stakeholder:** RTE / Platform Engineering

The system SHALL expose a webhook endpoint that accepts assignee‑change notifications from external tracking systems (Jira, Linear, Azure DevOps, etc.):

```
POST /api/webhooks/epic-assignee-changed
```

**Request payload (`EpicAssigneeChangedEvent`):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | UUID | Yes | BuilderForce project the epic belongs to |
| `epicKey` | string | Yes | External epic identifier (e.g., `"PROJ-42"`) |
| `oldAssignee` | string \| null | Yes | Canonical identifier of the previous assignee (username, email, or provider‑specific ID). `null` if previously unassigned. |
| `newAssignee` | string \| null | Yes | Canonical identifier of the new assignee. `null` if now unassigned. |
| `sourceProvider` | enum | Yes | `"jira"` \| `"linear"` \| `"azure_devops"` \| `"github"` |
| `timestamp` | ISO‑8601 | Yes | When the assignee change occurred in the source system |

**Validation rules:**
- `projectId` MUST reference an existing BuilderForce project.
- `epicKey` MUST be a non‑empty string ≤ 255 characters.
- `oldAssignee` and `newAssignee` MUST differ (at least one null vs. non‑null, or different values). Identical old/new values SHALL be rejected as a no‑op (HTTP 422).
- `sourceProvider` MUST be a recognised enum value.
- `timestamp` MUST be a valid ISO‑8601 string, not in the future (within a 2‑minute clock‑skew tolerance).

**Rate limiting:** The webhook endpoint SHALL enforce a per‑project rate limit of 50 requests per minute. Requests exceeding the limit SHALL return HTTP 429 with a `Retry-After` header.

### REQ-003 — Manifest Resolution
**Priority:** P0 (blocking)  
**Stakeholder:** RTE

Given a valid `EpicAssigneeChangedEvent`, the system SHALL resolve the manifest associated with the epic as follows:

1. Query the `artifact_manifest` table (or equivalent existing manifest store) for a manifest whose `externalEpicKey` equals the event’s `epicKey` AND whose `projectId` equals the event’s `projectId`.
2. The association field (`externalEpicKey`) SHALL be indexed for efficient lookup.
3. If exactly one manifest is found, proceed to REQ-004 (Owner Update).
4. If zero manifests match, the event SHALL be discarded silently — logged at INFO level, no error returned to the caller.
5. If more than one manifest matches (data integrity anomaly), the system SHALL log a WARNING and skip the update; the webhook SHALL still return HTTP 200 (idempotent acknowledgment) so the sender is not retried into a loop.

### REQ-004 — Owner Update
**Priority:** P0 (blocking)  
**Stakeholder:** Scrum Master / RTE

When a manifest is resolved (REQ-003), the system SHALL update its `Owner` field:

| Scenario | Action |
|----------|--------|
| `newAssignee` is non‑null (assignment) | Set `Owner` = `newAssignee` |
| `newAssignee` is null (unassignment) | Set `Owner` = project config `unassignedPlaceholder` value. If config is absent or the value is `""`, set `Owner` = `null`. |

**Constraints:**
- The update SHALL be an atomic, single‑field mutation — no other manifest fields are modified.
- The update SHALL be performed within the same database transaction boundary as the audit log write (REQ-005) to ensure consistency.
- If the resolved manifest’s current `Owner` already equals the target value (idempotency check), the system SHALL skip the write and log at DEBUG level: “Owner already set to <value> for manifest <id>; no update performed.”
- The full manifest record SHALL NOT be re‑fetched and re‑written — use a targeted `UPDATE … SET owner = … WHERE id = …`.

### REQ-005 — Audit Logging
**Priority:** P1 (high)  
**Stakeholder:** Compliance / Security

Every triggered update (or skipped idempotent update) SHALL produce an audit log entry with the following schema:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique log entry identifier |
| `projectId` | UUID | BuilderForce project |
| `epicKey` | string | External epic identifier |
| `manifestId` | UUID | Resolved manifest identifier (null if no manifest matched) |
| `oldAssignee` | string \| null | Prior assignee from the event |
| `newAssignee` | string \| null | New assignee from the event |
| `oldOwner` | string \| null | Manifest’s Owner value BEFORE the update (null if manifest was not found) |
| `newOwner` | string \| null | Manifest’s Owner value AFTER the update |
| `outcome` | enum | `"updated"` \| `"skipped_idempotent"` \| `"skipped_no_manifest"` \| `"skipped_disabled"` \| `"error"` |
| `errorDetail` | string \| null | Error message when outcome is `"error"` |
| `sourceProvider` | enum | Provider from the event |
| `createdAt` | timestamp | When the audit entry was written |

- Audit entries SHALL be immutable — never updated or deleted after creation.
- The audit log SHALL be queryable for compliance review via existing admin tooling.
- Retention: audit entries SHALL be retained for a minimum of 90 days; archival/deletion policy is governed by the workspace’s data retention settings.

### REQ-006 — Feature Toggle Enforcement
**Priority:** P0 (blocking)  
**Stakeholder:** Product Management

1. On receiving an event, the system SHALL check the project’s configuration (REQ-001) BEFORE performing manifest resolution.
2. If `enabled = false` (or no config record exists), the event SHALL be discarded:
   - Log outcome as `"skipped_disabled"` in the audit log.
   - Return HTTP 200 to the webhook caller (acknowledgment without action).
3. The feature SHALL have NO effect on any project unless explicitly enabled.

### REQ-007 — Error Handling & Resilience
**Priority:** P1 (high)  
**Stakeholder:** Platform Engineering

| Failure mode | Behaviour |
|-------------|-----------|
| Database unavailable during manifest lookup | Return HTTP 503; caller may retry with exponential backoff |
| Database unavailable during Owner write | Return HTTP 503; audit log partially written under a separate connection if possible |
| Manifest lookup succeeds but Owner write fails (e.g., constraint violation) | Log outcome `"error"` with detail; return HTTP 200 (event is acknowledged — do not retry the same payload indefinitely) |
| Malformed request body | Return HTTP 400 with a structured error body indicating which fields failed validation |
| Duplicate event (same epicKey + projectId + oldAssignee + newAssignee within a 60‑second window) | Idempotent; skip the update, log at DEBUG |
| External provider sends an unrecognised `sourceProvider` | Return HTTP 400 |

### REQ-008 — Epics Without Manifests
**Priority:** P2 (medium)  
**Stakeholder:** RTE

When an assignee changes on an epic that has NO associated manifest, the system SHALL:
- Log the event at INFO level.
- Write an audit entry with outcome `"skipped_no_manifest"` and `manifestId = null`.
- Return HTTP 200 to the caller.

This is NOT an error — it is normal for an organisation to have epics that predate manifest creation or epics that are intentionally not represented as manifests. However, the audit trail ensures visibility so RTEs can identify gaps if desired.

### REQ-009 — Observability
**Priority:** P1 (high)  
**Stakeholder:** Platform Engineering / SRE

The system SHALL emit the following metrics (via the existing observability pipeline):

| Metric name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `epic_manifest_owner_update_total` | Counter | `outcome` (`updated` \| `skipped_idempotent` \| `skipped_no_manifest` \| `skipped_disabled` \| `error`), `projectId`, `sourceProvider` | Total update attempts |
| `epic_manifest_owner_update_duration_seconds` | Histogram | `outcome` | Wall‑clock time from event receipt to audit‑log write completion |
| `epic_manifest_owner_update_in_flight` | Gauge | — | Number of updates currently executing |

- The histogram SHALL use buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120] (seconds).
- An SLO alert SHALL fire if the p95 latency exceeds 30 seconds over a 5‑minute rolling window.

### REQ-010 — Schema & Migration
**Priority:** P0 (blocking)  
**Stakeholder:** DBA / Platform Engineering

The following database changes are required:

1. **New table: `epic_manifest_owner_audit_log`** (per REQ-005 schema). Column types SHALL match the existing audit/event‑log conventions in the `api/src/infrastructure/database/schema/` modules.

2. **New column on `artifact_manifest`: `external_epic_key`** (VARCHAR 255, nullable, indexed). This column stores the external epic identifier (e.g., Jira issue key) used for manifest‑epic association. An index `idx_artifact_manifest_epic_key` SHALL be created on `(project_id, external_epic_key)`.

3. **New table: `project_settings` (if not already present) or a `project_epic_sync_config` table** for REQ-001. If a general `project_settings` key‑value store already exists, add the keys `epic_manifest_sync.enabled` (boolean) and `epic_manifest_sync.unassigned_placeholder` (string). Otherwise, create a dedicated table.

### REQ-011 — Security
**Priority:** P0 (blocking)  
**Stakeholder:** Security

1. The webhook endpoint SHALL require authentication. Reuse the existing webhook authentication mechanism (HMAC signature verification or bearer token) already employed by the `boardsync/webhookIngest.ts` module.
2. The endpoint SHALL be rate‑limited per project (REQ-002).
3. Audit log entries SHALL NOT contain PII beyond the assignee identifier (which is already present in the source tracking system).
4. The endpoint SHALL accept only HTTPS traffic (enforced at the infrastructure / Cloudflare layer).

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
