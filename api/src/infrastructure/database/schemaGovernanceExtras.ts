/**
 * schemaGovernanceExtras — Drizzle table defs for governance escalations.
 *
 * Why a separate file: this branch carries the pre-split monolithic schema.ts.
 * Migration 0334 already creates the SQL tables; Drizzle needs typed defs to query
 * them. Defining them here (and importing them only from governance escalation
 * code) keeps the PR mergeable: when git resolves schema.ts → barrel
 * (main's layout), these 5 tables should be MOVED into
 * api/src/infrastructure/database/schema/governance.ts so they join the barrel.
 *
 * At that point, delete this file and repoint governance imports to
 * '../../infrastructure/database/schema' — zero logic change.
 *
 * Until then, this file is the canonical Drizzle definition on this branch.
 */

import { pgTable, uuid, varchar, integer, boolean, timestamp, text, jsonb, index, unique } from 'drizzle-orm/pg-core';

// --- Internal enum stand-ins as varchar columns (SQL enums created by migration) ---
// We model them as varchar() in Drizzle so they compile regardless of whether the
// pgEnum() is registered in schema.ts / schema/governance.ts.

export const governanceEscalationChains = pgTable('governance_escalation_chains', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull(),
  segmentId:    uuid('segment_id'),
  initiativeId: uuid('initiative_id'),
  teamScope:    varchar('team_scope', { length: 128 }).notNull().default('default'),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  isActive:     boolean('is_active').notNull().default(true),
  defaultSlaDays: integer('default_sla_days').notNull().default(3),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const governanceEscalationChainLevels = pgTable('governance_escalation_chain_levels', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull(),
  chainId:          uuid('chain_id').notNull(),
  sequenceIndex:    integer('sequence_index').notNull().default(0),
  effectiveLevel:   integer('effective_level').notNull().default(1),
  levelName:        varchar('level_name', { length: 128 }).notNull().default('level'),
  ownerKind:        varchar('owner_kind', { length: 32 }).notNull().default('user'),
  ownerId:          varchar('owner_id', { length: 128 }),
  ownerDisplayName: varchar('owner_display_name', { length: 255 }),
  slaDays:          integer('sla_days'),
  reminder24h:      boolean('reminder_24h').notNull().default(true),
  reminder4h:       boolean('reminder_4h').notNull().default(true),
  autoEscalate:     boolean('auto_escalate').notNull().default(true),
  isTerminal:       boolean('is_terminal').notNull().default(false),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chainSeqIdx: unique().on(t.chainId, t.sequenceIndex),
  chainIdx:    index('idx_gov_escalation_levels_chain').on(t.chainId, t.sequenceIndex),
}));

export const governanceEscalations = pgTable('governance_escalations', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull(),
  segmentId:        uuid('segment_id'),
  initiativeId:     uuid('initiative_id'),
  teamScope:        varchar('team_scope', { length: 128 }).notNull().default('default'),
  chainId:          uuid('chain_id'),
  entityKind:       varchar('entity_kind', { length: 32 }).notNull().default('board_task'),
  entityId:         uuid('entity_id'),
  boardTaskId:      integer('board_task_id'),
  status:           varchar('status', { length: 24 }).notNull().default('open'),
  title:            varchar('title', { length: 500 }).notNull().default('Untitled escalation'),
  description:      text('description'),
  priority:         varchar('priority', { length: 16 }).notNull().default('high'),
  currentSequence:  integer('current_sequence').notNull().default(0),
  currentLevelName: varchar('current_level_name', { length: 128 }),
  currentOwnerKind: varchar('current_owner_kind', { length: 32 }),
  currentOwnerId:   varchar('current_owner_id', { length: 128 }),
  currentOwnerName: varchar('current_owner_name', { length: 255 }),
  slaDeadline:      timestamp('sla_deadline', { withTimezone: true }),
  slaBreached:      boolean('sla_breached').notNull().default(false),
  slaBreachCount:   integer('sla_breach_count').notNull().default(0),
  triggeredAt:      timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  lastAdvancedAt:   timestamp('last_advanced_at', { withTimezone: true }),
  resolvedAt:       timestamp('resolved_at', { withTimezone: true }),
  closedAt:         timestamp('closed_at', { withTimezone: true }),
  createdByUserId:  varchar('created_by_user_id', { length: 36 }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const governanceEscalationLogs = pgTable('governance_escalation_logs', {
  id:               uuid('id').primaryKey().defaultRandom(),
  escalationId:     uuid('escalation_id').notNull(),
  tenantId:         integer('tenant_id').notNull(),
  logIndex:         integer('log_index').notNull(),
  action:           varchar('action', { length: 40 }).notNull(),
  sequenceIndex:    integer('sequence_index').notNull().default(0),
  effectiveLevel:   integer('effective_level'),
  levelName:        varchar('level_name', { length: 128 }).notNull().default(''),
  ownerKind:        varchar('owner_kind', { length: 32 }),
  ownerId:          varchar('owner_id', { length: 128 }),
  ownerDisplayName: varchar('owner_display_name', { length: 255 }),
  resolutionOutcome: varchar('resolution_outcome', { length: 64 }),
  slaBreached:      boolean('sla_breached').notNull().default(false),
  stepsTaken:       text('steps_taken'),
  recommendedOptions: jsonb('recommended_options').notNull().$type<Array<{ title: string; description?: string }>>().default([]),
  metadata:         jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  actorKind:        varchar('actor_kind', { length: 16 }).notNull().default('user'),
  actorId:          varchar('actor_id', { length: 128 }),
  message:          text('message'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  esclLogIndexUq:   unique().on(t.escalationId, t.logIndex),
  esclLogEscIdx:    index('idx_gov_escalation_logs_escalation').on(t.escalationId, t.logIndex),
}));

export const governanceEscalationReminders = pgTable('governance_escalation_reminders', {
  id:            uuid('id').primaryKey().defaultRandom(),
  escalationId:  uuid('escalation_id').notNull(),
  tenantId:      integer('tenant_id').notNull(),
  sequenceIndex: integer('sequence_index').notNull().default(0),
  kind:          varchar('kind', { length: 16 }).notNull(),
  sentAt:        timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  esclReminderUq: unique().on(t.escalationId, t.sequenceIndex, t.kind),
}));
