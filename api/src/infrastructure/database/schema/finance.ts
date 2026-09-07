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
import { creationSessions, freelancerEngagements, timecards } from './canvas';
import { connections, objects, reportTypeEnum } from './kernel';
import { segments, tenantApiKeys, tenants, users } from './identity';
import { initiatives, projects } from './delivery';
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
 * ONE outbound-event subscription, for every caller that has one.
 *
 * It started as the host's subscription to the channel-3 seams (spec 05 §4.3 —
 * workitem.released / sprint.completed / roadmap.published) and was segment-scoped
 * because the seam resolves a named end-client before it emits. The public canvas
 * API (`/api/v1`) subscribes to board and item lifecycle events through this same
 * table rather than a second one: a second subscription table means a second
 * signing scheme, a second backoff curve and two answers to "did it land", only
 * one of which gets the next fix.
 *
 * TENANT is therefore the scope that is always present, and `segment_id` is
 * narrowing context (migration 1100) — a canvas board's segment is optional, so a
 * mandatory one made a tenant-wide board subscription unrepresentable.
 */
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Narrowing context, not the scope. NULL = every segment in the tenant. */
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** Watch ONE board. NULL = every board in the tenant. Miro scopes a webhook to a
   *  board, and an integration that must receive the whole workspace to react to
   *  one canvas is an integration that gets switched off. */
  sessionId:  uuid('session_id').references(() => creationSessions.id, { onDelete: 'cascade' }),
  url:        text('url').notNull(),
  secret:     varchar('secret', { length: 128 }).notNull(),
  events:     text('events').notNull().default('[]'), // JSON array of event types
  active:     boolean('active').notNull().default(true),
  description: varchar('description', { length: 255 }),
  /** Which credential registered this endpoint — the first question asked when a
   *  subscription starts leaking events to a vendor whose contract ended. NULL for
   *  the seam subscriptions, which predate `/api/v1` registration. */
  createdByKeyId: uuid('created_by_key_id').references(() => tenantApiKeys.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenantActive: index('idx_webhook_subscriptions_tenant_active').on(t.tenantId, t.active),
  bySession:      index('idx_webhook_subscriptions_session').on(t.sessionId),
}));


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

// ---------------------------------------------------------------------------
// Receivable and payable — the two headers the LINES were always pointing at
// (migration 0469)
// ---------------------------------------------------------------------------
//
// `invoice_line_items` shipped carrying `invoice_ref` as a bare varchar pointing
// at nothing: the LINES existed and the invoice did not. The only invoice table
// on the platform was `freelancer_invoices`, which is the marketplace paying its
// own freelancers — a different fact entirely.
//
// WHY TWO HEADERS AND NOT ONE WITH A `direction`. Receivable and payable are the
// same SHAPE and they are not the same concept, and the difference is in the
// invariants rather than in the columns. An invoice is issued, aged and chased —
// it has a paid amount, a collections history and a customer. A bill is
// APPROVED, scheduled and disputed — it has an approver, a payment date and a
// vendor, and `approved_by` is the one column on this platform that can cause
// real financial harm if a generic writer fills it in on somebody's behalf.
// Folding them into one table would put "who authorised this payment" and "how
// overdue is this receipt" in the same row and give the approval column no
// natural home. Two tables with two lifecycles is the DDD answer; the shared
// SHAPE is reused by the line-item table below rather than copied.
//
// WHY THE LINES ARE ONE TABLE FOR BOTH. That is the other half of the same
// argument, applied the other way: a billed line is a billed line — a
// description, a quantity, a unit amount and a tax rate — with no invariant that
// differs by direction. A `bill_line_items` table would be the per-feature copy
// of an existing shape §0 forbids, and the two copies would drift the first time
// somebody added a discount column to one. So the discriminator is a column
// value, which is the same rule everything else here follows.

/**
 * A receivable — what a customer owes us.
 *
 * `reference` is the natural key `invoice_line_items.invoice_ref` resolves to,
 * which is what turns that column from a string into a real reference. It is
 * unique per tenant and the composite foreign key is declared in the migration.
 *
 * NO STORED `ageingDays` and NO STORED total. Ageing is `now() - due_at` and a
 * stored one is wrong every day after it is written; the total is the sum of the
 * lines and a stored one is the number that ends up disagreeing with the rows
 * printed directly beneath it — the same rule `work_estimates.lines` states.
 * `amount` is the AGREED total including tax, which is a fact the issuer asserts
 * and not a derivation, so it is stored and the lines are checked against it.
 */
export const invoices = pgTable('invoices', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** Our own invoice number. The natural key the lines point at. */
  reference:     varchar('reference', { length: 64 }).notNull(),
  /** `party_roles.party_ref` for the customer — the counterparty binding. */
  customerRef:   varchar('customer_ref', { length: 64 }),
  /** The name as it must appear on the document. Kept beside the ref rather than
   *  joined at render: an invoice is a legal record of what was sent, and the
   *  name on it must not change because somebody later renamed the account. */
  customerName:  varchar('customer_name', { length: 200 }).notNull(),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'draft' | 'issued' | 'part-paid' | 'paid' | 'void' | 'written-off'. */
  status:        varchar('status', { length: 16 }).notNull().default('draft'),
  issuedAt:      timestamp('issued_at'),
  dueAt:         timestamp('due_at'),
  amount:        numeric('amount', { precision: 16, scale: 2 }).notNull(),
  taxAmount:     numeric('tax_amount', { precision: 16, scale: 2 }),
  /** How much has actually landed. Part payment is the normal case, so this is
   *  not a boolean. */
  paidAmount:    numeric('paid_amount', { precision: 16, scale: 2 }).notNull().default('0'),
  paidAt:        timestamp('paid_at'),
  notes:         text('notes'),
  createdBy:     varchar('created_by', { length: 64 }),
  /** Who ISSUED it, from the session. Separate from `createdBy` for the same
   *  reason `bills.approvedBy` is separate from its creator: drafting a document
   *  and standing behind the one that left the building are two acts, and only
   *  the second is attested. */
  issuedBy:      varchar('issued_by', { length: 64 }),
  /** Where the issued document was delivered, and when. Null on an invoice that
   *  was issued without a recipient — legitimate for one handed over in person,
   *  and the reason delivery is not inferred from `issuedAt`. */
  sentTo:        varchar('sent_to', { length: 320 }),
  sentAt:        timestamp('sent_at'),
  /** The credential for the PUBLIC document page — the customer has no
   *  Builderforce account, so the token IS the authorisation. Only its hash is
   *  stored, exactly as `form_recipients.token_hash` and the signature parties
   *  do; the plaintext is returned once, by `issueInvoice`. */
  documentTokenHash: varchar('document_token_hash', { length: 64 }),
  /** FO-C4 — the hosted checkout the customer pays through, minted against the
   *  tenant's OWN connected merchant account. Null when the workspace has not
   *  onboarded one: an issued invoice is still a real invoice, it simply has to
   *  be paid by bank transfer. */
  paymentLinkUrl:    text('payment_link_url'),
  paymentSessionId:  varchar('payment_session_id', { length: 160 }),
  /**
   * How hard the collections ladder may work this one (FO-C5).
   *
   * 'off'    — never chased by the sweep.
   * 'notify' — the DEFAULT. The sweep records the step that is due and tells the
   *            workspace; nothing leaves the building unattended. This is the
   *            same line `runTriggerSweep` draws when it refuses to perform a
   *            trigger's `thenDo`: the board says what happened, a person acts.
   * 'auto'   — the tenant has explicitly delegated the chase, so the sweep sends
   *            the email itself.
   */
  collectionMode: varchar('collection_mode', { length: 16 }).notNull().default('notify'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_invoices_reference').on(t.tenantId, t.reference),
  index('idx_invoices_status').on(t.tenantId, t.status, t.dueAt),
  index('idx_invoices_customer').on(t.tenantId, t.customerRef, t.status),
  /** The collections sweep's own read: overdue, chaseable, oldest first. */
  index('idx_invoices_collection').on(t.tenantId, t.collectionMode, t.status, t.dueAt),
  uniqueIndex('uq_invoices_document_token').on(t.documentTokenHash),
]);

/**
 * A payable — what we owe a vendor.
 *
 * `finance.expenses` does NOT cover this and the difference is not cosmetic: an
 * expense is a CLAIM — a person spent money and wants it back, hence
 * `submitted_by`, `category` and `incurred_at`. A bill is a vendor's demand with
 * a counterparty, a due date and an approval, and nobody is owed a reimbursement.
 *
 * `approvedBy` is deliberately NOT writable through the generic entity path (the
 * entity declares itself read-only): an approval nobody gave is the one field
 * here that can cause real harm, so it is written by the approve handler, which
 * refuses to let the requester approve their own bill.
 */
export const bills = pgTable('bills', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** The VENDOR's own reference, not ours — which is why it is unique per vendor
   *  rather than per tenant: two suppliers both numbering from 1001 is normal,
   *  and one of them re-sending 1001 is a duplicate we must refuse. */
  reference:     varchar('reference', { length: 64 }).notNull(),
  vendorRef:     varchar('vendor_ref', { length: 64 }),
  vendorName:    varchar('vendor_name', { length: 200 }).notNull(),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'received' | 'approved' | 'scheduled' | 'paid' | 'disputed' | 'void'. */
  status:        varchar('status', { length: 16 }).notNull().default('received'),
  receivedAt:    timestamp('received_at').notNull().defaultNow(),
  dueAt:         timestamp('due_at'),
  amount:        numeric('amount', { precision: 16, scale: 2 }).notNull(),
  taxAmount:     numeric('tax_amount', { precision: 16, scale: 2 }),
  paidAmount:    numeric('paid_amount', { precision: 16, scale: 2 }).notNull().default('0'),
  /** Which budget line this lands on — what connects a bill to a `budget`. An
   *  uncategorised bill cannot appear in a variance. */
  category:      varchar('category', { length: 96 }),
  approvedBy:    varchar('approved_by', { length: 64 }),
  approvedAt:    timestamp('approved_at'),
  /** The date a payment run should release it. Set by schedule-payment, which
   *  refuses on anything unapproved. */
  scheduledFor:  timestamp('scheduled_for'),
  paidAt:        timestamp('paid_at'),
  disputedAt:    timestamp('disputed_at'),
  disputeReason: text('dispute_reason'),
  /** 'none' | 'monthly' | 'quarterly' | 'annual'. A recurring bill is a committed
   *  cost and belongs in the forecast, not just in this month. */
  recurring:     varchar('recurring', { length: 16 }).notNull().default('none'),
  notes:         text('notes'),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_bills_reference').on(t.tenantId, t.vendorRef, t.reference),
  index('idx_bills_status').on(t.tenantId, t.status, t.dueAt),
  index('idx_bills_schedule').on(t.tenantId, t.scheduledFor),
]);

/** A line on an invoice or a bill. See the section note for why one table serves
 *  both: a billed line has no invariant that differs by direction, so the
 *  direction is a column value and not a second table. */
export const invoiceLineItems = pgTable('invoice_line_items', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  /**
   * Which header this line belongs to: 'invoice' (default, so every existing row
   * keeps meaning exactly what it meant) or 'bill'.
   */
  documentKind: varchar('document_kind', { length: 16 }).notNull().default('invoice'),
  /** `invoices.reference` or `bills.reference`, per `documentKind`. */
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
  index('idx_invoice_line_items_invoice').on(t.tenantId, t.documentKind, t.invoiceRef, t.position),
]);

/**
 * One rung of the collections ladder, actually climbed (FO-C5).
 *
 * `invoice.collection` was authored prose under a hint that says "collections
 * work with no record is collections work that gets done twice or not at all".
 * This is that record, and the shape of it is the whole design:
 *
 * **`(tenant, invoice_ref, step)` is UNIQUE.** A ladder rung can be climbed once
 * per invoice, and a second attempt collides in the DATABASE rather than in a
 * check somebody remembered to write — the same argument `bills`' vendor
 * reference makes, and the same one `ledger_entries.reference` makes about a
 * replayed webhook. That is what makes the sweep safe to run twice in a day, to
 * force-run from the operator control, and to retry after a partial failure: it
 * cannot chase the same customer twice for the same rung.
 *
 * `outcome` is the other half. A row written by a workspace in `notify` mode is
 * `pending` — the rung is DUE and nothing has left the building — and becomes
 * `sent` when a person (or an `auto` workspace's sweep) actually sends it. So a
 * pending row is a worklist item rather than a lie, and turning the ladder up to
 * `auto` later does not skip the rungs it recorded while it was quiet.
 */
export const collectionActions = pgTable('collection_actions', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  /** `invoices.reference` — the same natural key the lines resolve to. */
  invoiceRef: varchar('invoice_ref', { length: 64 }).notNull(),
  /** Which rung: the index into the declared ladder. Stored rather than derived
   *  because it is what the unique index keys on, which is the point. */
  step:       integer('step').notNull(),
  /** A label for the rung, denormalised so a ladder that is later re-tuned does
   *  not rewrite the history of what was actually sent. */
  stepLabel:  varchar('step_label', { length: 64 }).notNull().default(''),
  /** 'email' — reaches the customer. 'internal' — a worklist entry for us. */
  channel:    varchar('channel', { length: 16 }).notNull().default('email'),
  /** 'pending' | 'sent' | 'failed' | 'skipped'. */
  outcome:    varchar('outcome', { length: 16 }).notNull().default('pending'),
  detail:     text('detail'),
  /** Who did it — a user id, or 'system' when the sweep climbed the rung. */
  actorRef:   varchar('actor_ref', { length: 64 }).notNull().default('system'),
  actedAt:    timestamp('acted_at').notNull().defaultNow(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_collection_actions_step').on(t.tenantId, t.invoiceRef, t.step),
  index('idx_collection_actions_invoice').on(t.tenantId, t.invoiceRef, t.step),
  index('idx_collection_actions_outcome').on(t.tenantId, t.outcome, t.actedAt),
]);

/**
 * A pay run that HAPPENED, read back from the payroll provider that ran it.
 *
 * ── WHY THIS IS A READ AND NOT AN ENGINE ────────────────────────────────────
 * `connectors/defaults/payroll.ts` argues at length that this platform must
 * never calculate payroll: a mistaken push is somebody's salary, and the tax
 * tables are a full-time job in every jurisdiction. Nothing here calculates
 * anything. Every column is a figure a provider returned, or a total of the
 * lines it returned, and `source` names which provider said so — so the largest
 * line on a forecast is money that actually left rather than a number somebody
 * typed.
 *
 * `(tenant, source, external_ref)` is UNIQUE, which is what makes re-hydration
 * idempotent: syncing the same period twice updates one row rather than
 * doubling the burn.
 *
 * NO per-employee table. A pay-run line is a description, a quantity, a rate and
 * an amount, which is `invoice_line_items` exactly — the file's own argument for
 * why one line table serves both directions applies a third time, and a
 * `pay_run_line_items` copy is the per-feature duplicate §0 forbids. The
 * discriminator is `document_kind = 'pay_run'`.
 */
export const payRuns = pgTable('pay_runs', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** The connector manifest key that produced it: 'gusto' | 'rippling' | … —
   *  or 'manual' for a run entered by hand from a bureau's PDF, which is the
   *  honest state of most small companies outside the US. */
  source:        varchar('source', { length: 48 }).notNull(),
  /** The provider's own id for the run. The natural key the lines resolve to and
   *  the half of the uniqueness that makes a re-sync an update. */
  externalRef:   varchar('external_ref', { length: 96 }).notNull(),
  /** Our own reference — what `invoice_line_items.invoice_ref` carries. Derived
   *  from `source` and `externalRef` and stored, because the lines join on it. */
  reference:     varchar('reference', { length: 64 }).notNull(),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'processed' | 'open' | 'cancelled' — the provider's own state. Only a
   *  processed run is money that left, so only a processed run reaches burn. */
  status:        varchar('status', { length: 16 }).notNull().default('processed'),
  periodStart:   timestamp('period_start'),
  periodEnd:     timestamp('period_end'),
  /** The date the money left. What the burn month is keyed on — NOT the period,
   *  because a period that straddles a month boundary would otherwise land its
   *  cost in the wrong one. */
  paidAt:        timestamp('paid_at'),
  /** Gross pay, employer taxes, and the two added together. All three stored
   *  because all three are figures the provider RETURNED — deriving the total
   *  would silently drop anything a provider bills that is neither (benefits,
   *  the provider's own fee), and the total is the one that is burn. */
  grossAmount:   numeric('gross_amount', { precision: 16, scale: 2 }),
  employerTaxes: numeric('employer_taxes', { precision: 16, scale: 2 }),
  totalCost:     numeric('total_cost', { precision: 16, scale: 2 }).notNull(),
  employeeCount: integer('employee_count').notNull().default(0),
  /** When this row was last read back from the provider. A pay run whose sync is
   *  a month old is still a fact; saying WHEN it was read is what stops it being
   *  mistaken for a live one. */
  syncedAt:      timestamp('synced_at').notNull().defaultNow(),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_pay_runs_external').on(t.tenantId, t.source, t.externalRef),
  uniqueIndex('uq_pay_runs_reference').on(t.tenantId, t.reference),
  index('idx_pay_runs_paid').on(t.tenantId, t.status, t.paidAt),
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
  /** 'pre-seed' | 'seed' | 'series-a' | 'bridge' | 'safe'. */
  roundType:    varchar('round_type', { length: 24 }),
  /** What the round is RAISING. There is deliberately NO `amount_raised` beside
   *  it: money closed is derived from the `deals` allocations on this round
   *  (`pipelineFamilies` family `raise`), and a stored total the rows can
   *  contradict is what migration 0464 forbids. Dropped in 0937. */
  targetAmount: numeric('target_amount', { precision: 18, scale: 2 }),
  closeTargetAt: timestamp('close_target_at'),
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

// ---------------------------------------------------------------------------
// Ownership — the cap table is a PROJECTION, not a table (migration 0927)
// ---------------------------------------------------------------------------
//
// `grep cap_table` returns nothing here on purpose. A cap table is a fold of
// `equityEvents` as of an instant, computed by `application/finance/equity.ts`,
// so every total on it is arithmetic over rows a reader can see rather than a
// number somebody typed — the "no stored totals" rule migration 0464 states for
// `work_estimates.lines`, applied to the one place where a total that disagrees
// with its own rows is a legal problem rather than a display bug.
//
// A HOLDER IS NOT A ROW HERE EITHER. `party_roles` already carries exactly one
// row per (tenant, party kind, party ref, role) and 0469 added `equity_holder`
// to that vocabulary for this. `holderRef` is that `party_ref` — the same ref an
// `account` card joins by.

/** A class of stock a company has AUTHORISED. */
export const shareClasses = pgTable('share_classes', {
  id:                  serial('id').primaryKey(),
  tenantId:            integer('tenant_id').notNull(),
  objectId:            uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** Same grain `funding_rounds.companyRef` uses, so a round and the classes it
   *  prices resolve to one company with no join table. */
  companyRef:          varchar('company_ref', { length: 64 }),
  /** The stable reference grants and events point at, normalised by `partyRef()`
   *  — so "Series A" and "series a" cannot become two classes. */
  classRef:            varchar('class_ref', { length: 64 }).notNull(),
  name:                varchar('name', { length: 96 }).notNull(),
  /** 'common' | 'preferred' | 'option-pool'. A pool is a CLASS because it has its
   *  own authorised count and its own grants; a boolean on common cannot express
   *  "what is unallocated". */
  kind:                varchar('kind', { length: 16 }).notNull().default('common'),
  /** The one legitimately stored quantity in this group: a board resolution, not
   *  a sum over anything. Issued and unallocated are computed against it. */
  authorized:          numeric('authorized', { precision: 20, scale: 4 }).notNull().default('0'),
  parValue:            numeric('par_value', { precision: 18, scale: 8 }),
  pricePerShare:       numeric('price_per_share', { precision: 18, scale: 8 }),
  currency:            varchar('currency', { length: 8 }).notNull().default('USD'),
  /** Nullable rather than defaulted: a 0 preference and NO preference are
   *  different claims, and a default would assert the first about every common. */
  liquidationMultiple: numeric('liquidation_multiple', { precision: 8, scale: 4 }),
  participating:       boolean('participating').notNull().default(false),
  /** Lower is more senior — who is paid first in a waterfall. */
  seniority:           integer('seniority').notNull().default(0),
  conversionRatio:     numeric('conversion_ratio', { precision: 12, scale: 6 }).notNull().default('1'),
  votesPerShare:       numeric('votes_per_share', { precision: 12, scale: 6 }).notNull().default('1'),
  fundingRoundId:      integer('funding_round_id').references(() => fundingRounds.id, { onDelete: 'set null' }),
  authorizedAt:        timestamp('authorized_at'),
  notes:               text('notes'),
  createdAt:           timestamp('created_at').notNull().defaultNow(),
  updatedAt:           timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_share_classes_ref').on(t.tenantId, t.companyRef, t.classRef),
  index('idx_share_classes_company').on(t.tenantId, t.companyRef, t.seniority),
]);

/**
 * An award's TERMS — and deliberately no quantity.
 *
 * How many shares were granted is the issuance EVENT. A count here would be a
 * stored total the ledger beneath it contradicts the moment anything is
 * cancelled, transferred or exercised.
 *
 * `holderName` sits beside `holderRef` for the same reason `invoices.customerName`
 * sits beside `customerRef`: a certificate records what was issued to WHOM, and
 * that name must not change because somebody later renamed the party.
 *
 * Every vesting column is a TERM. Vested-to-date is computed by `vestedQuantity()`
 * in the canvas contract — the SAME function the card calls — and stored nowhere.
 */
export const equityGrants = pgTable('equity_grants', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull(),
  objectId:         uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  companyRef:       varchar('company_ref', { length: 64 }),
  shareClassId:     integer('share_class_id').notNull().references(() => shareClasses.id, { onDelete: 'restrict' }),
  /** `party_roles.party_ref` under the `equity_holder` role. */
  holderRef:        varchar('holder_ref', { length: 64 }).notNull(),
  holderName:       varchar('holder_name', { length: 200 }).notNull(),
  /** 'common' | 'preferred' | 'option' | 'rsu' | 'warrant'. An option is not a
   *  share until exercised, which the projection reports separately. */
  instrument:       varchar('instrument', { length: 16 }).notNull().default('common'),
  /** Our own certificate / grant number — the natural key a person quotes. */
  reference:        varchar('reference', { length: 64 }).notNull(),
  grantedAt:        timestamp('granted_at').notNull().defaultNow(),
  pricePerShare:    numeric('price_per_share', { precision: 18, scale: 8 }),
  /** The 409A fair market value it was priced against, where there was one. */
  fmvPerShare:      numeric('fmv_per_share', { precision: 18, scale: 8 }),
  currency:         varchar('currency', { length: 8 }).notNull().default('USD'),
  vestingStartAt:   timestamp('vesting_start_at'),
  vestingMonths:    integer('vesting_months'),
  cliffMonths:      integer('cliff_months'),
  /** 'none' | 'monthly' | 'quarterly' | 'annual'. `none` is fully vested stock. */
  vestingFrequency: varchar('vesting_frequency', { length: 16 }).notNull().default('none'),
  /** 'none' | 'single-trigger' | 'double-trigger'. */
  acceleration:     varchar('acceleration', { length: 16 }).notNull().default('none'),
  fundingRoundId:   integer('funding_round_id').references(() => fundingRounds.id, { onDelete: 'set null' }),
  notes:            text('notes'),
  createdBy:        varchar('created_by', { length: 64 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_equity_grants_reference').on(t.tenantId, t.companyRef, t.reference),
  index('idx_equity_grants_holder').on(t.tenantId, t.holderRef),
  index('idx_equity_grants_class').on(t.tenantId, t.shareClassId),
]);

/**
 * A SAFE or a convertible note — money that is not yet equity.
 *
 * Two kinds and not one: a note is DEBT that accrues and matures, a SAFE is
 * neither, and one value would make "what is due when" unanswerable for the
 * instrument that has an answer.
 *
 * `postMoney` is decisive. On a post-money SAFE the holder's percentage is fixed
 * and the FOUNDERS absorb every other SAFE's dilution; on a pre-money one the
 * SAFEs dilute each other. Founders discover the difference at the priced round,
 * which is exactly too late — so the modeller reads it off this column.
 */
export const convertibleInstruments = pgTable('convertible_instruments', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  objectId:        uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  companyRef:      varchar('company_ref', { length: 64 }),
  reference:       varchar('reference', { length: 64 }).notNull(),
  /** 'safe' | 'note'. */
  kind:            varchar('kind', { length: 16 }).notNull().default('safe'),
  holderRef:       varchar('holder_ref', { length: 64 }).notNull(),
  holderName:      varchar('holder_name', { length: 200 }).notNull(),
  principal:       numeric('principal', { precision: 18, scale: 2 }).notNull(),
  currency:        varchar('currency', { length: 8 }).notNull().default('USD'),
  valuationCap:    numeric('valuation_cap', { precision: 18, scale: 2 }),
  discountPercent: numeric('discount_percent', { precision: 6, scale: 3 }),
  postMoney:       boolean('post_money').notNull().default(true),
  /** Most-favoured-nation: this holder takes the best terms any later instrument
   *  gets. Agreed in conversation and, until now, recorded nowhere. */
  mfn:             boolean('mfn').notNull().default(false),
  /** Simple annual interest, for a note. Null on a SAFE, which does not accrue. */
  interestRate:    numeric('interest_rate', { precision: 6, scale: 4 }),
  issuedAt:        timestamp('issued_at').notNull().defaultNow(),
  maturesAt:       timestamp('matures_at'),
  /** 'outstanding' | 'converted' | 'repaid' | 'cancelled'. A lifecycle state of
   *  the instrument itself — NOT an aggregate, which is why it may be a column
   *  while the shares it converts into may not. */
  status:          varchar('status', { length: 16 }).notNull().default('outstanding'),
  convertedAt:     timestamp('converted_at'),
  fundingRoundId:  integer('funding_round_id').references(() => fundingRounds.id, { onDelete: 'set null' }),
  notes:           text('notes'),
  createdBy:       varchar('created_by', { length: 64 }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_convertible_instruments_reference').on(t.tenantId, t.companyRef, t.reference),
  index('idx_convertible_instruments_status').on(t.tenantId, t.companyRef, t.status),
  index('idx_convertible_instruments_maturity').on(t.tenantId, t.maturesAt),
]);

/**
 * The append-only ownership ledger — the ONLY place a share quantity lives.
 *
 * Seven verbs, each with declared debit and credit legs (`EQUITY_EVENT_LEGS` in
 * the canvas contract), folded by `application/finance/equity.ts`. A pool top-up,
 * a round, a departure and a buy-back were all re-typing before this table
 * existed, which is why a cap table could not survive its second event.
 *
 * APPEND-ONLY IS ENFORCED BY WHO MAY WRITE IT: the entity is registered
 * read-only, so a generic PATCH cannot reach it, and the one writer only ever
 * INSERTs. Same argument as `bills.approvedBy`, on a table where a silent edit
 * rewrites who owns the company.
 *
 * `effectiveAt` is separate from `createdAt` deliberately — the date something
 * took effect is what the fold cuts on, and a genuine March issuance recorded in
 * May is normal. Conflating them makes "what did we own in March" answer with
 * what had been TYPED by March.
 */
export const equityEvents = pgTable('equity_events', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull(),
  companyRef:       varchar('company_ref', { length: 64 }),
  /** 'issue' | 'transfer' | 'cancel' | 'exercise' | 'repurchase' |
   *  'pool-increase' | 'conversion'. */
  eventKind:        varchar('event_kind', { length: 24 }).notNull(),
  /** The class the quantity LEAVES, or the sole class for a one-legged event. */
  shareClassId:     integer('share_class_id').references(() => shareClasses.id, { onDelete: 'restrict' }),
  /** The class it ARRIVES in when that differs — an exercise moves options out of
   *  the pool and common in, which is one event rather than two that can be
   *  half-recorded. */
  toShareClassId:   integer('to_share_class_id').references(() => shareClasses.id, { onDelete: 'restrict' }),
  grantId:          integer('grant_id').references(() => equityGrants.id, { onDelete: 'restrict' }),
  instrumentId:     integer('instrument_id').references(() => convertibleInstruments.id, { onDelete: 'restrict' }),
  fundingRoundId:   integer('funding_round_id').references(() => fundingRounds.id, { onDelete: 'set null' }),
  fromHolderRef:    varchar('from_holder_ref', { length: 64 }),
  toHolderRef:      varchar('to_holder_ref', { length: 64 }),
  quantity:         numeric('quantity', { precision: 20, scale: 4 }).notNull(),
  pricePerShare:    numeric('price_per_share', { precision: 18, scale: 8 }),
  currency:         varchar('currency', { length: 8 }).notNull().default('USD'),
  effectiveAt:      timestamp('effective_at').notNull().defaultNow(),
  /** Why it happened, in the words of whoever recorded it. The ledger is read by
   *  people, and "a departure" and "a secondary sale" are the same numbers. */
  reason:           text('reason'),
  recordedBy:       varchar('recorded_by', { length: 64 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_equity_events_company').on(t.tenantId, t.companyRef, t.effectiveAt),
  index('idx_equity_events_grant').on(t.tenantId, t.grantId),
  index('idx_equity_events_instrument').on(t.tenantId, t.instrumentId),
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

/**
 * ONE account inside a connected book, with the balance it last reported.
 *
 * ── WHY THIS IS THE ONLY NEW TABLE THE LEDGER PORT NEEDED ───────────────────
 * The synced TRANSACTIONS do not get one. A money movement read out of
 * QuickBooks, Xero, NetSuite, Plaid or Stripe is a `ledger_entries` row with
 * `account_kind = 'external'` — the kernel ledger is exactly the shape (a signed
 * amount, a denomination, an occurrence date and a unique `reference` that makes
 * a re-sync idempotent), and PRD 20 §0 is explicit that needing a balance earns a
 * denomination rather than a table. A `ledger_transactions` table would have been
 * the 60th balance table the consolidation exists to prevent.
 *
 * A BALANCE is genuinely a different noun, and the difference is not stylistic.
 * `ledger_entries` is append-only and models money MOVING; this row is STATE — the
 * bank's own answer to "how much is in there right now", which is not derivable
 * from the movements we have seen because the sync did not witness the opening
 * balance. That is also why it matters: `finance.runway_months` is cash ÷ net burn,
 * and without this the cash half would be the net flow since the day somebody
 * connected the account, which is not a cash position at all.
 *
 * `accountKind` is stored rather than inferred because the three kinds NET
 * differently: a `bank` balance is money held, a `credit` balance is money owed and
 * the adapters negate it before it gets here, and `other` never counts toward cash.
 *
 * The natural key is (tenant, connection, external account) — one row per account
 * per connection, UPDATED in place on every sync. A history of balances would be an
 * event table, which is the shape `ledger_entries` already is.
 */
export const ledgerAccounts = pgTable('ledger_accounts', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  /** The `connections` row (capability `ledger`) this account was read through. */
  connectionId: integer('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
  /** 'quickbooks' | 'xero' | 'netsuite' | 'plaid' | 'stripe-revenue'. Denormalised
   *  from the connection so the rollup never has to join to know the source. */
  provider:     varchar('provider', { length: 24 }).notNull(),
  /** The provider's own account id. Stable, so a re-sync updates rather than
   *  duplicating — the same guarantee the transaction side gets from `reference`. */
  externalId:   varchar('external_id', { length: 200 }).notNull(),
  name:         varchar('name', { length: 300 }).notNull().default(''),
  /** 'bank' | 'credit' | 'other'. See the note above on why it is stored. */
  accountKind:  varchar('account_kind', { length: 16 }).notNull().default('other'),
  /** Signed, in the account's own currency. A credit card arrives NEGATIVE. */
  balance:      numeric('balance', { precision: 20, scale: 2 }).notNull().default('0'),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  /** When the PROVIDER says the balance was true — not when we stored it. */
  asOfAt:       timestamp('as_of_at').notNull().defaultNow(),
  syncedAt:     timestamp('synced_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ledger_accounts_external').on(t.tenantId, t.connectionId, t.externalId),
  index('idx_ledger_accounts_tenant').on(t.tenantId, t.accountKind),
]);


// ---------------------------------------------------------------------------
// Moved here from `platform.ts` (PRD 20 §3). `webhook_deliveries` is the child of
// `webhook_subscriptions` above and cascades with it; the two were one aggregate
// declared in two modules, which is what made Platform import Finance.
// ---------------------------------------------------------------------------

/**
 * Per-delivery audit row. `id` doubles as the replay nonce in the signature.
 *
 * REPLAY SAFETY IS THE UNIQUE INDEX (migration 1100), not a check in the emitter.
 * `uq_webhook_delivery_event` on (subscription, event_type, event_id) is what stops
 * an at-least-once emitter meeting a retrying caller from POSTing the same board
 * event twice — the emit path inserts with `onConflictDoNothing` and treats "no row
 * came back" as "already enqueued". A read-then-write check loses the race that
 * matters: two concurrent retries both read "not seen", both pass, and both send.
 */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id').notNull().references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Narrowing context, not the scope — nullable since 1100, for the same reason
   *  the subscription's is: a canvas board's segment is optional. */
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  eventType:      varchar('event_type', { length: 64 }).notNull(),
  eventId:        varchar('event_id', { length: 255 }).notNull(),
  status:         varchar('status', { length: 16 }).notNull().default('pending'), // pending|delivered|failed
  responseStatus: integer('response_status'),
  attempts:       integer('attempts').notNull().default(0),
  payload:        text('payload'),          // exact signed POST body, for faithful redelivery
  nextRetryAt:    timestamp('next_retry_at'), // when next retry-eligible; NULL = terminal (delivered or exhausted)
  lastError:      text('last_error'),       // most recent failure reason (truncated)
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  deliveredAt:    timestamp('delivered_at'),
}, (t) => ({
  /** THE replay guard. See the header — this index is the arbiter, not a report. */
  oneDeliveryPerEvent: uniqueIndex('uq_webhook_delivery_event').on(t.subscriptionId, t.eventType, t.eventId),
  /** The log a tenant reads back through `/api/v1/webhooks/:id/deliveries`. */
  byTenantCreated: index('idx_webhook_deliveries_tenant_created').on(t.tenantId, t.createdAt),
}));
