// Domain-scoped reusable type definitions and DB table factories for project-level entities.
// Intended to be imported by services, routes, and middlewares to ensure a single source of truth.
// See `migrations/0286_project_baseline.sql` for the upsert/delta schema in SQL.
// See `migrations/0258_project_evermind.sql` for a similar project-scoped patterns.

import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uuid, sqliteTable as sqlTable, integer as intPK, } from 'drizzle-orm/sqlite-core';

/** Sessions for project-scoped questionnaire wizard instances. */
export const projectBaselineSessions = sqliteTable(
  'project_baseline_sessions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenant_id: integer("tenant_id").notNull().references(() => tenants.id),
    project_id: integer("project_id").notNull().references(() => projects.id),
    hub_rental_token_id: integer("hub_rental_token_id").references(() => hubRentalTokens.id),
    role_key: text("role_key").notNull(),   // auth policy key, e.g. 'diagnostic-onboarding'
    completed_at: integer("completed_at"),
    created_at: integer("created_at").notNull().default(sql`unixepoch()`),
    updated_at: integer("updated_at").notNull().default(sql`unixepoch()`),
  },
  (table) => ({
    tenantIdx: index("idx_project_baseline_sessions_tenant").on(table.tenant_id),
    tenantProjectIdx: index("idx_project_baseline_sessions_tenant_project").on(table.tenant_id, table.project_id),
  })
);

/** End of Baseline entities */