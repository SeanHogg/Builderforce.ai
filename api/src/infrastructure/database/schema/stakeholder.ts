/**
 * Schema — stakeholder context.
 *
 * Provides stakeholder mapping and alignment diagnostic capabilities:
 * - Stakeholder entities with role/organization/department info
 * - Stakeholder relationships (reports_to, collaborates_with, etc.)
 * - Alignment snapshots for tracking stakeholder alignment over time
 *
 * Split out from the single 7,500-line `schema.ts` for modularity.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { segments, tenants, users } from './identity';
import { projects } from './work';


/**
 * Core stakeholder entity for tracking individuals involved in projects
 * and organizational initiatives. Supports Project Managers, Team Leads,
 * Executives, and other stakeholder roles.
 */
export const stakeholderMaps = pgTable('stakeholder_maps', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:          varchar('name', { length: 255 }).notNull(),
  email:         varchar('email', { length: 255 }),
  role:          varchar('role', { length: 100 }),
  organization: varchar('organization', { length: 255 }),
  department:    varchar('department', { length: 255 }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  isActive:      boolean('is_active').notNull().default(true),
  metadata:      jsonb('metadata').default({}),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Tracks relationships between stakeholders. Supports various relationship
 * types including reporting lines, collaborations, and dependencies.
 */
export const stakeholderRelationships = pgTable('stakeholder_relationships', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:            uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  sourceStakeholderId:  uuid('source_stakeholder_id').notNull().references(() => stakeholderMaps.id, { onDelete: 'cascade' }),
  targetStakeholderId:  uuid('target_stakeholder_id').notNull().references(() => stakeholderMaps.id, { onDelete: 'cascade' }),
  relationshipType:     varchar('relationship_type', { length: 50 }).notNull(),
  strength:             varchar('strength', { length: 20 }).default('medium'),
  description:          text('description'),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Point-in-time snapshots of stakeholder alignment assessments.
 * Enables tracking alignment metrics and generating reports over time.
 */
export const stakeholderAlignmentSnapshots = pgTable('stakeholder_alignment_snapshots', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:           uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:           integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  snapshotDate:        date('snapshot_date').notNull().default(new Date()),
  alignmentScore:      integer('alignment_score'),
  communicationScore:  integer('communication_score'),
  resourceScore:       integer('resource_score'),
  findings:            jsonb('findings').default([]),
  recommendations:     jsonb('recommendations').default([]),
  createdBy:           varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:           timestamp('created_at').notNull().defaultNow(),
});
