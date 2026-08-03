> **PRD** — drafted by Ada (Sr. Product Mgr) · task #828
> _Each agent that updates this PRD signs its change below._
>
> _Business Analyst sign-off: grounded against `seanhogg/builderforce.ai` as of 2026-08-03 — schema barrel, TenantService, ProjectService, tenantRoutes, projectRoutes, activityLog, AuditService, assignOwner, TenantRole enum, and tenantMembers table. Reference code paths cited inline._

# PRD: Auto-resolve Owner Role (or Trigger Sync)

## Problem & Goal
**Problem**  
Manual assignment of the Owner role is error‑prone, inconsistent, and often delayed. When an entity (e.g., project, team, resource) is created or ownership changes, dependent systems (permissions, notifications, audit logs) do not reflect the new Owner until a separate sync is manually triggered. This leads to access gaps, orphaned resources, and compliance risks.

**Goal**  
Automatically resolve the correct Owner role for an entity at creation or ownership change, and immediately trigger a sync of that role to all downstream systems. Eliminate manual intervention, reduce risk, and ensure that the Owner role is always accurate and synchronised.

## Target Users / ICP Roles
- **Admins & IT Operations** – responsible for role management and system consistency.
- **Project / Team Leads** – who create or transfer ownership of projects, workspaces, or resources.
- **Compliance / Security Officers** – who rely on accurate, timely role data for audits.
- **Integration Developers** – who consume the synced role data in external applications.

## Scope
**In Scope**
- Automatic detection of Owner creation, change, or removal for all supported entity types.
- Resolution logic that identifies the correct Owner based on predefined rules (e.g., creator, designated lead, explicit assignment).
- Immediate sync trigger that propagates the resolved Owner role to all downstream systems (permissions, reporting, integrations).
- Clear audit trail of auto‑resolved Owner assignments and sync events.

**Out of Scope**
- Manual override of auto‑resolved Owner (will be handled in a separate feature).
- Complex role hierarchies (e.g., Co‑Owner, Deputy Owner) – only the primary Owner role is in scope.
- Conflict resolution when multiple rules match – first‑match wins (documented behaviour).
- Bulk sync retry or backfill for historical data – only net‑new or changed Owners trigger sync.

## Functional Requirements

### FR1: Owner Role Detection
- When a supported entity is created, the system **shall** automatically assign the Owner role to the creator of that entity.
- When an entity's designated lead field is updated, the system **shall** automatically reassign the Owner role to the new lead.
- When an explicit Owner assignment is made via API or UI, the system **shall** resolve the Owner immediately and ignore any other automatic rules for that entity until the next change.

### FR2: Resolution Rules Priority
- The system **shall** apply the following priority for resolving the Owner role:
  1. Explicit assignment (most recent API/UI change).
  2. Designated lead field.
  3. Entity creator (fallback).
- If none of the above can be resolved, the entity **shall** remain without an Owner and an alert **shall** be raised.

### FR3: Sync Trigger
- Immediately after the Owner role is resolved (FR1, FR2), the system **shall** trigger a sync event.
- The sync event **must** contain the entity ID, new Owner ID, change timestamp, and a unique event ID.
- The sync **shall** be delivered to all registered downstream systems (permission engine, notification service, analytics pipeline) within 5 seconds.

### FR4: Audit & Logging
- Every auto‑resolution and sync trigger **shall** be logged with the rule used, timestamp, and outcome.
- Logs **must** be accessible via the admin dashboard and exportable for compliance.

### FR5: Error Handling
- If the sync fails (e.g., downstream system unavailable), the system **shall** retry 3 times with exponential backoff, then log a permanent failure.
- The Owner role assignment **shall** be considered committed even if sync fails; the system **shall** not roll back the role.

## Acceptance Criteria
- **AC1** – Given a user creates a new project, when the project is saved, then the user is automatically assigned the Owner role and a sync event is emitted within 5 seconds.
- **AC2** – Given an existing project, when the designated lead field is updated to a new user, then the Owner role is reassigned to that user and a sync is triggered.
- **AC3** – Given an explicit Owner assignment via API, when the request is processed, then the Owner role is set to the specified user and no other rule is applied, with sync triggered.
- **AC4** – Given an entity where no creator, lead, or explicit assignment exists, when the system evaluates ownership, then an alert is raised and no Owner is set.
- **AC5** – Given a sync failure, when the initial attempt fails, then up to 3 retries occur, and the failure is logged; the Owner role remains assigned.

## Out of Scope
- Manual approval flows for Owner assignment.
- Real‑time conflict resolution when multiple users simultaneously claim ownership.
- Sync to third‑party services without a registered integration endpoint.
- Historical data correction – only new events are processed.
- UI for overriding auto‑resolved Owner (future feature).

## Requirements

### RQ1: Supported Entity Types

The Owner resolver must operate over a fixed set of entity types. Each entity type maps to a concrete database table / aggregate in the current schema:

| Entity type | Table / aggregate | Owner role stored in | Relevant service / route |
|---|---|---|---|
| `tenant` | `tenants` | `tenant_members` (row with `role = 'owner'`) | `TenantService` / `tenantRoutes` |
| `project` | `projects` | `project_members` (new — see RQ2) | `ProjectService` / `projectRoutes` |

**Design rationale**: A tenant's Owner is already modelled as a row in `tenantMembers` with `role = TenantRole.OWNER` (enum value `'owner'`, defined in `api/src/domain/shared/types.ts`). Projects currently have no ownership column or join table. Introducing `project_members` mirrors `tenantMembers` and keeps the ownership model consistent — an entity has a membership roster, and the Owner is whichever member holds the `owner` role.

### RQ2: Project Members Table

Introduce `project_members` in `api/src/infrastructure/database/schema/work.ts` (the work-context schema module hosting `projects`):

```sql
CREATE TABLE project_members (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer',  -- 'owner' | 'manager' | 'editor' | 'runner' | 'viewer'
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user    ON project_members(user_id);
```

Drizzle definition follows the existing `tenantMembers` pattern in `identity.ts`. The `project_members` table lives in `schema/work.ts` (alongside `projects`) so it stays inside the work bounded context.

### RQ3: Owner Resolution Service

Create `api/src/application/owner/OwnerResolutionService.ts` — a stateless application service that resolves which user should hold the Owner role for a given entity:

```
resolveOwner(entityType: 'tenant' | 'project', entityId: number, context: ResolutionContext): OwnerResolution
```

**ResolutionContext** (inbound payload):

```ts
interface ResolutionContext {
  /** Explicit assignment: caller directly set the owner via API/UI. */
  explicitOwnerUserId?: string | null;
  /** The entity's designated lead field, if any (e.g. project lead). */
  designatedLeadUserId?: string | null;
  /** The user who created the entity (fallback). */
  creatorUserId?: string | null;
}
```

**OwnerResolution** (outcome):

```ts
interface OwnerResolution {
  entityType: 'tenant' | 'project';
  entityId: number;
  ownerUserId: string | null;   // null = no owner could be resolved → alert
  rule: 'explicit' | 'designated_lead' | 'creator' | 'none';
  previousOwnerUserId?: string | null;
  committedAt: Date;
}
```

**Resolution logic** (per FR2 priority):

1. If `explicitOwnerUserId` is set → `rule = 'explicit'`, owner = that user.
2. Else if `designatedLeadUserId` is set → `rule = 'designated_lead'`, owner = that user.
3. Else if `creatorUserId` is set → `rule = 'creator'`, owner = that user.
4. Else → `rule = 'none'`, `ownerUserId = null` → raise alert (see RQ7).

### RQ4: Integration Points — Where Owner Resolution Is Called

The following mutation sites must call `OwnerResolutionService.resolveOwner()` and then `SyncDispatcher.dispatch()` (see RQ6):

| Trigger | Location (file + call site) | Entity | Context passed |
|---|---|---|---|
| Tenant created | `tenantRoutes.ts` → `POST /api/tenants/create` (line ~133, after `tenantService.createTenant`) | `tenant` | `creatorUserId = userId`, no explicit or lead |
| Tenant owner explicitly changed | New endpoint: `PUT /api/tenants/:id/owner` (or `PATCH /api/tenants/:id` with `ownerUserId` in body) | `tenant` | `explicitOwnerUserId = body.ownerUserId` |
| Project created | `projectRoutes.ts` → `POST /api/projects` (after `projectService.createProject`) | `project` | `creatorUserId = userId`, no explicit or lead |
| Project designated lead updated | `projectRoutes.ts` → `PATCH /api/projects/:id` when `designatedLeadUserId` is in body | `project` | `designatedLeadUserId = body.designatedLeadUserId` |
| Project owner explicitly changed | New endpoint or field: `PATCH /api/projects/:id` with `ownerUserId` in body | `project` | `explicitOwnerUserId = body.ownerUserId` |

**Tenant owner change end-to-end**: Currently `tenantRoutes.ts` `POST /create` directly calls `tenantService.createTenant({ name, ownerUserId })` which adds a `tenantMembers` row with `role = 'owner'`. After this feature, that mutation still happens but the new service layer also records the resolution + fires the sync event in the same request lifecycle.

### RQ5: Audit Trail

Use the existing `activityLog` mechanism (`api/src/application/activity/activityLog.ts` — `recordActivity(env, db, input)`). For every resolution, emit one activity row:

```ts
await recordActivity(env, db, {
  tenantId: entityType === 'tenant' ? entityId : projectTenantId,
  projectId: entityType === 'project' ? entityId : null,
  actor: SYSTEM_ACTOR,        // auto-resolution is a system action
  verb: 'owner.auto_resolved',
  targetType: entityType,
  targetId: String(entityId),
  summary: `Owner resolved to ${ownerUserId} via rule '${rule}'`,
  metadata: {
    entityType,
    entityId,
    ownerUserId,
    rule,
    previousOwnerUserId: resolution.previousOwnerUserId ?? null,
    synced: false,            // updated to true after dispatch
  },
});
```

For sync events, emit a second activity row:

```ts
await recordActivity(env, db, {
  tenantId,
  actor: SYSTEM_ACTOR,
  verb: 'owner.sync_dispatched',
  targetType: entityType,
  targetId: String(entityId),
  summary: `Owner sync dispatched for ${entityType}:${entityId}`,
  metadata: {
    syncEventId: event.id,
    ownerUserId,
    downstreamCount: registeredEndpoints.length,
  },
});
```

The existing `GET /api/activity` endpoint (backed by `activityLog.getActivityLog`) already surfaces these rows. Export is handled by the existing admin dashboard's CSV/JSON export path — no new route needed.

### RQ6: Sync Dispatcher

Create `api/src/application/owner/SyncDispatcher.ts` — pushes an owner-change event to all registered downstream endpoints:

**Registered downstream endpoints**: A new config table or a set of hardcoded internal listeners:

| Downstream system | Purpose | Delivery method |
|---|---|---|
| Permission engine | Recalculate effective permissions for the entity | Internal function call (same process) — `PermissionEngine.refreshEntityOwner(entityType, entityId, ownerUserId)` |
| Notification service | Notify the new Owner, notify team members of ownership change | Internal function call — `NotificationService.ownerChanged({...})` |
| Analytics pipeline | Record ownership change for audit/compliance dashboards | Insert into `audit_events` (existing table, `AuditEvent.create` + `IAuditRepository.save`) |
| Webhook registry | Call any tenant-registered webhooks subscribed to `owner.changed` | HTTP POST to registered webhook URLs (fire-and-forget) |

**Sync event payload** (the shape pushed to every downstream):

```ts
interface OwnerSyncEvent {
  eventId: string;            // UUID v4
  entityType: 'tenant' | 'project';
  entityId: number;
  ownerUserId: string | null; // null = owner cleared
  previousOwnerUserId: string | null;
  resolutionRule: 'explicit' | 'designated_lead' | 'creator' | 'none';
  committedAt: string;        // ISO-8601
  tenantId: number;
}
```

**Dispatch flow**:

1. Generate a UUID v4 `eventId`.
2. Fan out to all registered downstream targets concurrently via `Promise.allSettled`.
3. Each target that fails is retried individually up to 3 times with exponential backoff (1 s, 4 s, 16 s) using `c.executionCtx.waitUntil()` so the HTTP response does not block on retries.
4. After all targets resolve (success or permanent failure), write the final sync outcome as a separate activity-log row (`verb: 'owner.sync_completed'` or `'owner.sync_failed'` with per-target status in metadata).
5. The Owner role assignment is committed regardless of sync outcome (per FR5).

**Latency target**: The initial fan-out must complete within 5 seconds for the happy path. Retries extend beyond that window but do not block the response.

### RQ7: Alerts for Unresolvable Ownership

When `OwnerResolutionService.resolveOwner()` returns `rule = 'none'` (no creator, lead, or explicit assignment applies — AC4), the system must raise an alert:

```ts
await recordActivity(env, db, {
  tenantId,
  actor: SYSTEM_ACTOR,
  verb: 'owner.unresolved',
  targetType: entityType,
  targetId: String(entityId),
  summary: `No owner could be resolved for ${entityType}:${entityId} — no creator, lead, or explicit assignment`,
  metadata: { entityType, entityId },
});
```

Additionally, call the existing alert infrastructure if available, or emit a `warn`-level log via `reportCaughtError` (already imported site-wide from `api/src/application/observability/caughtErrorReporter.ts`). This ensures the gap is visible in the admin dashboard's activity feed and in the observability pipeline.

### RQ8: Migration

One migration script: `api/migrations/0334_project_members.sql` (next available number — the current directory holds up to 0333 at time of writing):

```sql
CREATE TABLE IF NOT EXISTS project_members (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user    ON project_members(user_id);
```

**No backfill**: Per the scope decision, historical projects are not backfilled with Owners. The owner column is null for pre-existing projects until the next ownership-triggering event.

### RQ9: File Manifest

New files this feature introduces:

```
api/src/application/owner/OwnerResolutionService.ts    # RQ3 — stateless resolver
api/src/application/owner/OwnerResolutionService.test.ts
api/src/application/owner/SyncDispatcher.ts             # RQ6 — fan-out dispatcher
api/src/application/owner/SyncDispatcher.test.ts
api/src/application/owner/types.ts                      # ResolutionContext, OwnerResolution, OwnerSyncEvent
api/src/domain/owner/IOwnerRepository.ts                # Persistence interface for project_members
api/src/infrastructure/database/repository/OwnerRepository.ts  # Drizzle impl
api/migrations/0334_project_members.sql                 # RQ8
```

Modified files:

```
api/src/infrastructure/database/schema/work.ts          # RQ2 — add project_members table
api/src/presentation/routes/tenantRoutes.ts             # RQ4 — wire resolution + sync into tenant create/update
api/src/presentation/routes/projectRoutes.ts            # RQ4 — wire resolution + sync into project create/update
api/src/application/project/ProjectService.ts           # RQ4 — accept ownerUserId / designatedLeadUserId in DTOs
api/src/application/tenant/TenantService.ts             # (light touch) — expose owner change path
```

### RQ10: API Contract Additions

**PATCH /api/projects/:id** — accepts new optional fields:

```json
{
  "ownerUserId": "uuid-string | null",
  "designatedLeadUserId": "uuid-string | null"
}
```

- `ownerUserId` — explicit assignment (rule 1). Setting it to `null` clears the explicit override, falling back to the designated lead or creator on the next resolution.
- `designatedLeadUserId` — the project's designated lead (rule 2). Changing this field triggers a re-resolution.

**PUT /api/tenants/:id/owner** — new endpoint (Owner/Manager only):

```json
{
  "ownerUserId": "uuid-string"
}
```

Transfers tenant ownership. The caller must hold the `TenantRole.OWNER` or `TenantRole.MANAGER` role. The new owner must already be a tenant member. On success, the old owner's `tenantMembers` role is demoted to `manager` and the new owner's is promoted to `owner`.

### RQ11: Concurrency & Idempotency

- Two simultaneous ownership changes on the same entity are serialised by the database row lock (`SELECT ... FOR UPDATE` on the `project_members` / `tenantMembers` row before writing).
- If the resolved owner is the same as the current owner, skip the sync dispatch (no-op — the resolution is logged but no downstream fan-out occurs).
- The sync event `eventId` UUID guarantees at-most-once delivery per resolution event.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
