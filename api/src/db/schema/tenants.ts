/**
 * Tenants Drizzle Schema
 * 
 * Defines the Drizzle schema for tenant table.
 * Provides TypeScript type-safe database queries.
 */

import { sql, sqliteTable, text, integer } from 'drizzle-orm';
import { index } from 'drizzle-orm/sqlite-core';

// Table definition
export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    archivedAt: integer('archived_at', { mode: 'timestamp' }),
  },
  (table) => ({
    // Indexes
    archivedAtIdx: index('tenants_archived_at_idx').on(table.archivedAt),
  }),
);

// Type utility for tenants
export type Tenant = typeof tenants.$inferSelect;
export type NewTenantInput = typeof tenants.$inferInsert;

// Table column accessors
export const { id, slug, name, createdAt, archivedAt } = tenants;