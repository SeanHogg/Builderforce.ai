import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  customType,
  primaryKey,
  serial,
  varchar,
  smallint,
  bigint,
  bigserial,
  date,
  real,
  jsonb,
  unique,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Data model aligns with product flow (see README "Data model & API"):
 * Brain Storm (ideate) → Execute → Project → IDE (build) or Tasks + Workforce (assign to AgentHosts).
 * Unified chats: brain_chats (all modalities via `origin` + optional projectId). Tasks link projects to agentHosts/executions.
 */

// custom tsvector type for full-text search
const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});

// ---------------------------------------------------------------------------
// Enum columns (Builderforce orchestration)
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum('project_status', [
  'active', 'completed', 'archived', 'on_hold',
]);

// Task status is a free-form varchar (see migration 0076): a project's swimlanes
// define its board columns, so a task's status is whatever lane key it sits in.
// The canonical default statuses live in the app-layer `TaskStatus` enum.

export const taskPriorityEnum = pgEnum('task_priority', [
  'low', 'medium', 'high', 'urgent',
]);

export const agentTypeEnum = pgEnum('agent_type', [
  'claude', 'openai', 'ollama', 'http',
]);

// Task type is a fixed, automation-driven dimension (unlike the free-form
// per-board `status` lane key): a plain `task`, or an `epic` that decomposes
// into child tasks (parent_task_id) — see migration 0112.
export const taskTypeEnum = pgEnum('task_type', [
  'task', 'epic', 'gap', 'security',
  // Incident ticket (migration 0325): a first-class board card the Incident Manager
  // agent works, bridged to a prod_incidents record.
  'incident',
  // Hireable work-item kinds (migration 0293): a full product/scope brief a
  // Product-Manager agent authors + publishes for a fixed-bid build, and a UI/UX
  // design (or design-review) gig. Both are publishable to the Gig Marketplace.
  'product', 'design',
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active', 'suspended', 'archived',
]);

export const tenantRoleEnum = pgEnum('tenant_role', [
  'owner', 'manager', 'developer', 'viewer',
]);

// Segment tier (see README "Segment tier"): the isolation level between tenant
// and entity for tenants that are themselves multi-tenant.
export const segmentStatusEnum = pgEnum('segment_status', [
  'active', 'suspended', 'archived',
]);

// How a tenant authenticates users: 'direct' = BuilderForce is the IdP
// (local/OAuth/magic-link, the current model); 'embedded' = an external host is
// the OIDC IdP and identity arrives as claims.
export const tenantKindEnum = pgEnum('tenant_kind', [
  'embedded', 'direct',
]);

// Whether a tenant sub-divides into segments. 'single' tenants are pinned to one
// default segment; 'segmented' tenants get one segment per end-client.
export const tenantIsolationModeEnum = pgEnum('tenant_isolation_mode', [
  'single', 'segmented',
]);

export const sourceControlProviderEnum = pgEnum('source_control_provider', [
  'github', 'bitbucket',
]);

// ---------------------------------------------------------------------------
// Deadline tables (timeline & deadlines feature)
// ---------------------------------------------------------------------------

export const deadlineTypeEnum = pgEnum('deadline_type', [
  'business', 'customer',
]);

export const deadlineStatusEnum = pgEnum('deadline_status', [
  'on_track', 'at_risk', 'off_track', 'missed',
]);

export const deadlinePriorityEnum = pgEnum('deadline_priority', [
  'p1', 'p2', 'p3',
]);

/** Deadline records. */
export const deadlines = pgTable('deadlines', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tenantId: bigint('tenant_id', { mode: 'number' }).notNull(),
  projectId: bigint('project_id', { mode: 'number' }),
  title: varchar('title', { length: 800 }).notNull(),
  type: deadlineTypeEnum('type').notNull(),
  owner: varchar('owner', { length: 800 }).notNull(),
  dueDate: date('due_date', { mode: 'date' }).notNull(),
  priority: deadlinePriorityEnum('priority').notNull().default('p3'),
  tags: text('tags').array().notNull(),
  description: text('description'),
  dependents: text('dependents').array(),
  healthOverride: deadlineStatusEnum('health_override'),
  healthOverrideReason: text('health_override_reason'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Directed dependency edges: fromDeadlineId BLOCKS toDeadlineId (feeds critical path). */
export const deadlineDependencies = pgTable('deadline_dependencies', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  fromDeadlineId: bigint('from_deadline_id', { mode: 'number' }).notNull(),
  toDeadlineId: bigint('to_deadline_id', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Audit trail for date changes and health overrides. */
export const deadlineAudit = pgTable('deadline_audit', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  deadlineId: bigint('deadline_id', { mode: 'number' }).notNull(),
  tenantId: bigint('tenant_id', { mode: 'number' }).notNull(),
  runId: bigint('run_id', { mode: 'number' }),
  fieldChanged: text().notNull(),
  previousValue: text(),
  newValue: text(),
  slipReason: varchar('slip_reason', { length: 800 }),
  actor: varchar('actor', { length: 800 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Per-deadline daily rollup metrics (e.g., slip count). */
export const deadlineRollups = pgTable('deadline_rollups', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  deadlineId: bigint('deadline_id', { mode: 'number' }).notNull(),
  runId: bigint('run_id', { mode: 'number' }).notNull(),
  periodBegin: date('period_begin', { mode: 'date' }).notNull(),
  periodEnd: date('period_end', { mode: 'date' }).notNull(),
  slipCount: integer('slip_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});