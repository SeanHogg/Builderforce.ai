import {
  pgTable,
  integer,
  bigint,
  timestamp,
  pgEnum,
  varchar,
  date,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Deadline tables (timeline & deadlines feature)
// ---------------------------------------------------------------------------

export const deadlineTypeEnum = pgEnum('deadline_type', [
  'business',
  'customer',
]);

export const deadlineStatusEnum = pgEnum('deadline_status', [
  'on_track',
  'at_risk',
  'off_track',
  'missed',
]);

export const deadlinePriorityEnum = pgEnum('deadline_priority', [
  'p1',
  'p2',
  'p3',
]);

/** Deadline records. */
export const deadlines = pgTable('deadlines', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  tenantId: bigint('tenant_id', { mode: 'number' }).notNull(),
  // projectId is optional; deadline could be tenant-level or portfolio-level
  projectId: bigint('project_id', { mode: 'number' }),
  title: varchar('title', { length: 800 }).notNull(),
  type: deadlineTypeEnum('type').notNull(),
  owner: varchar('owner', { length: 800 }).notNull(),
  dueDate: date('due_date', { mode: 'date' }).notNull(),
  priority: deadlinePriorityEnum('priority').notNull().default('p3'),
  tags: varchar('tags', { length: 4000 })
    .array()
    .notNull(),
  description: varchar('description', { length: 8000 }),
  /**
   * IDs of dependents (deadlines that rely on this one).
   * Stored as a string[] for SQL array storage.
   */
  dependents: varchar('dependents', { length: 4000 })
    .array(),
  // Manual health override by admin; if present, status comes from this instead of auto-calc
  healthOverride: deadlineStatusEnum('health_override'),
  healthOverrideReason: varchar('health_override_reason', { length: 8000 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Directed dependency edges: fromDeadlineId BLOCKS toDeadlineId (feeds the critical path).
 * This table is the source-of-truth for graph structure.
 */
export const deadlineDependencies = pgTable('deadline_dependencies', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  fromDeadlineId: bigint('from_deadline_id', { mode: 'number' }).notNull(),
  toDeadlineId: bigint('to_deadline_id', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Audit trail for changes to deadlines (date moves, health overrides, tags, etc.).
 * Tracks who did what and when, including slip reasons for date changes.
 */
export const deadlineAudit = pgTable('deadline_audit', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  deadlineId: bigint('deadline_id', { mode: 'number' }).notNull(),
  tenantId: bigint('tenant_id', { mode: 'number' }).notNull(),
  // System-run identifier; optional
  runId: bigint('run_id', { mode: 'number' }),
  /**
   * Field changed (e.g., 'dueDate', 'healthOverride', 'title', 'owner').
   * This is the source-string key used by APIs and the service layer.
   */
  fieldChanged: varchar('field_changed', { length: 80 }).notNull(),
  previousValue: varchar('previous_value', { length: 8000 }),
  newValue: varchar('new_value', { length: 8000 }),
  slipReason: varchar('slip_reason', { length: 800 }),
  actor: varchar('actor', { length: 800 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Per-deadline daily rollup metrics.
 * Stores telemetry for slip rate calculations and archive reads.
 */
export const deadlineRollups = pgTable('deadline_rollups', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  deadlineId: bigint('deadline_id', { mode: 'number' }).notNull(),
  runId: bigint('run_id', { mode: 'number' }).notNull(),
  periodBegin: date('period_begin', { mode: 'date' }).notNull(),
  periodEnd: date('period_end', { mode: 'date' }).notNull(),
  slipCount: integer('slip_count', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});