> **PRD** — drafted by Ada (Sr. Product Mgr) · task #583
> _Each agent that updates this PRD signs its change below._
> - Business Analyst (code-creator): Requirements section — grounded in existing codebase failure surfaces, audit infra, and permission model.

# Product Requirements Document (PRD): Remediation Notes for Failures

## Problem & Goal
Failures in automated test runs, deployments, or incidents often recur because root causes and fix steps are not systematically documented alongside the failure record. Teams lose time re-investigating known issues, and knowledge remains siloed in chat or individual heads.  
**Goal:** Provide a structured, persistent way to attach human‑written remediation notes directly to any failure entity, making corrective actions visible, searchable, and shareable across the team.

## Target users / ICP roles
- Developers and QA engineers who own the failing test or code path  
- DevOps / SRE engineers handling deployment failures or infrastructure incidents  
- Support engineers and on‑call responders who need reproducible fix steps  
- Engineering managers who review failure trends and recurrence rates

## Scope
**In scope**
- Create, read, update, and soft‑delete remediation notes attached to a failure record (test run, deployment event, incident, etc.)
- Rich‑text (Markdown) note body with automatic hyper‑linking of URLs and references to issue trackers
- Metadata per note: author, timestamp (created/updated), optional status (`draft`, `resolved`, `in-progress`) and a private/public toggle
- Ability to link multiple notes to one failure and one note to multiple failures (cross‑linking)
- Full‑text search across note content, and filter by status, author, or date range
- View/edit history (audit log) for each note
- Role‑based access control: viewers, editors, and admins (admins can delete permanently)
- Inline editing from failure detail views in existing dashboards
- API endpoints for external integrations

**Out of scope**
- Automatic generation of remediation notes from logs or runbooks
- Machine‑learning suggestions or similarity detection between failures
- Full‑fledged document collaboration (simultaneous editing, comments)
- Integration with external knowledge‑management platforms beyond simple linking
- Migration of pre‑existing remediation notes from other systems (can be addressed as a separate project)

## Functional requirements
1. **Note creation** – A user with edit rights can add a note to any failure via a modal or inline editor; the note must contain a title (max 200 chars) and a body (max 20k chars, Markdown).  
2. **Note lifecycle** – Notes can be soft‑deleted (hidden but recoverable by admins). Hard deletion is an admin‑only action that removes the record and its audit history.  
3. **Status and visibility** – Each note has a status (`draft`, `in-progress`, `resolved`, `archived`) and a visibility flag (public to the team or private to author). Only public notes appear in searches for other users.  
4. **Cross‑linking** – When viewing a note, the system shows all associated failure records. Users can attach an existing note to a new failure via a search‑and‑link dialog.  
5. **Search & filtering** – A global search bar accepts text that matches title or body content. Filter chips allow narrowing by status, author, date range, or failure type.  
6. **Audit trail** – Every change (create, edit, status change, visibility toggle, link/unlink, delete) generates an audit entry with who, what, and when, visible on the note’s history panel.  
7. **Notifications** – When a note is created or its status changes, relevant stakeholders (e.g., failure assignee, watchers) receive a notification (in‑app and optional email).  
8. **API** – REST endpoints for CRUD operations on notes, linking, and search, mirroring the UI capabilities.  
9. **Access control** – Permissions are checked against the failure record’s project/team ownership; a separate role `failure_notes_admin` allows hard‑delete and global audit access.  

## Acceptance criteria
1. A developer opens a failed test run detail page, clicks “Add Remediation Note”, enters a title and body, selects “draft” status, and saves. The note appears in the failure’s notes list with the author’s name and creation time.
2. An SRE views a deployment failure, sees two existing notes, clicks one to edit, changes its body and sets status to “resolved”. The note’s history shows the edit event; a notification is sent to the failure’s assignees.
3. A QA engineer uses the global search to find notes containing “timeout”. Results show notes across all failure types, filtered by “resolved” status. Clicking a result opens the note with its linked failures listed.
4. An admin hard‑deletes a note from the admin panel; the note disappears from all linked failures, and its audit log remains accessible to admins for 90 days.
5. A service account uses the API to create a remediation note attached to a failure ID, with public visibility. The note is immediately searchable in the UI by authorized users.
6. A user without edit permissions attempts to add a note to a failure; the UI hides the “Add Note” button, and the API returns a 403 error.
7. A note’s cross‑links are updated: a user links an existing note to a second failure; both failures now show the note, and the note’s detail view shows both linked failures.

## Out of scope
- Automatic remediation runbook execution or triggering CI/CD jobs from notes
- Integration with natural‑language processing to categorize failures
- Custom note templates or mandatory fields beyond title and body
- Bulk import/export of remediation notes
- Real‑time collaborative editing (OT/CRDT)
- Comment threads on notes (notes are immutable except for status and body edits, which generate new versions)

## Requirements

_Owned by the business-analyst — to be authored._

### R1 — Failure‑type taxonomy

The system MUST attach remediation notes to a polymorphic "failure" target. The following existing entities qualify as note‑linkable failure surfaces:

| Failure type key | Existing table | Join column | Scope |
|---|---|---|---|
| `prod_incident` | `prod_incidents` (governance.ts) | `id` (uuid) | Tenant‑scoped; already has assignee, watchers, and timeline (`incidentEvents`) |
| `security_incident` | `security_incidents` (governance.ts) | `id` (uuid) | Tenant‑scoped; separate lifecycle from prod incidents |
| `deployment_event` | `deploymentEvents` (delivery.ts) | `id` (uuid) | Project‑scoped; filtered by `isFailure = true` |
| `pr_reconciliation_error` | `prReconciliationErrors` (delivery.ts) | `id` (uuid) | Project‑scoped |
| `qa_finding` | `qaFindings` (delivery.ts) | `id` (uuid) | Project‑scoped; tied to QA exploration runs |
| `vulnerability_finding` | `vulnerabilityFindings` (delivery.ts) | `id` (uuid) | Tenant‑scoped; from security scans |
| `error_event` | `errorEvents` (delivery.ts, `error_collectors` → `errorEvents`) | `id` (uuid) | Project‑scoped; ingested from error collectors |
| `monitor_event` | `monitorEvents` (delivery.ts) | `id` (uuid) | Project‑scoped; synthetic monitor check failures |

A note may link to one or more failure targets; the junction table `remediation_note_failures` provides the M:N relationship. The `failure_type` discriminator (`prod_incident`, `deployment_event`, …) MUST be stored alongside each link so the system can route and display notes without polymorphic joins.

Rationale: The codebase already has these eight failure tables (see `api/src/infrastructure/database/schema/governance.ts` lines ~303‑369, `delivery.ts` lines ~91‑114, ~653‑680, ~743‑761, ~817‑880, ~901‑975); a polymorphic approach reuses them instead of requiring a new unified failure table or migration of historical data.

### R2 — Database schema

Two new tables in the `governance` schema module (`api/src/infrastructure/database/schema/governance.ts`):

**`remediationNotes`**
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `tenantId` | `integer` | NOT NULL, FK → `tenants.id` ON DELETE CASCADE | |
| `title` | `varchar(200)` | NOT NULL | |
| `body` | `text` | NOT NULL | Markdown; max 20 000 chars enforced in application layer |
| `status` | `varchar(16)` | NOT NULL, default `'draft'` | One of `draft`, `in_progress`, `resolved`, `archived` |
| `visibility` | `varchar(8)` | NOT NULL, default `'public'` | `public` or `private` |
| `authorId` | `varchar(36)` | NOT NULL, FK → `users.id` ON DELETE SET NULL | `ON DELETE SET NULL` so notes survive user deletion |
| `deletedAt` | `timestamp` | nullable | Soft‑delete marker; non‑null = hidden |
| `createdAt` | `timestamp` | NOT NULL, `defaultNow()` | |
| `updatedAt` | `timestamp` | NOT NULL, `defaultNow()` | |

Indexes:
- `idx_remediation_notes_tenant` on (`tenantId`, `createdAt` DESC)
- `idx_remediation_notes_author` on (`authorId`, `createdAt` DESC)
- `idx_remediation_notes_status` on (`tenantId`, `status`)
- Full‑text search index: `idx_remediation_notes_search` — a GIN index on `to_tsvector('english', title || ' ' || body)` (PostgreSQL full‑text search)

**`remediationNoteFailures`** (junction)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `noteId` | `uuid` | NOT NULL, FK → `remediationNotes.id` ON DELETE CASCADE | |
| `failureType` | `varchar(32)` | NOT NULL | One of the eight keys in R1 |
| `failureId` | `uuid` | NOT NULL | The PK of the target failure row |
| `linkedAt` | `timestamp` | NOT NULL, `defaultNow()` | |
| `linkedBy` | `varchar(36)` | NOT NULL, FK → `users.id` ON DELETE SET NULL | |

Unique constraint: `uq_note_failure` on (`noteId`, `failureType`, `failureId`) — prevents duplicate links.
Index: `idx_note_failures_target` on (`failureType`, `failureId`) — enables "show all notes for this failure."

**`remediationNoteVersions`** (audit log)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `noteId` | `uuid` | NOT NULL, FK → `remediationNotes.id` ON DELETE CASCADE | |
| `actorId` | `varchar(36)` | NOT NULL, FK → `users.id` ON DELETE SET NULL | |
| `action` | `varchar(24)` | NOT NULL | `created`, `edited`, `status_change`, `visibility_toggle`, `linked`, `unlinked`, `soft_deleted`, `restored`, `hard_deleted` |
| `diff` | `jsonb` | nullable | Structured before/after for the changed fields: `{ "field": "status", "from": "draft", "to": "resolved" }` or `{ "field": "body", "lengthBefore": 420, "lengthAfter": 510 }` |
| `createdAt` | `timestamp` | NOT NULL, `defaultNow()` | |

Index: `idx_note_versions_note` on (`noteId`, `createdAt` DESC).

Rationale: The audit pattern mirrors the existing `incidentEvents` timeline table (governance.ts line ~830) but is dedicated to notes so that the note history panel is self‑contained. The `diff` column stores structured change data rather than raw text diffs to support the history panel UI.

### R3 — Domain model

A new domain module at `api/src/domain/remediation/` containing:

- **`RemediationNote.ts`** — value object / entity:
  - `id: string` (uuid)
  - `tenantId: number`
  - `title: string` (max 200 chars)
  - `body: string` (max 20 000 chars, validated in the entity constructor)
  - `status: NoteStatus` (enum: `draft`, `in_progress`, `resolved`, `archived`)
  - `visibility: NoteVisibility` (enum: `public`, `private`)
  - `authorId: string`
  - `isDeleted: boolean` (derived from `deletedAt !== null`)
  - `createdAt: Date`
  - `updatedAt: Date`
  - `linkedFailures: LinkedFailure[]`

- **`LinkedFailure.ts`** — value object:
  - `failureType: FailureType` (union of the eight literal keys)
  - `failureId: string`

- **`IRemediationNoteRepository.ts`** — repository interface:
  - `create(note: CreateRemediationNoteInput): Promise<RemediationNote>`
  - `findById(id: string, tenantId: number): Promise<RemediationNote | null>`
  - `update(id: string, patch: Partial<UpdateRemediationNoteInput>): Promise<RemediationNote>`
  - `softDelete(id: string, actorId: string): Promise<void>`
  - `hardDelete(id: string): Promise<void>`
  - `restore(id: string, actorId: string): Promise<RemediationNote>`
  - `search(query: RemediationNoteSearchQuery): Promise<RemediationNote[]>`
  - `listByFailure(failureType: FailureType, failureId: string, opts?: { status?: NoteStatus; includePrivate?: boolean; viewerId?: string }): Promise<RemediationNote[]>`
  - `link(noteId: string, failureType: FailureType, failureId: string, actorId: string): Promise<void>`
  - `unlink(noteId: string, failureType: FailureType, failureId: string, actorId: string): Promise<void>`
  - `getVersions(noteId: string): Promise<RemediationNoteVersion[]>` — for the history panel

### R4 — Application service

A new service at `api/src/application/remediation/RemediationNoteService.ts` with the following methods:

- **`create(input: CreateNoteInput, actor: RequestActor): Promise<RemediationNote>`**
  - Validates title length (1‑200 chars) and body length (1‑20 000 chars)
  - Validates that `failureType` is a recognised key
  - Checks that the actor has edit permission on the target failure's project/tenant (see R7)
  - Persists the note, the junction row(s), and an audit version (`action: 'created'`)
  - Sends notification to the failure's assignees (see R8)
  - Returns the created note

- **`update(input: UpdateNoteInput, actor: RequestActor): Promise<RemediationNote>`**
  - Validates body length if body is provided
  - Compares old vs new values to generate a structured `diff`
  - Records an audit version with the appropriate `action` (`edited`, `status_change`, `visibility_toggle`)
  - If status changed to `resolved`, sends a resolution notification
  - Updates `updatedAt`

- **`softDelete(noteId: string, actor: RequestActor): Promise<void>`**
  - Sets `deletedAt = now()`
  - Records audit version (`action: 'soft_deleted'`)
  - Note is no longer visible to non‑admins

- **`hardDelete(noteId: string, actor: RequestActor): Promise<void>`**
  - Requires `failure_notes_admin` role
  - Deletes the `remediationNotes` row (cascade deletes junction rows and versions)
  - The versions table data is retained for 90 days via a separate retention sweep (see R6)

- **`restore(noteId: string, actor: RequestActor): Promise<RemediationNote>`**
  - Sets `deletedAt = null`
  - Requires admin or note author

- **`search(query: SearchInput, actor: RequestActor): Promise<SearchResult>`**
  - Executes PostgreSQL full‑text search via `to_tsquery` / `plainto_tsquery` against the GIN index
  - Filters: `status`, `authorId`, `dateFrom`, `dateTo`, `failureType`
  - Excludes soft‑deleted notes
  - Excludes private notes whose `authorId !== actor.userId` (unless actor is admin)
  - Returns paginated results with linked failure summaries
  - Supports ordering by `createdAt DESC` (default) or `relevance` (via `ts_rank`)

- **`link(noteId: string, failureType: FailureType, failureId: string, actor: RequestActor): Promise<void>`**
  - Validates that the failure exists (SELECT against the target table)
  - Inserts a junction row; deduplicates via `ON CONFLICT DO NOTHING`
  - Records audit version (`action: 'linked'`)

- **`unlink(noteId: string, failureType: FailureType, failureId: string, actor: RequestActor): Promise<void>`**
  - Deletes the junction row
  - Records audit version (`action: 'unlinked'`)

### R5 — API endpoints

All endpoints are prefixed with `/api/remediation-notes`. The API follows the existing Hono‑based pattern used by the rest of the api (Cloudflare Workers, `api/src/api/` routes).

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/` | Create a note (body: `{ title, body, status?, visibility?, failureLinks: [{ failureType, failureId }] }`) | `tenant‑member` |
| `GET` | `/:noteId` | Get a single note with its linked failures | `tenant‑member` |
| `PATCH` | `/:noteId` | Update title, body, status, or visibility | Author or tenant‑editor |
| `DELETE` | `/:noteId` | Soft‑delete a note | Author or admin |
| `DELETE` | `/:noteId/permanent` | Hard‑delete a note | `failure_notes_admin` |
| `POST` | `/:noteId/restore` | Restore a soft‑deleted note | Admin or author |
| `GET` | `/search` | Full‑text search (qs: `q`, `status`, `authorId`, `dateFrom`, `dateTo`, `failureType`, `page`, `pageSize`) | `tenant‑member` |
| `GET` | `/by-failure/:failureType/:failureId` | List notes for a specific failure | `tenant‑member` or `project‑member` |
| `POST` | `/:noteId/link` | Link a note to a failure (body: `{ failureType, failureId }`) | `tenant‑editor` |
| `DELETE` | `/:noteId/link/:failureType/:failureId` | Unlink a note from a failure | `tenant‑editor` |
| `GET` | `/:noteId/versions` | Get the audit/version history for a note | `tenant‑member` |

Response shapes:
- Single note: `{ note: { id, title, body, status, visibility, author: { id, name }, linkedFailures: [{ failureType, failureId, summary }], createdAt, updatedAt, deletedAt } }`
- Search results: `{ notes: [...], total, page, pageSize }`

Error responses follow the existing `ApiError` pattern (`api/src/domain/shared/errors.ts`):
- `400` — invalid input (title too long, unrecognised failure type, etc.)
- `403` — insufficient permissions
- `404` — note not found
- `409` — duplicate link

### R6 — Audit trail & retention

The audit trail uses the `remediationNoteVersions` table (R2). Every mutation (create, edit, status change, visibility toggle, link, unlink, soft‑delete, restore, hard‑delete) writes one row with:

- `actorId` — who performed the action
- `action` — machine‑readable action type
- `diff` — structured before/after (JSONB)

The history panel endpoint (`GET /:noteId/versions`) returns all versions ordered by `createdAt DESC`.

**Retention policy:**
- Version rows for hard‑deleted notes are retained for 90 days, then purged by a cron sweep (`api/src/application/remediation/runVersionRetentionSweep.ts`).
- Soft‑deleted notes (rows with `deletedAt IS NOT NULL`) are retained indefinitely until hard‑deleted; a sweep may archive notes soft‑deleted > 365 days ago if desired, but that is a future policy decision.
- Active notes' version history is retained indefinitely.

Rationale: The 90‑day retention on hard‑deleted notes mirrors typical SOC 2 audit‑trail requirements — the record survives deletion long enough for an audit window but not permanently.

### R7 — Access control

Permissions follow the existing pattern in `api/src/domain/permissions/permissionRegistry.ts`. Three new permissions:

```
REMEDIATION_NOTE_READ:    'remediation_note:read'
REMEDIATION_NOTE_WRITE:   'remediation_note:write'
REMEDIATION_NOTE_ADMIN:   'remediation_note:admin'
```

Default role grants (following the existing `DEFAULT_ROLE_PERMISSIONS` matrix):

| Role | `remediation_note:read` | `remediation_note:write` | `remediation_note:admin` |
|---|---|---|---|
| Owner | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | |
| Member | ✓ | ✓ (own notes only) | |
| Viewer | ✓ (public only) | | |

**Own‑note write rule:** A Member can edit only their own notes. A Manager can edit any public note in their tenant. Only Owner can edit private notes they do not own.

**Project‑scoped failures:** For failure types that are project‑scoped (`deployment_event`, `pr_reconciliation_error`, `qa_finding`, `error_event`, `monitor_event`), the actor must have project membership (any role) in addition to the note permission. The service resolves this by querying the failure's owning project via the target table's `projectId` column.

**Visibility gating:**
- `public` notes are visible to anyone with `remediation_note:read`.
- `private` notes are visible only to the author and to users with `remediation_note:admin`.
- Soft‑deleted notes (`deletedAt IS NOT NULL`) are visible only to `remediation_note:admin` users.

### R8 — Notifications

Notifications follow the existing incident notification pattern (`api/src/application/incident/incidentNotifier.ts`).

**Trigger events:**
1. **Note created** → Notify the failure's assignee (if any) and any explicit watchers on the failure. Message: `"{author} added a remediation note '{title}' to {failureType} {failureSummary}."`
2. **Status changed to `resolved`** → Notify the failure's assignee and the note author. Message: `"Remediation note '{title}' was marked resolved."`
3. **Status changed to `in_progress`** → Notify the failure's assignee. Message: `"Remediation note '{title}' is now in progress."`

**Delivery channels:**
- In‑app notification (existing `notifications` table, surfaced in the notification bell)
- Email (if the user has email notifications enabled per `emailPreferences`)

**Deduplication:** Notifications within a 5‑minute window for the same note + event type are coalesced (the notifier checks for a recent duplicate before sending).

### R9 — Cross‑linking UX requirements

**Link existing note to a failure:**
- From any failure detail view, a user opens a "Link Remediation Note" dialog.
- The dialog provides a search field that queries the `/api/remediation-notes/search` endpoint (full‑text).
- Results show title, author, status badge, and a snippet of the body (first ~120 chars).
- Clicking a result fires `POST /:noteId/link`, and the note immediately appears in the failure's notes list.

**View linked failures from a note:**
- The note detail view includes a "Linked Failures" section listing each linked failure with its type icon, summary line, and link to the failure's detail page.
- Summary line per failure type:
  - `prod_incident`: incident title + severity badge
  - `security_incident`: title + severity
  - `deployment_event`: "Deployment to {environment} failed at {timestamp}" (derived from `deploymentEvents` columns)
  - `pr_reconciliation_error`: PR number + repo
  - `qa_finding`: finding title + severity
  - `vulnerability_finding`: CVE or finding title
  - `error_event`: error message (first ~100 chars)
  - `monitor_event`: monitor name + "check failed at {timestamp}"

### R10 — Edge cases & constraints

1. **Note body validation:** The service MUST reject bodies exceeding 20 000 characters at the application layer (before the DB write). Title is capped at 200 chars by the DB column.
2. **Empty body:** Rejected — a note must have at least 1 character of body content.
3. **Orphaned notes:** A note with zero linked failures is allowed (a user may create a note first, then link it later). The search and list endpoints must handle this case gracefully.
4. **Deleted failure target:** If a failure row is deleted (e.g., an incident is resolved and archived), the junction row in `remediationNoteFailures` is not cascade‑deleted — the note remains, and the linked failure shows as "Deleted" in the UI. This preserves institutional knowledge.
5. **Concurrent edits:** No optimistic‑locking or version‑vector mechanism is required (out of scope per the PRD). Last‑write‑wins semantics apply.
6. **Rate limiting:** The create and search endpoints are subject to the existing tenant‑level rate limiter. No special rate limit is needed.
7. **Markdown rendering:** The API stores and returns raw Markdown. Rendering (sanitisation, linkification, syntax highlighting) is a frontend concern and follows the existing Markdown rendering pipeline used elsewhere in the platform.
8. **Tenant isolation:** All queries are scoped by `tenantId`. The `tenantId` on `remediationNotes` is set from the actor's session; it is never taken from the request body.

---

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
