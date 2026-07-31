/**
 * Schema — deadlines context (task #278 — timeline & deadlines visibility).
 *
 * Extracted from the monolithic `schema.ts` barrel mis-merge where a prior pass
 * clobbered 1000+ lines of the real platform schema. This context follows the
 * pattern in pmo.ts / work.ts: tenant+segment scoped, uuid PKs for new domain
 * tables, lazy FKs, no eager cross-module value dereference.
 *
 * Migration: 0283_create_deadline_tables (in api/api/migrations/ — historical
 * location awaiting migration-folder consolidation; see PR).
 */

import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { segments, tenants, users } from './identity';
import { projects } from './work';

// ── Enums (match migration 0283; registration via CREATE TYPE IF NOT EXISTS
//    in migration ensures idempotent apply) ──

export const deadlineTypeEnum = pgEnum('deadline_type', ['business', 'customer']);

export const deadlineStatusEnum = pgEnum('deadline_status', [
  'on_track',
  'at_risk',
  'off_track',
  'missed',
]);

export const deadlinePriorityEnum = pgEnum('deadline_priority', ['p1', 'p2', 'p3']);

// ── Tables ──

/** Deadline record — a tracked commitment (internal or customer-facing). */
export const deadlines = pgTable(
  'deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 800 }).notNull(),
    type: deadlineTypeEnum('type').notNull(),
    ownerUserId: varchar('owner_user_id', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Freeform owner display name (fallback when no user FK); retained from
     *  migration for mixed external/manual ingestion. */
    owner: varchar('owner', { length: 800 }),
    dueDate: date('due_date', { mode: 'date' }).notNull(),
    forecastDate: date('forecast_date', { mode: 'date' }),
    priority: deadlinePriorityEnum('priority').notNull().default('p3'),
    tags: text('tags').array().notNull().default([]),
    description: text('description'),
    /** Legacy: dependents stored as an id list; superseded by deadline_dependencies half-edge.
     *  Kept for back-compat; not authoritative. */
    dependents: text('dependents').array(),
    healthOverride: deadlineStatusEnum('health_override'),
    healthOverrideReason: text('health_override_reason'),
    completed: boolean('completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    slipCount: integer('slip_count').notNull().default(0),
    lastSlipReason: varchar('last_slip_reason', { length: 800 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('idx_deadlines_tenant_id').on(t.tenantId),
    byProject: index('idx_deadlines_project_id').on(t.projectId),
    byType: index('idx_deadlines_type2').on(t.type),
    byDueDate: index('idx_deadlines_due_date2').on(t.dueDate),
    byOwnerUser: index('idx_deadlines_owner_user').on(t.ownerUserId),
  }),
);

/** Directed dependency edge: fromDeadlineId BLOCKS toDeadlineId. */
export const deadlineDependencies = pgTable(
  'deadline_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fromDeadlineId: uuid('from_deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    toDeadlineId: uuid('to_deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byFrom: index('idx_deadline_dependencies_from2').on(t.fromDeadlineId),
    byTo: index('idx_deadline_dependencies_to2').on(t.toDeadlineId),
    uniqueEdge: index('uq_deadline_dependencies_edge').on(t.fromDeadlineId, t.toDeadlineId),
  }),
);

/** Audit trail for any change to a deadline (date slip, health override, etc.). */
export const deadlineAudit = pgTable(
  'deadline_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 128 }),
    fieldChanged: varchar('field_changed', { length: 80 }).notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    slipReason: varchar('slip_reason', { length: 800 }),
    actor: varchar('actor', { length: 800 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDeadline: index('idx_deadline_audit_deadline_id2').on(t.deadlineId),
    byTenant: index('idx_deadline_audit_tenant_id2').on(t.tenantId),
  }),
);

/** Per-deadline daily/period rollup metrics (e.g. slip count over a window). */
export const deadlineRollups = pgTable(
  'deadline_rollups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 128 }),
    periodBegin: date('period_begin', { mode: 'date' }).notNull(),
    periodEnd: date('period_end', { mode: 'date' }).notNull(),
    slipCount: integer('slip_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDeadline: index('idx_deadline_rollups_deadline_id2').on(t.deadlineId),
  }),
);
