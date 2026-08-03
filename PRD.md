> **PRD** — drafted by Ada (Sr. Product Mgr) · task #881
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Ownership Assignment for AC-6 Compliance

## Problem & Goal
Active items in the system currently have an assigned owner/DRI count of zero, violating internal compliance control AC-6 (Least Privilege and Accountability). No owner or DRI documentation exists for any active item, resulting in a critical accountability gap. The goal is to ensure every active item has exactly one assigned owner/DRI at all times, enabling traceability, audit readiness, and adherence to AC-6.

## Target users / ICP roles
- **Compliance Officers** – need to verify and attest that all active items meet ownership requirements.
- **Security Administrators** – require tooling to detect and remediate unassigned items.
- **System/Application Owners** – responsible for assigning and maintaining item ownership.
- **Auditors** – consume ownership assignment logs and reports during assessments.

## Scope
- Detection and reporting of active items lacking an assigned owner/DRI.
- Enforcement mechanisms to prevent the creation or activation of an item without an owner.
- Interfaces for manual assignment, bulk assignment, and audit trail review.
- Real-time notifications when the count of unassigned items is non-zero.
- Integration with the corporate identity provider (IdP) to validate owner/DRI identifiers.

## Functional requirements
1. **Unassigned Item Detection**
   - The system shall continuously identify all items with `status = active` and `assigned_owner IS NULL`.
   - The system shall maintain a real-time count of such items visible to authorized users.
2. **Assignment Dashboard**
   - Provide a dedicated view listing all unassigned items with metadata (item type, ID, creation date, last modified).
   - Allow filtering and sorting by item attributes.
3. **Manual & Bulk Assignment**
   - Authorized users (Security Admin, Compliance Officer) can assign an owner/DRI to a single item or multiple items in bulk.
   - The owner/DRI field must be a valid, active identity from the corporate IdP; invalid entries shall be rejected with an actionable error message.
4. **Create/Activation Guard**
   - Any API or UI operation that would result in a new active item or change an item’s status to `active` shall require a non-null owner/DRI field.
   - The operation shall fail with a clear error if the owner is not specified, blocking the item from entering an active state.
5. **Alerts & Notifications**
   - When the unassigned active item count transitions from zero to greater than zero, the system shall send an alert (in-app, email) to a configurable distribution list (Compliance Officers, Security Admins).
   - A daily summary notification shall be sent while unassigned items persist.
6. **Audit Logging**
   - Every assignment, reassignment, and bulk operation shall create an immutable log entry capturing: timestamp, actor, item ID, previous owner (if any), new owner, and change reason where provided.
   - Logs must be searchable and exportable for audit purposes.

## Acceptance criteria
- **AC1:** For any active item with no owner, the item appears on the unassigned items dashboard with correct details.
- **AC2:** When a compliance officer navigates to the dashboard, they see a non-zero count badge and can click through to the detailed list.
- **AC3:** Creating a new item without an owner via API or UI returns HTTP 422 / a user-facing error, and the item is not saved as active.
- **AC4:** Selecting multiple unassigned items and performing a bulk assignment with a valid owner clears all from the list and logs each assignment.
- **AC5:** At the moment the unassigned count goes from 0 to 1, an alert email is sent to the pre-configured distribution list.
- **AC6:** The audit trail for a specific item includes all owner changes with accurate before/after values and timestamps.

## Out of scope
- Automated rule‑based assignment (e.g., inherit from parent resource).
- Re‑assignment triggered by employee departure or role change (future workflow).
- Integration with external ITSM tools for ownership dispute management.
- Historical SLA reporting on unassigned item duration beyond the standard audit log retention period.

## Requirements

> _Authored by the Business Analyst — traceable to the BuilderForce domain model (tasks, projects, SOC controls, sprints, incidents) and the existing identity/audit infrastructure._

### Req-1 — Active Item Inventory & Owner Canon

**R1.1 — Active Item Definition.** An "active item" is any row in the tables below whose status column is NOT terminal (archived / done / resolved / closed / cancelled). The canonical active-owner column per entity is:

| Entity               | Table / Drizzle export             | Status column | Active statuses                                  | Owner column(s)                                                          |
| -------------------- | ---------------------------------- | ------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Task / Epic / Gap    | `tasks` (`schema/work.ts`)         | `status`      | NOT `done`, NOT `archived`                       | `assignedUserId` (→ `users.id`), `assignedAgentRef` (→ `agents.id`)     |
| Project              | `projects` (`schema/work.ts`)      | `status`      | `'active'` only                                  | **NEW COLUMN** `ownerUserId` (→ `users.id`)                              |
| SOC 1/2 Control      | `socControls` (`finopsTables.ts`)  | `status`      | NOT `'gap'` (i.e. `'implemented'`, `'partial'`)  | `owner` (varchar, nullable — existing)                                   |
| Sprint               | `sprints` (`schema/work.ts`)       | `status`      | `'active'`, `'planned'`                          | **NEW COLUMN** `ownerUserId` (→ `users.id`)                              |
| Incident             | `prodIncidents` (`schema/delivery.ts`) | `status`  | NOT `'resolved'`                                 | **NEW COLUMN** `ownerUserId` (→ `users.id`)                              |
| Security Finding     | `tasks` with `securitySeverity`    | `status`      | NOT `done`, NOT `archived`                       | `assignedUserId` / `assignedAgentRef` (same as Task)                     |
| Product Release      | `productReleases` (`delivery.ts`)  | `status`      | `'planned'`, `'in_progress'`                     | **NEW COLUMN** `ownerUserId` (→ `users.id`)                              |
| Workflow Definition  | `workflowDefinitions` (`runtime.ts`)| `status`     | `'active'`, `'paused'`                           | **NEW COLUMN** `ownerUserId` (→ `users.id`)                              |

**R1.2 — Real-Time Unassigned Count.** A single, tenant-scoped materialised or efficiently-computed count of rows where the entity is active AND every applicable owner column is NULL. The count is exposed on the Compliance lens as a badge, and is re-evaluated on every write that changes status or owner on any inventoried table.

**R1.3 — Periodic Reconciliation.** A daily scheduled job recomputes the count from the source tables and logs discrepancies against the real-time count for audit purposes. A discrepancy > 0 for >1 hour triggers a P2 incident.

---

### Req-2 — Ownership Assignment API

**R2.1 — Unassigned Items Query.** `GET /api/compliance/unassigned-items`

- **Query params:** `entityType` (task | project | soc_control | sprint | incident | security_finding | release | workflow_definition), `status`, `sort` (createdAt, updatedAt, entityType), `order` (asc, desc), `page`, `pageSize` (default 50, max 200).
- **Response:** Paginated list. Each row: `{ entityType, entityId, entityKey, title, status, createdAt, updatedAt, currentOwner: null | { id, displayName, kind: 'human' | 'agent' } }`.
- **AuthZ:** Requires role `compliance_officer`, `security_admin`, or `tenant_admin`.
- **AC:** Maps to AC1, AC2.

**R2.2 — Single Assignment.** `PATCH /api/compliance/assign`

- **Body:** `{ entityType, entityId, ownerUserId?, ownerAgentRef?, reason? }`. Exactly one of `ownerUserId` or `ownerAgentRef` must be set — never both. `ownerAgentRef` is only valid for Task/Security-Finding entities (which already support agent assignment).
- **Validation (server-side):**
  1. `ownerUserId` must reference an existing, non-deleted `users.id` (read from the `users` table in `schema/identity.ts`). Return `422 { error: "OWNER_NOT_FOUND", detail: "User … does not exist." }`.
  2. `ownerAgentRef` must reference a non-deleted row in `ide_agents` (the `agents` table in `schema/runtime.ts`). Return `422 { error: "AGENT_NOT_FOUND", detail: "Agent … does not exist." }`.
  3. The entity must exist and be active. Return `404` or `422 { error: "ENTITY_NOT_ACTIVE" }` as appropriate.
- **Effect:** Sets the owner column(s) on the target row, writes an immutable audit entry (see Req-6), and recalculates the unassigned count.
- **Response:** `200 { entityType, entityId, previousOwner, newOwner }`.
- **AC:** Maps to AC3 (reject invalid), AC4 (part of bulk path).

**R2.3 — Bulk Assignment.** `POST /api/compliance/assign/bulk`

- **Body:** `{ assignments: [{ entityType, entityId }], ownerUserId?, ownerAgentRef?, reason? }`.
- **Guard:** Max 500 items per bulk call. Return `400` if exceeded.
- **Effect:** Each assignment is processed atomically within a single DB transaction. If ANY validation fails (bad user, inactive entity), the entire batch rolls back with a 422 listing every failure: `{ errors: [{ entityType, entityId, error, detail }] }`. No partial success — either all succeed or none.
- **AC:** Maps to AC4.

**R2.4 — IdP Validation.** When an `ownerUserId` is supplied, the API calls the tenant's configured identity provider (existing `auth` infrastructure) to confirm the user is active/not-disabled before accepting the assignment. If the IdP is unreachable, the assignment proceeds with a warning logged; the user record's local state is the fallback authority.

---

### Req-3 — Create/Activation Guard

**R3.1 — Task Creation Guard.** `POST /api/tasks` and `PATCH /api/tasks/:id` (status change). When the resulting `status` would be non-`done` and non-`archived` (i.e., active), the request MUST include at least one of `assignedUserId` or `assignedAgentRef`. If neither is present and the status is active: return `422 { error: "OWNER_REQUIRED", detail: "Active tasks require an assigned owner (assignedUserId or assignedAgentRef)." }`. This guard lives in the Task domain entity's factory (`Task.create`) and in the `Task.update` method — both already track `assignedUserId`/`assignedAgentRef`.

**R3.2 — Project Activation Guard.** `POST /api/projects` and `PATCH /api/projects/:id` where `status` = `'active'`. Requires `ownerUserId` to be non-null. Return `422 { error: "OWNER_REQUIRED", detail: "Active projects require an ownerUserId." }` if omitted.

**R3.3 — Sprint Activation Guard.** `POST /api/sprints` and `PATCH /api/sprints/:id` where `status` ∈ `{'active', 'planned'}`. Requires `ownerUserId`. Same 422 shape.

**R3.4 — Release Activation Guard.** `POST /api/releases` and `PATCH /api/releases/:id` where `status` ∈ `{'planned', 'in_progress'}`. Requires `ownerUserId`. Same 422 shape.

**R3.5 — Workflow Activation Guard.** `POST /api/workflows` and `PATCH /api/workflows/:id` where `status` ∈ `{'active', 'paused'}`. Requires `ownerUserId`. Same 422 shape.

**R3.6 — SOC Control Activation Guard.** When a `socControls` row transitions from `status = 'gap'` to `'partial'` or `'implemented'`, `owner` must be non-null. Return `422 { error: "OWNER_REQUIRED", detail: "Non-gap SOC controls require an owner." }` if null.

**R3.7 — Guard Consistency.** All activation guards share the same error contract: `{ error: "OWNER_REQUIRED", detail: "<entity-specific message>" }`, HTTP 422, so the frontend needs a single error-handling path. The guard is applied in the domain layer (entity `.create()` / `.update()`) so it cannot be bypassed by skipping the HTTP layer.

---

### Req-4 — Assignment Dashboard

**R4.1 — Page Route.** `GET /compliance/ownership` serves the dashboard as a tenant-scoped, role-gated page. Access requires `compliance_officer` or `security_admin` role.

**R4.2 — Summary Banner.** Top of page: large count badge (total unassigned active items), colour-coded: green (0), amber (1–9), red (≥10). Below it, a breakdown by entity type (e.g. "3 tasks, 1 project, 0 controls"). The count refreshes every 30s via polling `GET /api/compliance/unassigned-count`.

**R4.3 — Entity-Type Tabs.** Tab per entity type (Tasks, Projects, SOC Controls, Sprints, Incidents, Releases, Workflows), each showing its unassigned count as a pill. Default tab = highest count.

**R4.4 — Item List.** Each tab renders a sortable, filterable table:
- Columns: checkbox (for bulk select), Entity Key, Title, Status, Created, Last Modified.
- Row click navigates to the entity's detail page (e.g. `/projects/:id` for a project).
- Bulk-select checkbox in the header for select-all-on-page.

**R4.5 — Assignment Panel.** When one or more checkboxes are selected, a footer panel slides up with: an owner search input (typeahead against `users` with avatar + display name), an optional free-text reason field, and an "Assign Owner" button. On success, assigned items are removed from the list with a green toast. On failure, a red toast with the error detail.

**R4.6 — Audit Trail Access.** A "View Audit Log" link on any entity row navigates to `/compliance/ownership/audit?entityType=…&entityId=…`, which renders the ownership change history for that item (see Req-6).

---

### Req-5 — Alerts & Notifications

**R5.1 — Zero-to-One Alert.** A database trigger or application hook fires when the tenant's unassigned active-item count transitions from 0 to >0. It:
1. Inserts an in-app notification (into the existing `notifications` table / notification service) visible to users with the `compliance_officer` or `security_admin` role.
2. Sends an email to the configurable distribution list (stored in a new `complianceAlertConfigs` table with columns: `tenantId` (PK), `alertEmailList` (text — comma-separated), `dailyDigestEnabled` (boolean), `updatedAt`, `updatedBy`).

**R5.2 — Daily Digest.** While the unassigned count >0, a scheduled job (cron, 08:00 tenant-local timezone) sends an email digest with: current count, count by entity type, top-5 longest-unassigned items. It also posts an in-app digest card on the Compliance lens. The digest is suppressed if `dailyDigestEnabled = false` in `complianceAlertConfigs`.

**R5.3 — Configurable Distribution List.** `PUT /api/compliance/alert-config` accepts `{ alertEmailList, dailyDigestEnabled }`. Requires `tenant_admin` role. Changes are audit-logged. Default: `alertEmailList` = empty (no email until configured), `dailyDigestEnabled` = true.

---

### Req-6 — Audit Logging

**R6.1 — Ownership Change Log Table.** A new `ownershipChangeLog` table in `schema/governance.ts` (or a dedicated `schema/compliance.ts`):

```sql
ownership_change_log (
  id            serial PRIMARY KEY,
  tenantId      integer NOT NULL REFERENCES tenants(id),
  entityType    varchar(32) NOT NULL,   -- 'task' | 'project' | ...
  entityId      varchar(36) NOT NULL,   -- stringified PK (mixed types across entities)
  previousOwner varchar(255),           -- user displayName or agent ref; NULL if first assignment
  newOwner      varchar(255) NOT NULL,  -- user displayName or agent ref
  previousOwnerId varchar(36),          -- users.id or agents.id; NULL if first
  newOwnerId      varchar(36) NOT NULL, -- users.id or agents.id
  ownerKind       varchar(8) NOT NULL,  -- 'human' | 'agent'
  reason          text,
  actorId         varchar(36),          -- users.id / agent ref of who performed the assignment
  actorKind       varchar(8),           -- 'human' | 'agent' | 'system'
  bulkOperationId varchar(36),          -- shared UUID linking rows from one bulk call
  changeType      varchar(16) NOT NULL, -- 'assigned' | 'reassigned' | 'unassigned' | 'bulk_assigned'
  createdAt       timestamp NOT NULL DEFAULT now()
);
```

**R6.2 — Immutability.** No UPDATE or DELETE on `ownershipChangeLog` rows. The application layer grants only INSERT and SELECT to the service account. Soft-deletion is not supported — the log is append-only per compliance requirements.

**R6.3 — Audit Trail Query.** `GET /api/compliance/ownership/audit?entityType=…&entityId=…` returns every log entry for that entity, newest-first, paginated. Each row: `{ id, changeType, previousOwner, newOwner, ownerKind, reason, actorId, actorKind, createdAt }`. Requires `compliance_officer`, `security_admin`, or `auditor` role.

**R6.4 — Audit Trail Export.** `GET /api/compliance/ownership/audit/export?entityType=…&entityId=…&format=csv|json` returns the full (un-paginated) audit trail for that entity in the requested format, with a `Content-Disposition: attachment` header. Default format is CSV (RFC 4180, same pattern as `evidencePackToCsv` in `complianceInsights.ts`). Requires the same roles as R6.3.

**R6.5 — Cross-Entity Audit Search.** `GET /api/compliance/ownership/audit/search?q=…&entityType=…&actorId=…&from=…&to=…&page=…&pageSize=…` for global audit queries across entities. Supports full-text search on `newOwner`, `reason`, and `actorId`. Requires `compliance_officer` or `auditor` role.

---

### Req-7 — Role-Based Access Control (RBAC)

**R7.1 — New System Roles.** Two new roles added to the existing role/permission system:

| Role                 | Scope    | Permissions                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------------- |
| `compliance_officer` | tenant   | Read unassigned count/dashboard, read audit trail, export audit trail       |
| `security_admin`     | tenant   | All of compliance_officer + assign/reassign owners, configure alert list    |
| `auditor`            | tenant   | Read-only: audit trail + export only (no dashboard, no counts)              |

**R7.2 — Role Assignment.** Roles are assignable via the existing role/permission infrastructure (`tenantRoleEnum` in `schema/common.ts` currently defines `owner`, `admin`, `member`, `viewer` — extend it). Role checks use the existing authorization middleware.

**R7.3 — Tenant Owner Default.** The tenant `owner` role inherits all `security_admin` permissions implicitly — no explicit role assignment needed.

---

### Req-8 — Migration & Backfill

**R8.1 — Schema Migration.** A single, numbered migration file in `api/migrations/` that:
1. Adds `ownerUserId` columns to `projects`, `sprints`, `prodIncidents`, `productReleases`, `workflowDefinitions` (nullable, FK to `users.id` with `ON DELETE SET NULL`).
2. Creates the `ownershipChangeLog` table.
3. Creates the `complianceAlertConfigs` table.
4. Extends the role enum to include `compliance_officer`, `security_admin`, `auditor`.

**R8.2 — Backfill.** A one-time script (run manually post-migration) that:
1. Sets `projects.ownerUserId` = the project creator where determinable (from `project_insight_events` or `createdAt` + audit trail cross-reference), or leaves NULL if unverifiable.
2. Leaves all other new owner columns NULL — they will surface on the unassigned dashboard and be assigned via the UI.
3. Populates `complianceAlertConfigs` with a default row for every existing tenant (empty alertEmailList, dailyDigestEnabled = true).

---

### Req-9 — Non-Functional Requirements

**R9.1 — Performance.** The unassigned count query (`GET /api/compliance/unassigned-count`) must return in <500ms p99 for a tenant with up to 100,000 active items. The dashboard list query (`GET /api/compliance/unassigned-items`) must return in <2s p99 under the same conditions, with pagination.

**R9.2 — Concurrency.** Bulk assignment uses `SELECT ... FOR UPDATE` row locking to prevent lost updates when two security admins assign the same item concurrently. The second caller receives the updated owner and a `409 Conflict` with detail: "This item was assigned by another user while your request was in flight."

**R9.3 — Idempotency.** `POST /api/compliance/assign/bulk` accepts an optional `idempotencyKey` header. Replaying a bulk assignment with the same key returns `200` with the original result and does not double-log audit entries.

**R9.4 — Audit Retention.** `ownershipChangeLog` rows are retained indefinitely (no TTL) — they serve as the permanent compliance record. Row count is monitored; an alert fires if the table exceeds 10M rows per tenant (prompting archival consideration).

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._