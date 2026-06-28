/**
 * DevFinOps tables (migration 0233) — declared here (not in the shared schema.ts,
 * which the orchestrator owns) so the finops services/routes can query them with
 * Drizzle. Mirrors the SQL exactly; jsonb columns use `.$type<…>()` for typing.
 */

import { pgTable, serial, integer, varchar, real, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Per-tenant R&D-credit (QRE) definition — the qualified-research filter + rate. */
export const rdTaxCreditConfig = pgTable('rd_tax_credit_config', {
  tenantId:            integer('tenant_id').primaryKey(),
  qualifiedCategories: jsonb('qualified_categories').$type<string[]>().notNull().default(sql`'["innovation","tech_debt"]'::jsonb`),
  blendedLaborRateUsd: real('blended_labor_rate_usd').notNull().default(95),
  qualifiedActionTypes: jsonb('qualified_action_types').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt:           timestamp('updated_at').notNull().defaultNow(),
});

/** SOC 1 Type II controls register — one assertion row per control objective.
 *  NOTE: table is `finops_soc_controls`, NOT `soc_controls`. The latter is the
 *  unrelated SOC 2 governance tracker (schema.ts / migration 0057); colliding on
 *  it made 0233's CREATE a no-op and 500'd the finops audit report (mig 0254). */
export const socControls = pgTable('finops_soc_controls', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  controlRef:   varchar('control_ref', { length: 32 }).notNull(),
  objective:    varchar('objective', { length: 240 }).notNull(),
  category:     varchar('category', { length: 48 }).notNull().default('general'),
  status:       varchar('status', { length: 16 }).notNull().default('gap'),
  owner:        varchar('owner', { length: 120 }),
  note:         text('note').default(''),
  lastReviewed: timestamp('last_reviewed'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

/** Log of assembled audit-ready period reports (the report itself is computed live). */
export const auditReportRuns = pgTable('audit_report_runs', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  periodMonth: varchar('period_month', { length: 7 }).notNull(),
  generatedBy: varchar('generated_by', { length: 36 }),
  summary:     jsonb('summary'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});
