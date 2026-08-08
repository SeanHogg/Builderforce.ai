/**
 * Schema — Finance, owned by the **CFO** (PRD 20 §3).
 *
 * Root entity `ledger_entry`. 70 source tables in → 26 out, 31 of them absorbed by
 * the kernel ledger: points, tokens, AI credits, enrichment credits, campaign
 * dollars, phone balance, partner and seller balances, payouts and commissions are
 * one table with a denomination column.
 *
 * Renamed from `billing.ts`: billing is one capability of the finance domain, not
 * the domain, and naming the module after the smaller of the two is what left
 * expenses, runway and scenarios with nowhere obvious to go.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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
import { freelancerEngagements, timecards } from './canvas';
import { objects, reportTypeEnum } from './kernel';
import { segments, tenants, users } from './identity';
import { initiatives } from './delivery';
import { projects } from './delivery';
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

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Finance — the CFO's twenty remaining targets (PRD 20 §3.2).
//
// 31 of this domain's 70 source tables were absorbed by the kernel ledger, which
// is the single largest absorption in the model: points, tokens, AI credits,
// enrichment credits, campaign dollars, phone balance, partner and seller
// balances, payouts and commissions are `ledger_entries` rows separated by a
// denomination column. Nothing below holds a balance.
//
// Two flattening moves ran on the way in (§3.2):
//   · KIND-SPLIT — `billing_plans` = `pricing_plans` = `subscription_plans`
//     shared name, description and currency, and `pricing_plans` was the third
//     member the machine missed because `pricing` is a head noun elsewhere
//     (§3.3). One `billing_plans` with a `kind`.
//   · DERIVED → `metric_fact` — `arr_projections`, `quota_attainment` and
//     `rd_financials_quarterly` are computed numbers with their own DDL. They
//     are rollups into `metric_facts`, not tables.
//
// `break_even_scenarios` survives as the root of the scenario family; its cost
// columns became assumption keys, which is what let `forecast_scenarios`,
// `what_if_scenarios` and `validation_scenarios` collapse into it (§3.3).

/**
 * A plan somebody can be on.
 *
 * One table with a `kind`, replacing `billing_plans` = `pricing_plans` =
 * `subscription_plans`. The three differed only in which screen read them —
 * pricing page, checkout, admin — which is the facet mistake wearing three names.
 */
export const billingPlans = pgTable('billing_plans', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id'),
  /** 'subscription' | 'usage' | 'seat' | 'one_off'. */
  kind:          varchar('kind', { length: 24 }).notNull().default('subscription'),
  code:          varchar('code', { length: 64 }).notNull(),
  name:          varchar('name', { length: 200 }).notNull(),
  description:   text('description'),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  amountCents:   integer('amount_cents').notNull().default(0),
  /** 'monthly' | 'yearly' | 'once' | 'metered'. */
  interval:      varchar('interval', { length: 16 }).notNull().default('monthly'),
  trialDays:     integer('trial_days').notNull().default(0),
  /** What the plan INCLUDES, resolved through the one `planFeatures` evaluator —
   *  never a second entitlement source. */
  featureKeys:   jsonb('feature_keys'),
  providerRef:   varchar('provider_ref', { length: 160 }),
  isPublic:      boolean('is_public').notNull().default(true),
  position:      integer('position').notNull().default(0),
  retiredAt:     timestamp('retired_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_billing_plans_code').on(t.tenantId, t.code),
  index('idx_billing_plans_public').on(t.isPublic, t.position),
]);

/** One feature a plan grants, with its limit. The GRANT to an account is a
 *  kernel `settings` row — `account_features` collapsed there (§3.3), because
 *  account + feature + is_enabled + consent is an entitlement, not a table. */
export const planFeatures = pgTable('plan_features', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  planId:     integer('plan_id').references(() => billingPlans.id, { onDelete: 'cascade' }),
  featureKey: varchar('feature_key', { length: 96 }).notNull(),
  /** Null means unlimited; 0 means present but off. */
  limitValue: numeric('limit_value', { precision: 20, scale: 4 }),
  unit:       varchar('unit', { length: 24 }),
  /** 'hard' | 'soft' — a hard limit 402s, a soft one warns. */
  enforcement: varchar('enforcement', { length: 12 }).notNull().default('hard'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_plan_features_key').on(t.planId, t.featureKey),
]);

/** How a tenant charges for its own product — the model, not the price list. */
export const businessPricingModels = pgTable('business_pricing_models', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  /** 'flat' | 'per_seat' | 'usage' | 'tiered' | 'hybrid'. */
  model:       varchar('model', { length: 24 }).notNull(),
  assumptions: jsonb('assumptions'),
  basePrice:   numeric('base_price', { precision: 14, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  isCurrent:   boolean('is_current').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_business_pricing_models_name').on(t.tenantId, t.name),
]);

/** A what-if run over a pricing model. */
export const pricingSimulations = pgTable('pricing_simulations', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull(),
  pricingModelId: integer('pricing_model_id').references(() => businessPricingModels.id, { onDelete: 'cascade' }),
  name:           varchar('name', { length: 200 }).notNull(),
  inputs:         jsonb('inputs').notNull().default('{}'),
  results:        jsonb('results'),
  projectedMrr:   numeric('projected_mrr', { precision: 16, scale: 2 }),
  projectedChurn: numeric('projected_churn', { precision: 5, scale: 2 }),
  runAt:          timestamp('run_at'),
  createdBy:      varchar('created_by', { length: 64 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_pricing_simulations_model').on(t.pricingModelId, t.runAt),
]);

/**
 * The scenario root.
 *
 * `forecast_scenarios`, `what_if_scenarios` and `validation_scenarios` collapsed
 * into this (§3.3): assumptions in, projected numbers out. Its own cost columns
 * became assumption keys, which is what made the collapse possible rather than a
 * null-padded union.
 */
export const breakEvenScenarios = pgTable('break_even_scenarios', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'break_even' | 'forecast' | 'what_if' | 'validation'. The column that
   *  replaced three tables. */
  kind:          varchar('kind', { length: 24 }).notNull().default('break_even'),
  name:          varchar('name', { length: 200 }).notNull(),
  description:   text('description'),
  horizonMonths: integer('horizon_months').notNull().default(12),
  /** Projected series, keyed by metric. The inputs are `scenario_assumptions`. */
  projections:   jsonb('projections'),
  breakEvenAt:   timestamp('break_even_at'),
  status:        varchar('status', { length: 16 }).notNull().default('draft'),
  isBaseline:    boolean('is_baseline').notNull().default(false),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_break_even_scenarios_name').on(t.tenantId, t.name),
  index('idx_break_even_scenarios_kind').on(t.tenantId, t.kind, t.updatedAt),
]);

/** One assumption feeding one scenario. A row rather than a JSON key because
 *  assumptions are compared ACROSS scenarios — "what did we assume about churn"
 *  is the question the whole family exists to answer. */
export const scenarioAssumptions = pgTable('scenario_assumptions', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  scenarioId: integer('scenario_id').references(() => breakEvenScenarios.id, { onDelete: 'cascade' }),
  key:        varchar('key', { length: 96 }).notNull(),
  label:      varchar('label', { length: 200 }),
  value:      numeric('value', { precision: 20, scale: 6 }),
  unit:       varchar('unit', { length: 24 }),
  /** 'given' | 'derived' | 'sensitivity' — a sensitivity assumption is the one a
   *  Monte Carlo run varies. */
  role:       varchar('role', { length: 16 }).notNull().default('given'),
  minValue:   numeric('min_value', { precision: 20, scale: 6 }),
  maxValue:   numeric('max_value', { precision: 20, scale: 6 }),
  note:       text('note'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_scenario_assumptions_key').on(t.scenarioId, t.key),
]);

/** A Monte Carlo run over a scenario's sensitivity assumptions. */
export const monteCarloSimulations = pgTable('monte_carlo_simulations', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  scenarioId:  integer('scenario_id').references(() => breakEvenScenarios.id, { onDelete: 'cascade' }),
  iterations:  integer('iterations').notNull().default(10000),
  seed:        integer('seed'),
  /** p10 / p50 / p90 per output metric. */
  percentiles: jsonb('percentiles'),
  histogram:   jsonb('histogram'),
  runAt:       timestamp('run_at'),
  durationMs:  integer('duration_ms'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_monte_carlo_simulations_scenario').on(t.scenarioId, t.runAt),
]);

/** A saved calculation — the CFO's scratch arithmetic, kept so a number in a
 *  board pack can be traced back to how it was produced. */
export const savedCalculations = pgTable('saved_calculations', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  formula:    text('formula').notNull(),
  inputs:     jsonb('inputs'),
  result:     numeric('result', { precision: 24, scale: 6 }),
  unit:       varchar('unit', { length: 24 }),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  computedAt: timestamp('computed_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_saved_calculations_name').on(t.tenantId, t.ownerRef, t.name),
]);

/** The definition of a KPI. The VALUES are `metric_facts`; this is what the KPI
 *  means, which is what makes two tenants' "ARR" comparable or not. */
export const customKpis = pgTable('custom_kpis', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  key:         varchar('key', { length: 96 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  unit:        varchar('unit', { length: 24 }),
  /** 'up' | 'down' — which direction is good, so one chart primitive can colour
   *  a delta without a per-KPI rule in the component. */
  goodDirection: varchar('good_direction', { length: 8 }).notNull().default('up'),
  target:      numeric('target', { precision: 20, scale: 4 }),
  cadence:     varchar('cadence', { length: 16 }).notNull().default('month'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_custom_kpis_key').on(t.tenantId, t.key),
]);

/** How a KPI is computed. Separate from the KPI because a formula is VERSIONED —
 *  changing how ARR is computed must not silently rewrite last quarter's number. */
export const kpiFormulas = pgTable('kpi_formulas', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  kpiId:         integer('kpi_id').references(() => customKpis.id, { onDelete: 'cascade' }),
  version:       integer('version').notNull().default(1),
  expression:    text('expression').notNull(),
  /** The `metric_facts` metric keys this formula reads. */
  inputs:        jsonb('inputs'),
  effectiveFrom: timestamp('effective_from').notNull().defaultNow(),
  effectiveTo:   timestamp('effective_to'),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_kpi_formulas_version').on(t.kpiId, t.version),
]);

/** Money going out. The PAYMENT is a `ledger_entries` row; this is the claim,
 *  which exists before it is paid and can be rejected. */
export const expenses = pgTable('expenses', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  category:    varchar('category', { length: 96 }).notNull(),
  vendor:      varchar('vendor', { length: 200 }),
  description: text('description'),
  amount:      numeric('amount', { precision: 16, scale: 2 }).notNull(),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  incurredAt:  timestamp('incurred_at').notNull(),
  /** 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  submittedBy: varchar('submitted_by', { length: 64 }),
  approvedBy:  varchar('approved_by', { length: 64 }),
  receiptArtifactId: uuid('receipt_artifact_id'),
  costCentre:  varchar('cost_centre', { length: 96 }),
  isRecurring: boolean('is_recurring').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_expenses_status').on(t.tenantId, t.status, t.incurredAt),
  index('idx_expenses_category').on(t.tenantId, t.category, t.incurredAt),
]);

/** A line on an invoice. */
export const invoiceLineItems = pgTable('invoice_line_items', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  invoiceRef:  varchar('invoice_ref', { length: 64 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  quantity:    numeric('quantity', { precision: 14, scale: 4 }).notNull().default('1'),
  unitAmount:  numeric('unit_amount', { precision: 16, scale: 4 }).notNull(),
  amount:      numeric('amount', { precision: 16, scale: 2 }).notNull(),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  taxRate:     numeric('tax_rate', { precision: 6, scale: 3 }),
  taxAmount:   numeric('tax_amount', { precision: 16, scale: 2 }),
  /** What was billed — a plan, a placement, a timesheet, a usage meter. */
  sourceKind:  varchar('source_kind', { length: 32 }),
  sourceRef:   varchar('source_ref', { length: 64 }),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_invoice_line_items_invoice').on(t.tenantId, t.invoiceRef, t.position),
]);

/** A stored way to pay. The token never touches this table — the secret lives in
 *  kernel `credentials`; this is what the UI renders. */
export const paymentMethods = pgTable('payment_methods', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  provider:    varchar('provider', { length: 48 }).notNull(),
  providerRef: varchar('provider_ref', { length: 160 }).notNull(),
  /** 'card' | 'bank' | 'wallet' | 'invoice'. */
  kind:        varchar('kind', { length: 16 }).notNull().default('card'),
  brand:       varchar('brand', { length: 32 }),
  last4:       varchar('last4', { length: 4 }),
  expMonth:    integer('exp_month'),
  expYear:     integer('exp_year'),
  isDefault:   boolean('is_default').notNull().default(false),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_payment_methods_provider').on(t.tenantId, t.provider, t.providerRef),
]);

/** A funding round. */
export const fundingRounds = pgTable('funding_rounds', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  companyRef:   varchar('company_ref', { length: 64 }),
  name:         varchar('name', { length: 120 }).notNull(),
  instrument:   varchar('instrument', { length: 32 }).notNull().default('equity'),
  amountRaised: numeric('amount_raised', { precision: 18, scale: 2 }),
  preMoney:     numeric('pre_money', { precision: 18, scale: 2 }),
  postMoney:    numeric('post_money', { precision: 18, scale: 2 }),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  leadInvestor: varchar('lead_investor', { length: 200 }),
  closedAt:     timestamp('closed_at'),
  status:       varchar('status', { length: 16 }).notNull().default('open'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_funding_rounds_name').on(t.tenantId, t.companyRef, t.name),
]);

/** How a role is paid — the band, not the person's salary. */
export const compensationStructures = pgTable('compensation_structures', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  roleFamily:  varchar('role_family', { length: 96 }).notNull(),
  level:       varchar('level', { length: 32 }).notNull(),
  location:    varchar('location', { length: 120 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  baseMin:     numeric('base_min', { precision: 14, scale: 2 }),
  baseMid:     numeric('base_mid', { precision: 14, scale: 2 }),
  baseMax:     numeric('base_max', { precision: 14, scale: 2 }),
  bonusPercent: numeric('bonus_percent', { precision: 5, scale: 2 }),
  equityPercent: numeric('equity_percent', { precision: 8, scale: 5 }),
  effectiveFrom: timestamp('effective_from').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_compensation_structures_band').on(t.tenantId, t.roleFamily, t.level, t.location),
]);

/** Hours worked, for billing or payroll. */
export const timesheets = pgTable('timesheets', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  workerRef:    varchar('worker_ref', { length: 64 }).notNull(),
  periodStart:  timestamp('period_start').notNull(),
  periodEnd:    timestamp('period_end').notNull(),
  hours:        numeric('hours', { precision: 8, scale: 2 }).notNull().default('0'),
  billableHours: numeric('billable_hours', { precision: 8, scale: 2 }).notNull().default('0'),
  rate:         numeric('rate', { precision: 12, scale: 2 }),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'draft' | 'submitted' | 'approved' | 'rejected' | 'invoiced'. */
  status:       varchar('status', { length: 16 }).notNull().default('draft'),
  approvedBy:   varchar('approved_by', { length: 64 }),
  submittedAt:  timestamp('submitted_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_timesheets_period').on(t.tenantId, t.workerRef, t.periodStart),
  index('idx_timesheets_status').on(t.tenantId, t.status, t.periodEnd),
]);

/** How long an investment takes to pay for itself. */
export const paybackPeriod = pgTable('payback_period', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  subjectKind: varchar('subject_kind', { length: 32 }).notNull(),
  subjectRef:  varchar('subject_ref', { length: 64 }).notNull(),
  investment:  numeric('investment', { precision: 18, scale: 2 }).notNull(),
  monthlyReturn: numeric('monthly_return', { precision: 18, scale: 2 }),
  paybackMonths: numeric('payback_months', { precision: 8, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  computedAt:  timestamp('computed_at').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_payback_period_subject').on(t.tenantId, t.subjectKind, t.subjectRef),
]);

/** A point on an ROI curve. */
export const roiTimelineEntries = pgTable('roi_timeline_entries', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  subjectKind: varchar('subject_kind', { length: 32 }).notNull(),
  subjectRef:  varchar('subject_ref', { length: 64 }).notNull(),
  periodAt:    timestamp('period_at').notNull(),
  cost:        numeric('cost', { precision: 18, scale: 2 }).notNull().default('0'),
  benefit:     numeric('benefit', { precision: 18, scale: 2 }).notNull().default('0'),
  cumulative:  numeric('cumulative', { precision: 18, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  note:        text('note'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_roi_timeline_entries_point').on(t.tenantId, t.subjectKind, t.subjectRef, t.periodAt),
]);

/** A predicted churn event, with the evidence behind it. */
export const churnPredictions = pgTable('churn_predictions', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  accountRef:  varchar('account_ref', { length: 64 }).notNull(),
  probability: numeric('probability', { precision: 5, scale: 4 }).notNull(),
  /** 'low' | 'medium' | 'high' | 'critical' — banded once, here, so the badge in
   *  every surface reads the same threshold. */
  band:        varchar('band', { length: 16 }).notNull(),
  drivers:     jsonb('drivers'),
  model:       varchar('model', { length: 96 }),
  horizonDays: integer('horizon_days').notNull().default(90),
  predictedAt: timestamp('predicted_at').notNull().defaultNow(),
  outcome:     varchar('outcome', { length: 16 }),
  outcomeAt:   timestamp('outcome_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_churn_predictions_band').on(t.tenantId, t.band, t.predictedAt),
  index('idx_churn_predictions_account').on(t.tenantId, t.accountRef, t.predictedAt),
]);

/** A redemption of points. The BALANCE movement is a `ledger_entries` row in the
 *  `points` denomination; this is what was redeemed FOR, which the ledger's memo
 *  field would otherwise have to carry as prose. */
export const pointRedemptions = pgTable('point_redemptions', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  memberRef:   varchar('member_ref', { length: 64 }).notNull(),
  rewardKey:   varchar('reward_key', { length: 96 }).notNull(),
  pointsSpent: integer('points_spent').notNull(),
  /** The `ledger_entries.reference` this redemption settled under. */
  ledgerRef:   varchar('ledger_ref', { length: 160 }),
  /** 'pending' | 'fulfilled' | 'cancelled' | 'refunded'. */
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  fulfilledAt: timestamp('fulfilled_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_point_redemptions_member').on(t.tenantId, t.memberRef, t.createdAt),
]);
