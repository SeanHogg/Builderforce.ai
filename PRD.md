> **PRD** — drafted by Ada (Sr. Product Mgr) · task #583
> _Each agent that updates this PRD signs its change below._
>
> **Business Analyst** (2026-07-15) — authored Requirements section grounded in existing codebase.

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

### 1. Failure Entity Taxonomy

A "failure" in the BuilderForce platform is any entity that records a negative outcome requiring investigation or remediation. The following are the canonical failure surfaces the remediation-notes system **must** support as linkable targets:

| Failure type | Source table | Key identifier | Existing linkage |
|---|---|---|---|
| Production incident | `prod_incidents` (schema/delivery.ts) | `id` (uuid) | Bridged to a `tasks` row via `boardTaskId`; `incidentEvents` timeline |
| Security incident | `security_incidents` (schema/governance.ts) | `id` (uuid) | Bridged to a SECURITY board task via `boardTaskId` |
| Deployment failure | `deployment_events` (schema/delivery.ts) | `id` (uuid) | `isFailure` boolean; linked to PRs via `prNumber` |
| PR reconciliation error | `pr_reconciliation_errors` (schema/delivery.ts) | `id` (uuid) | Linked to `deploymentEvents` via `deploymentEventId` |
| Error group | `error_groups` (schema/delivery.ts) | `id` (uuid) | Fingerprint-grouped; linked to a fix `taskId` |
| QA finding | `qa_findings` (schema/quality.ts) | `id` (uuid) | Linked to `qa_runs` + `qa_explorations` |
| Security finding | `security_findings` (schema/governance.ts) | `id` (uuid) | Linked to `security_incidents` via `incidentId` |
| Monitor alert | `alerts` (schema/delivery.ts) | `id` (uuid) | Linked to `segments`; fired via `monitor_events` |

The system **must** use a polymorphic association pattern — a single `remediation_notes` table with a `target_type` / `target_id` pair — so one note can link to any failure type, and a new failure type added later does not need a schema migration.

### 2. Data Model

#### 2.1 `remediation_notes` table

Create via a new Drizzle schema module at `api/src/infrastructure/database/schema/remediation.ts` and re-export from `schema.ts`. Migration number: next available in `api/migrations/` (check the highest existing number and increment).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `tenantId` | `integer` | NOT NULL, FK → `tenants.id` ON DELETE CASCADE | Tenant isolation |
| `authorId` | `uuid` | NOT NULL, FK → `users.id` ON DELETE SET NULL | The note's creator |
| `title` | `varchar(200)` | NOT NULL | Max 200 chars per FR-1 |
| `body` | `text` | NOT NULL | Max 20k chars; Markdown |
| `status` | `varchar(16)` | NOT NULL, DEFAULT `'draft'` | One of: `draft`, `in-progress`, `resolved`, `archived` |
| `visibility` | `varchar(8)` | NOT NULL, DEFAULT `'public'` | `public` (team-visible) or `private` (author-only) |
| `deletedAt` | `timestamp` | nullable | Soft-delete tombstone; non-null = hidden from normal queries |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT `now()` | Bumped on every edit via application-layer trigger |

Indexes:
- `(tenantId, createdAt DESC)` — list all notes for a tenant, newest first
- `(tenantId, status)` — filtered queries by status
- `(tenantId, authorId)` — "my notes" queries
- `(tenantId, deletedAt)` WHERE `deletedAt IS NULL` — soft-delete-aware scans
- GIN index on `to_tsvector('english', title || ' ' || body)` for full‑text search (PostgreSQL `tsvector`)

#### 2.2 `remediation_note_links` table (cross‑linking / polymorphic junction)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `noteId` | `uuid` | NOT NULL, FK → `remediation_notes.id` ON DELETE CASCADE | |
| `targetType` | `varchar(32)` | NOT NULL | One of the canonical failure types: `prod_incident`, `security_incident`, `deployment_event`, `pr_reconciliation_error`, `error_group`, `qa_finding`, `security_finding`, `alert` |
| `targetId` | `uuid` | NOT NULL | The ID of the failure row |
| `linkedBy` | `uuid` | NOT NULL, FK → `users.id` ON DELETE SET NULL | Who created the link |
| `linkedAt` | `timestamp` | NOT NULL, DEFAULT `now()` | |

Unique constraint: `(noteId, targetType, targetId)` — a note cannot be linked to the same failure twice.

Indexes:
- `(targetType, targetId)` — "show all notes for this failure"
- `(noteId)` — "show all failures linked to this note"

#### 2.3 `remediation_note_events` table (audit log)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `tenantId` | `integer` | NOT NULL, FK → `tenants.id` ON DELETE CASCADE | |
| `noteId` | `uuid` | NOT NULL, FK → `remediation_notes.id` ON DELETE CASCADE | |
| `kind` | `varchar(24)` | NOT NULL | `created`, `edited`, `status_change`, `visibility_toggle`, `linked`, `unlinked`, `soft_deleted`, `restored`, `hard_deleted` |
| `actorId` | `uuid` | nullable, FK → `users.id` ON DELETE SET NULL | Who performed the action |
| `diff` | `jsonb` | nullable | Before/after snapshot for edits; `{ field, oldValue, newValue }` |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT `now()` | |

Index: `(noteId, createdAt DESC)` — the note's history panel.

Retention: hard-deleted note audit events are retained for 90 days (matching AC-4), enforced by a nightly sweep job that deletes rows where `noteId` references a hard‑deleted note and `createdAt < NOW() - INTERVAL '90 days'`.

### 3. API Surface

All routes live under `/api/remediation-notes` following the existing Hono route conventions (`api/src/api/`). The service class `RemediationNoteService` lives at `api/src/application/remediation/RemediationNoteService.ts`.

#### 3.1 Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/remediation-notes` | `requirePermission('failure_note:write')` | Create a note; body: `{ title, body, status?, visibility?, links?: [{targetType, targetId}] }`. Returns the created note with its links. |
| `GET` | `/api/remediation-notes/:id` | `requirePermission('failure_note:read')` | Get a single note with its links, audit trail, and linked failure summaries. |
| `PATCH` | `/api/remediation-notes/:id` | `requirePermission('failure_note:write')` + author or admin | Update title/body/status/visibility. Every edit writes an audit event. Returns updated note. |
| `DELETE` | `/api/remediation-notes/:id` | `requirePermission('failure_note:write')` + author or admin | Soft-delete (set `deletedAt`). Admins pass `?hard=true` for permanent deletion. |
| `POST` | `/api/remediation-notes/:id/restore` | `requirePermission('failure_note:admin')` | Admin-only: un‑soft‑delete (set `deletedAt = null`). |
| `POST` | `/api/remediation-notes/:id/links` | `requirePermission('failure_note:write')` | Link the note to another failure; body: `{ targetType, targetId }`. |
| `DELETE` | `/api/remediation-notes/:id/links/:linkId` | `requirePermission('failure_note:write')` | Remove a link. |
| `GET` | `/api/remediation-notes` | `requirePermission('failure_note:read')` | Search & list. Query params: `q` (full‑text), `status`, `authorId`, `targetType`, `targetId`, `visibility` (defaults to excluding private notes by other users), `from`, `to` (date range), `page`, `limit`. |
| `GET` | `/api/failures/:targetType/:targetId/notes` | `requirePermission('failure_note:read')` | Convenience: all notes for a specific failure. |
| `GET` | `/api/remediation-notes/:id/history` | `requirePermission('failure_note:read')` | Paginated audit events for one note. |

#### 3.2 Response shapes

- A note object always includes: `id`, `title`, `body` (truncated to 300 chars in list responses), `status`, `visibility`, `author` (`{ id, displayName, avatarUrl }`), `createdAt`, `updatedAt`, `deletedAt` (null for active notes), `linkCount`, and an `_links` map.
- List/search responses: `{ data: Note[], total: number, page: number, limit: number }`.
- Error responses use existing `ApiError` conventions (`{ error: string, code: string, status: number }`).

### 4. Permission Model

Integrate with the existing `permissionRegistry.ts` role matrix:

```typescript
// Add to PERMISSIONS constant:
FAILURE_NOTE_READ:   'failure_note:read',
FAILURE_NOTE_WRITE:  'failure_note:write',
FAILURE_NOTE_ADMIN:  'failure_note:admin',
```

Default role assignment:
| Permission | Viewer | Developer | Manager | Owner |
|---|---|---|---|---|
| `failure_note:read` | ✓ | ✓ | ✓ | ✓ |
| `failure_note:write` | — | ✓ | ✓ | ✓ |
| `failure_note:admin` | — | — | — | ✓ |

Rules:
- **Read**: Any user with `failure_note:read` can see public notes. Private notes are visible only to their author (and admins). Soft‑deleted notes are excluded from all views except admin queries with `?includeDeleted=true`.
- **Write**: Any user with `failure_note:write` can create notes and link them to any failure in a project they have access to. Editing is restricted to the note author or a `failure_note:admin`.
- **Admin**: Hard‑delete, restore, view deleted notes, view all private notes, and access the global audit trail. Mapped to the Owner role by default; can be granted to other roles via `role_permission_overrides`.

### 5. Integration Points

#### 5.1 Failure detail views (Frontend)
Each existing failure detail page (incident panel, deployment event detail, error group view, QA findings dashboard, security finding detail) **must** add an inline "Remediation Notes" section that:
- Lists linked notes with title, status badge, author, and relative timestamp.
- Shows an "Add Note" / "Link Existing" button (gated on `failure_note:write`).
- Allows inline editing of notes the current user authored.

#### 5.2 Notifications
Reuse the existing notification infrastructure (`incidentNotifier.ts` pattern: Slack webhook + Resend email + MS Teams MessageCard):
- When a note is created or its status changes to `resolved`: notify the failure's assignees (for incidents: the incident board task assignee; for deployment events: the deployment's author; for error groups: the fix task assignee).
- In‑app notification via the existing activity-feed mechanism.
- Notification content includes: note title (linked), failure reference, new status, actor name.

#### 5.3 Full‑text search
Use PostgreSQL native `tsvector`/`tsquery` (no external search engine). The GIN index on `remediation_notes` supports the `q` parameter. The query builder in `RemediationNoteService` constructs a `to_tsquery('english', :q)` clause. This is consistent with how the platform handles `brainKnowledgeSearch` and `projectEvermind` embeddings — no Elasticsearch/Meilisearch dependency.

#### 5.4 Audit retention sweep
Add a new cron job at `api/src/application/remediation/runRemediationAuditRetentionSweep.ts` (registered in the existing sweep runner) that runs daily and deletes `remediation_note_events` rows older than 90 days for hard‑deleted notes. This satisfies AC-4.

### 6. Cross‑cutting Constraints

1. **Tenant isolation**: Every query includes `tenantId` from the request context (extracted via existing `requireTenant` middleware). Cross‑tenant note access is impossible by construction — the FK cascade on `tenants.id` is a safety net, not the primary gate.

2. **No API‑key bypass of ownership**: Service accounts (API keys) authenticate as a user; the same permission checks apply. There is no "machine" role that skips ownership — consistent with the existing `ApiKeyService` pattern.

3. **Markdown rendering**: The frontend renders note bodies with the existing Markdown component (used in Brain chat messages and Knowledge articles). Auto‑linking of URLs and issue‑tracker references (e.g. `#123` → task link, `ORG/REPO#123` → GitHub issue) is a **frontend‑only** transformation — the stored body is plain Markdown.

4. **Rate limiting**: The existing `rateLimiter` middleware applies to all `/api/remediation-notes` routes with the default tier limits. No special carve‑out is needed because remediation notes are human‑authored (low volume).

5. **Migration safety**: The new `remediation_notes`, `remediation_note_links`, and `remediation_note_events` tables are additive — no existing tables are altered. Rollback is a simple `DROP TABLE … CASCADE`.

### 7. Non‑Functional Requirements

| Concern | Target |
|---|---|
| Note create/edit latency | < 500ms p95 (single‑row write + 1 audit event) |
| Search latency | < 1s p95 for up to 100k notes (GIN index on `tsvector`) |
| List notes for a failure | < 200ms p95 (indexed `targetType`/`targetId` lookup) |
| History panel load | < 300ms p95 (indexed `noteId`/`createdAt` scan, paginated) |
| Concurrent edits | Last‑write‑wins (no OT/CRDT; the audit trail records both versions) |
| Availability | Inherits from the API Worker (no new SPOF) |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
