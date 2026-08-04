/**
 * Schema — billing context.
 *
 * Split out of the single 7,500-line `schema.ts`, which held all 322 tables
 * in one file and was the largest source file in the repo by a factor of three.
 * `schema.ts` is now a barrel that re-exports every context, so nothing that
 * imports from it had to change.
 *
 * Imports between context modules are circular by nature — a task references a
 * project, a project references a tenant, and ownership runs in both directions
 * across contexts. That is safe here because EVERY table→table reference sits
 * inside a lazy callback (`references(() => other.id)`, and the index /
 * primaryKey builders), so no cross-module value is dereferenced while the
 * modules are still evaluating. `schema.tables.test.ts` renders SQL for every
 * exported table to keep that guarantee honest.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { freelancerEngagements, timecards } from './collaboration';
import { reportTypeEnum } from './common';
import { segments, tenants, users } from './identity';
import { initiatives } from './pmo';
import { projects } from './work';

/** Signup/checkout offers authored by platform operators. Codes are normalized
 * to uppercase at the API boundary; the database uniqueness constraint is the
 * final guard against two operators creating the same offer concurrently. */
export const discountCodes = pgTable('discount_codes', {
  id:             uuid('id').primaryKey().defaultRandom(),
  code:           varchar('code', { length: 64 }).notNull().unique(),
  percentOff:     integer('percent_off').notNull(),
  applicablePlan: varchar('applicable_plan', { length: 16 }).notNull().default('pro').$type<'pro' | 'teams'>(),
  billingCycle:   varchar('billing_cycle', { length: 16 }).notNull().default('yearly').$type<'monthly' | 'yearly'>(),
  durationYears:  integer('duration_years').notNull().default(1),
  isActive:       boolean('is_active').notNull().default(true),
  createdByUserId: varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One reservation/redemption per workspace and code. Reserving before the
 * external Checkout call closes the double-click/concurrent-session race. */
export const discountRedemptions = pgTable('discount_redemptions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  discountCodeId:    uuid('discount_code_id').notNull().references(() => discountCodes.id, { onDelete: 'restrict' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  checkoutSessionId: varchar('checkout_session_id', { length: 255 }),
  status:            varchar('status', { length: 16 }).notNull().default('pending').$type<'pending' | 'redeemed'>(),
  appliedAt:         timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  redeemedAt:        timestamp('redeemed_at', { withTimezone: true }),
}, (t) => [
  unique('uq_discount_redemption_tenant_code').on(t.tenantId, t.discountCodeId),
  uniqueIndex('uq_discount_redemption_checkout').on(t.checkoutSessionId),
  index('idx_discount_redemptions_tenant').on(t.tenantId, t.appliedAt),
]);


export const reportSubscriptions = pgTable('report_subscriptions', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  reportType:    reportTypeEnum('report_type').notNull(),
  isSubscribed:  boolean('is_subscribed').notNull().default(true),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_subscription_user_type').on(t.tenantId, t.userId, t.reportType),
]);


export const costCalculations = pgTable('cost_calculations', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:          uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  label:              varchar('label', { length: 255 }).notNull(),
  calculationType:    varchar('calculation_type', { length: 40 }),
  laborCost:          real('labor_cost'),
  overheadCost:       real('overhead_cost'),
  toolingCost:        real('tooling_cost'),
  infrastructureCost: real('infrastructure_cost'),
  totalCost:          real('total_cost'),
  runwayImpactDays:   integer('runway_impact_days'),
  notes:              text('notes'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Host subscriptions to BuilderForce outbound events (spec 05 §4.3):
 * workitem.released / sprint.completed / roadmap.published. Segment-scoped.
 */
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  url:        text('url').notNull(),
  secret:     varchar('secret', { length: 128 }).notNull(),
  events:     text('events').notNull().default('[]'), // JSON array of event types
  active:     boolean('active').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});


// ── Insight-lens object tiers (migration 0220) ───────────────────────────────
// The only NEW storage the role-insight lenses need; everything else they read
// (run_model_outcomes, deployment_events, llm_usage_log, tool_audit_events) is
// already collected. Both tenant + segment scoped, uuid PKs, so the generic
// segmentTrackerRoutes factory drives their CRUD.

/** FinOps ceiling (LENS #3 / CFO): a monthly spend limit per scope, compared
 *  against the already-attributed llm_usage_log actuals in financeInsights. */
export const budgets = pgTable('budgets', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scopeKind:    varchar('scope_kind', { length: 16 }).notNull().default('tenant'), // tenant | project | initiative
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'cascade' }),
  periodMonth:  varchar('period_month', { length: 7 }).notNull(), // 'YYYY-MM'
  limitUsd:     real('limit_usd').notNull().default(0),
  notes:        text('notes'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byScope: index('idx_budgets_scope').on(t.tenantId, t.segmentId, t.periodMonth),
}));


// ── R&D FINANCIALS (migration 0239) — disaggregated quarterly ────────────────

/** Quarterly R&D spend by category — Key R&D Financials on the Investment slide.
 *  One row per (fy, quarter, category) with actual + plan dollars. The board's
 *  categories (headcount/hosting/COGS/licenses) are not in any live ledger, so
 *  these are entered/imported (LLM/ingestion lines can auto-seed). */
export const rdFinancialsQuarterly = pgTable('rd_financials_quarterly', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fiscalYear:  integer('fiscal_year').notNull(),
  quarter:     integer('quarter').notNull(),                                       // 1..4
  category:    varchar('category', { length: 24 }).notNull(),                      // headcount | tech_debt | hosting_storage | cogs | internal | third_party_licenses
  actualUsd:   real('actual_usd').notNull().default(0),
  planUsd:     real('plan_usd').notNull().default(0),
  source:      varchar('source', { length: 16 }).notNull().default('manual'),      // manual | llm_usage | import
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byFy: index('idx_rd_financials_fy').on(t.tenantId, t.fiscalYear, t.quarter),
  uqCat: uniqueIndex('uq_rd_financials_cat').on(t.tenantId, t.fiscalYear, t.quarter, t.category),
}));


/** Quarterly R&D revenue — backs the Total-R&D$/Revenue ratio on the Investment slide. */
export const rdRevenueQuarterly = pgTable('rd_revenue_quarterly', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fiscalYear: integer('fiscal_year').notNull(),
  quarter:    integer('quarter').notNull(),
  revenueUsd: real('revenue_usd').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqQuarter: uniqueIndex('uq_rd_revenue_quarter').on(t.tenantId, t.fiscalYear, t.quarter),
}));


/** Invoice generated on timecard approval; carries payment status. One per timecard. */
export const freelancerInvoices = pgTable('freelancer_invoices', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  timecardId:        varchar('timecard_id', { length: 36 }).notNull().references(() => timecards.id, { onDelete: 'cascade' }),
  engagementId:      varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCents:       integer('amount_cents').notNull().default(0),
  currency:          varchar('currency', { length: 3 }).notNull().default('USD'),
  status:            varchar('status', { length: 20 }).notNull().default('pending'), // pending|paid|void
  externalRef:       varchar('external_ref', { length: 200 }),
  issuedAt:          timestamp('issued_at').notNull().defaultNow(),
  paidAt:            timestamp('paid_at'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_invoices_tenant').on(t.tenantId),
  byFreelancer: index('idx_invoices_freelancer').on(t.freelancerUserId),
}));
