> **PRD** — drafted by Ada (Sr. Product Mgr) · task #585
> _Each agent that updates this PRD signs its change below._

# Secrets Remediation Tracker

## Problem & Goal
Security scanning tools detect exposed secrets (API keys, tokens, passwords) in code repositories and logs. However, teams lack a systematic way to track remediation of these findings. Open secrets issues pile up without clear ownership, follow-up notes, or confirmation that the secret has been rotated/revoked. The risk of an unaddressed active secret remains high.

**Goal:** Provide a dedicated workspace where security and engineering teams can triage, annotate, and close the loop on every detected secret, turning raw findings into tracked, accountable remediation actions.

## Target users / ICP roles
- **Security Engineers** responsible for triaging and ensuring secrets are remediated.
- **Developers / DevOps Engineers** who own the affected code/infrastructure and must rotate secrets and remove them from exposed locations.
- **Site Reliability Engineers (SRE)** who need visibility into lingering secrets affecting production systems.

## Scope
This PRD covers the initial release of a **Secrets Remediation Tracker** integrated into the existing security scanning platform. The tracker will:

- Display a unified list of all secrets issues flagged by the scanner for which remediation has not been confirmed.
- Allow users to annotate issues with remediation notes.
- Support status transitions (open → in progress → remediated, plus false positive/ignored).
- Enable assignment of an owner to each issue.
- Offer basic filtering and sorting to help prioritize high-risk items.
- Include an activity/audit log per issue.

## Functional requirements
1. **Open Issues Dashboard**
   - List all secrets issues that are not in a terminal closed state (remediated, false positive, ignored).
   - Columns: secret type (e.g., AWS key, private key), location (repo/file/line), detection date, owner, status, severity, and latest note snippet.
   - Filters: status, severity (critical/high/medium/low), secret type, owner, date range, repository.
   - Sort by detection date, severity, or status.
   - Paginated view (50 items per page).

2. **Issue Detail Page**
   - Full details: secret type, hash/fingerprint of the secret (masked), exact location, detected on date, scanner version, severity justification.
   - **Remediation Notes** section: threaded comment-like notes with timestamp and author. Each note can include text and optional file attachments (screenshots, confirmation emails).
   - **Status** selector: `Open` (default), `In Progress`, `Remediated`, `False Positive`, `Ignored` (with required reason for ignored/false positive).
   - **Owner** assignment: user search field to set a single responsible user (from integrated identity provider).
   - **Due Date** (optional): date picker for when remediation should be completed.
   - Activity log: chronological list of status changes, owner changes, note additions, and due date modifications.

3. **Notifications**
   - In-app notification to assigned owner when an issue is assigned or due date approaches (24h before). Email notification if user has email configured.
   - Weekly digest for security leads listing overdue open issues.

4. **Bulk Actions**
   - Multi-select to assign an owner, change status, or set due date across multiple issues.

5. **Export**
   - Export filtered issue list as CSV.

## Acceptance criteria
1. A user navigates to the **Secrets Remediation** tab and sees a list of all open and in-progress secrets issues from the last 90 days (configurable).
2. Clicking an issue displays the detail view with all metadata, existing notes, and an activity log.
3. The user can add a remediation note, and it appears in the thread instantly with their name and timestamp.
4. Changing the status to `Remediated` prompts an optional confirmation note; the issue is removed from the default open-issues list but remains visible in an “all issues” view.
5. Setting a due date and assigning an owner triggers an email to that owner 24 hours before the deadline if the issue is still not `Remediated`.
6. Bulk assigning 5 issues to a single owner succeeds, and the activity log for each reflects the change.
7. The dashboard filters correctly; selecting `severity: critical` shows only critical issues.
8. Export generates a CSV with all filtered columns without secrets values (only hashes).

## Out of scope
- Automated rotation or revocation of secrets (human or external system responsibility).
- Secret scanning itself—this feature consumes already-detected findings.
- Full-fledged incident management integration (paging, on-call schedules).
- Customizable workflows or approval chains for status transitions.
- AI-powered remediation suggestions.
- Audit trail export formats beyond CSV.
- Support for issues from external secret scanners not ingested into this platform (only native scanner findings).

## Requirements

> _Authored by Business Analyst — task #585_

### REQ-1: Data Model — Secrets Findings

The tracker operates on **ingested scan findings** sourced from the native detect-secrets baseline (`.secrets.baseline`) produced by the platform's security scanning pipeline. Each finding is stored as a `secrets_finding` row.

**REQ-1.1 — `secrets_findings` table**
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | Auto-incrementing finding ID |
| `tenantId` | `integer` | FK → `tenants.id`, NOT NULL | Tenant scope |
| `projectId` | `integer` | FK → `projects.id`, nullable | Optional project association |
| `secretType` | `varchar(100)` | NOT NULL | Detector label: `AWS Key`, `Private Key`, `GitHub Token`, `Slack Webhook`, `Base64 High Entropy String`, `Hex High Entropy String`, `Secret Keyword`, etc. |
| `hash` | `varchar(64)` | NOT NULL | SHA-1 hash of the secret value (never store plaintext) |
| `location` | `jsonb` | NOT NULL | `{ "repo": string, "file": string, "line": number }` — source location |
| `detectedAt` | `timestamp` | NOT NULL, default NOW() | When the scanner first detected this finding |
| `scannerVersion` | `varchar(20)` | nullable | detect-secrets version (e.g. `1.5.0`) |
| `severity` | `varchar(10)` | NOT NULL, default `'medium'` | `critical`, `high`, `medium`, `low` |
| `severityJustification` | `text` | nullable | Free-text reason for severity assignment (auto-populated or manual override) |
| `status` | `varchar(20)` | NOT NULL, default `'open'` | `open`, `in_progress`, `remediated`, `false_positive`, `ignored` |
| `ownerId` | `varchar(36)` | FK → `users.id`, nullable | Assigned remediation owner |
| `dueDate` | `timestamp` | nullable | Optional remediation deadline |
| `isVerified` | `boolean` | NOT NULL, default `false` | Whether the secret was verified as active by the scanner |
| `ingestionRunId` | `varchar(64)` | nullable | Batch ingestion identifier for idempotency/reconciliation |
| `createdAt` | `timestamp` | NOT NULL, default NOW() | Record creation |
| `updatedAt` | `timestamp` | NOT NULL, default NOW() | Last mutation timestamp |

Unique constraint on `(tenantId, hash, location)` — deduplicates identical findings within the same tenant and location. Row hash + file + line must be unique; if the same secret hash appears at a different line or file, it is a distinct finding.

**REQ-1.2 — `secrets_remediation_notes` table**
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | Auto-incrementing note ID |
| `findingId` | `integer` | FK → `secrets_findings.id` ON DELETE CASCADE, NOT NULL | Parent finding |
| `authorId` | `varchar(36)` | FK → `users.id`, NOT NULL | Who wrote the note |
| `body` | `text` | NOT NULL | Note content |
| `attachments` | `jsonb` | default `'[]'` | Array of `{ "filename": string, "url": string, "mimeType": string }` |
| `createdAt` | `timestamp` | NOT NULL, default NOW() | When note was posted |

**REQ-1.3 — `secrets_activity_log` table**
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | Auto-incrementing event ID |
| `findingId` | `integer` | FK → `secrets_findings.id` ON DELETE CASCADE, NOT NULL | Parent finding |
| `actorId` | `varchar(36)` | FK → `users.id`, nullable | Who performed the action (null for system events) |
| `action` | `varchar(50)` | NOT NULL | Enumeration: `status_change`, `owner_change`, `note_added`, `due_date_change`, `severity_change`, `bulk_update`, `ingested` |
| `detail` | `jsonb` | NOT NULL | `{ "from": string, "to": string, "note": string }` — before/after values |
| `createdAt` | `timestamp` | NOT NULL, default NOW() | Event timestamp |

### REQ-2: Ingestion Pipeline

**REQ-2.1** — The platform SHALL provide an ingestion endpoint that accepts a detect-secrets baseline JSON payload (`.secrets.baseline` format) and upserts findings into `secrets_findings`.

**REQ-2.2** — Ingestion SHALL be idempotent by `(tenantId, hash, location)`; re-ingesting the same baseline SHALL NOT create duplicate findings.

**REQ-2.3** — On ingestion, each new finding SHALL create an `ingested` activity-log entry. Updated findings (changed `is_verified` flag) SHALL log a status-change entry.

**REQ-2.4** — Severity auto-mapping rules:
| Secret Type Pattern | Assigned Severity |
|---|---|
| `AWS Key`, `GitHub Token`, `Private Key`, `Stripe`, `Slack` | `critical` |
| `JWT Token`, `Basic Auth`, `OpenAI`, `Twilio`, `SendGrid` | `high` |
| `Base64 High Entropy String`, `Hex High Entropy String` | `medium` |
| `Secret Keyword` | `low` |

**REQ-2.5** — Findings with `is_verified: false` and a `Secret Keyword` or `Hex/Base64 High Entropy String` type SHALL NOT trigger severity above `medium` unless manually escalated. A verified finding of any type SHALL be bumped one severity tier (low→medium, medium→high, high→critical).

### REQ-3: API Endpoints

All endpoints are tenant-scoped and require authentication via the existing session/auth middleware.

**REQ-3.1 — List findings** `GET /api/secrets/findings`
- Query params: `status`, `severity`, `secretType`, `ownerId`, `projectId`, `repo`, `detectedAfter`, `detectedBefore`, `sort` (`detectedAt`, `severity`, `status`), `order` (`asc`/`desc`), `page` (default 1), `pageSize` (default 50, max 100)
- Returns paginated result: `{ data: Finding[], total: number, page: number, pageSize: number }`
- Excludes findings in terminal state (`remediated`, `false_positive`, `ignored`) unless `status` filter explicitly requests them

**REQ-3.2 — Get single finding** `GET /api/secrets/findings/:id`
- Returns the full finding row with remediation notes (newest first) and activity log (newest first) embedded
- Response shape: `{ finding: Finding, notes: RemediationNote[], activityLog: ActivityLogEntry[] }`

**REQ-3.3 — Update finding** `PATCH /api/secrets/findings/:id`
- Acceptable fields: `status`, `severity`, `severityJustification`, `ownerId`, `dueDate`
- Status transitions SHALL validate: `open → in_progress → remediated` (linear); jump to `false_positive` or `ignored` allowed from any non-terminal state
- Setting status to `false_positive` or `ignored` REQUIRES a `reason` field in the request body
- Setting status to `remediated` MAY include an optional `confirmationNote` string
- Every changed field SHALL produce a corresponding activity-log entry

**REQ-3.4 — Add remediation note** `POST /api/secrets/findings/:id/notes`
- Body: `{ body: string, attachments?: { filename: string, url: string, mimeType: string }[] }`
- Creates a `secrets_remediation_notes` row and a `note_added` activity-log entry

**REQ-3.5 — Bulk update** `POST /api/secrets/findings/bulk`
- Body: `{ findingIds: number[], updates: { status?, ownerId?, dueDate? } }`
- Applies the same mutation to every specified finding
- Creates a `bulk_update` activity-log entry per affected finding
- Max 100 findings per bulk request

**REQ-3.6 — Export CSV** `GET /api/secrets/findings/export`
- Same filter params as list endpoint (REQ-3.1)
- Returns `Content-Type: text/csv` with columns: `id, secretType, hash, file, line, repo, detectedAt, severity, status, ownerId, dueDate`
- SHALL NOT include the secret value (only the hash)

**REQ-3.7 — Ingestion endpoint** `POST /api/secrets/ingest`
- Accepts detect-secrets baseline JSON
- Returns `{ ingested: number, updated: number, skipped: number }` — count of new findings, updated findings, and unchanged findings

### REQ-4: Notifications

**REQ-4.1** — When an owner is assigned to a finding (`ownerId` changes from null/other to a user), an in-app notification SHALL be created for that user. If the user has email notifications enabled in their preferences (`email_preferences` table), an email SHALL also be sent.

**REQ-4.2** — A scheduled job (cron, every 6 hours) SHALL scan for findings with `status IN ('open', 'in_progress')`, `dueDate IS NOT NULL`, `dueDate <= NOW() + interval '24 hours'`, and `dueDate > NOW()`. For each such finding, the assigned owner SHALL receive a "due date approaching" in-app notification.

**REQ-4.3** — A weekly digest (Monday 08:00 tenant-local time) SHALL be compiled for security leads (users with a `security_lead` role or flag): list of all overdue findings (`dueDate < NOW()`) grouped by owner, plus counts of open > 30 days.

### REQ-5: Frontend Routes & Components

**REQ-5.1 — Route** `/secrets` — the Open Issues Dashboard. Default view shows non-terminal findings from the last 90 days. Filter bar at top; paginated table below.

**REQ-5.2 — Route** `/secrets/:id` — Issue Detail Page. Shows full metadata card, remediation notes thread, activity log timeline, and action bar (status selector, owner assignment, due-date picker).

**REQ-5.3** — Navigation: add a "Secrets Remediation" item to the existing security navigation structure, visible to users with permission to view security findings.

### REQ-6: Authorization

**REQ-6.1** — View access to secrets findings SHALL be restricted to users with the `security:read` permission or the tenant Owner/Admin role.

**REQ-6.2** — Mutation access (status changes, owner assignment, note creation, bulk updates) SHALL require the `security:write` permission or the tenant Owner/Admin role.

**REQ-6.3** — The ingestion endpoint SHALL be restricted to system/service-account calls; it SHALL NOT be callable by regular users.

### REQ-7: Non-Functional Requirements

**REQ-7.1** — The list endpoint SHALL return results within 200ms for up to 10,000 findings (indexed query).

**REQ-7.2** — Bulk operations on 100 findings SHALL complete within 2 seconds.

**REQ-7.3** — CSV export for up to 5,000 findings SHALL stream the response; for larger sets, a download link SHALL be provided via async job.

**REQ-7.4** — All mutation endpoints SHALL write to the activity log atomically (same transaction as the data change).

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._