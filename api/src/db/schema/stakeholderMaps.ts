/**
 * Stakeholder Maps Drizzle Schema
 * 
 * Defines the Drizzle schema for stakeholder maps table.
 * Provides TypeScript type-safe database queries.
 */

import { sql, sqliteTable, text, integer } from 'drizzle-orm';
import { sqliteTableWithHooks } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { tenantBaseColumns } from './index.js';

// Table definition
export const stakeholderMaps = sqliteTableWithHooks(
  'stakeholder_maps',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    initiativeId: text('initiative_id').notNull(),
    projectId: text('project_id'),
    approverIds: text('approver_ids', { mode: 'json' }).notNull().$type<string[]>().default(sql`'{}'`),
    informedPartyIds: text('informed_party_ids', { mode: 'json' }).notNull().$type<string[]>().default(sql`'{}'`),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => ({
    // Relations
    tenant: relations(table, many, (tenants) =>
      tenants.stakeholderMaps,
    ),
  }),
);

// Type utility for stakeholder maps
export type StakeholderMap = typeof stakeholderMaps.$inferSelect;
export type NewStakeholderMapInput = typeof stakeholderMaps.$inferInsert;

// Table column accessors
export const {
  id,
  tenantId,
  initiativeId,
  projectId,
  approverIds,
  informedPartyIds,
  version,
  createdAt,
  updatedAt,
  createdBy,
  updatedBy,
} = stakeholderMaps;