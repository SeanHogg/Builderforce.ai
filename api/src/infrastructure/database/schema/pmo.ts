/**
 * Schema — pmo context.
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
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { budgets } from './billing';
import { teams } from './collaboration';
import { segments, tenants, users } from './identity';
import { projects, tasks } from './work';


// ── PMO tier (0213): Portfolio / Initiative / OKR above the project tier ──────
// The rollup objects the collector substrate was missing. uuid PKs + tenant/
// segment scope match the planning trackers, so the generic segment-tracker CRUD
// (segmentTrackerRoutes) drives their management with no bespoke router; the live
// rollup (pmoRoutes/portfolioRollup) aggregates cost/DORA/outcomes/delivery over
// the projects linked under each tier.
export const portfolios = pgTable('portfolios', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status:      varchar('status', { length: 20 }).notNull().default('active'), // active | archived
  ownerUserId: varchar('owner_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  targetDate:  timestamp('target_date'),
  costClass:       varchar('cost_class', { length: 8 }), // capex | opex | null — top of the inheritance chain (0225)
  costClassSource: varchar('cost_class_source', { length: 12 }).notNull().default('manual'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


export const initiatives = pgTable('initiatives', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status:      varchar('status', { length: 20 }).notNull().default('proposed'), // proposed | active | completed | archived
  ownerUserId: varchar('owner_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** Timeline bounds for the unified Gantt (0225). targetDate stays as the end
   *  anchor for back-compat; startDate is the new lower bound. */
  startDate:   timestamp('start_date'),
  targetDate:  timestamp('target_date'),
  costClass:       varchar('cost_class', { length: 8 }), // capex | opex | null (0225)
  costClassSource: varchar('cost_class_source', { length: 12 }).notNull().default('manual'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


export const objectives = pgTable('objectives', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  portfolioId:  uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'set null' }),
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  /** Direct PROJECT scope (0268) — a fourth scope axis alongside portfolio/initiative.
   *  An objective created "for a project" (the Brain's `objectives.create` with a
   *  projectId, the OKR tab's project scope) lives here; the Project 360 counts these
   *  as the project's linked goals (its Direction dimension) without needing a task or
   *  initiative link. Null = an org/portfolio/initiative-level objective. */
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title:        varchar('title', { length: 255 }).notNull(),
  description:  text('description'),
  period:       varchar('period', { length: 20 }), // e.g. '2026-Q2' — DERIVED from startDate (0225); kept for reporting/grouping
  /** Real timeline span for the unified Gantt (0225). An objective can run a
   *  quarter, several quarters, a year or more — these bounds drive its bar. */
  startDate:    timestamp('start_date'),
  endDate:      timestamp('end_date'),
  status:       varchar('status', { length: 20 }).notNull().default('active'), // active | achieved | missed | archived
  ownerUserId:  varchar('owner_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** CAPEX/OPEX for the whole goal (0225). Set here → the entire linked lineage
   *  inherits it unless a child manually overrides (which raises an anomaly). */
  costClass:       varchar('cost_class', { length: 8 }), // capex | opex | null
  costClassSource: varchar('cost_class_source', { length: 12 }).notNull().default('manual'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Objective ↔ work-item lineage (0225). An objective owns ANY mix of initiatives,
 * epics, or tasks — exactly one of initiativeId / taskId is set per row, keyed by
 * linkKind. This is the edge that makes "an OKR can have multiple Epics or a task"
 * real and lets cost/progress roll up from leaf work into the goal.
 */
export const objectiveLinks = pgTable('objective_links', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  objectiveId:  uuid('objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  linkKind:     varchar('link_kind', { length: 12 }).notNull(), // 'initiative' | 'epic' | 'task'
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'cascade' }),
  taskId:       integer('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});


export const keyResults = pgTable('key_results', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  objectiveId:  uuid('objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  title:        varchar('title', { length: 255 }).notNull(),
  metricType:   varchar('metric_type', { length: 20 }).notNull().default('number'), // number | percent | currency | boolean
  startValue:   real('start_value').notNull().default(0),
  targetValue:  real('target_value').notNull().default(100),
  currentValue: real('current_value').notNull().default(0),
  unit:         varchar('unit', { length: 20 }),
  status:       varchar('status', { length: 20 }).notNull().default('on_track'), // on_track | at_risk | off_track | done
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});


// Initiative dependency edges (0216): from_initiative BLOCKS to_initiative. The
// rollup uses these to flag blocked initiatives + compute the critical path
// (longest incomplete chain); the route rejects self-loops and cycle-closing edges.
export const pmoDependencies = pgTable('pmo_dependencies', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fromInitiativeId: uuid('from_initiative_id').notNull().references(() => initiatives.id, { onDelete: 'cascade' }),
  toInitiativeId:   uuid('to_initiative_id').notNull().references(() => initiatives.id, { onDelete: 'cascade' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});


export const capacityPlanning = pgTable('capacity_planning', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  planningPeriod:    varchar('planning_period', { length: 120 }).notNull(),
  teamId:            varchar('team_id', { length: 64 }),
  totalCapacity:     real('total_capacity'),
  allocatedCapacity: real('allocated_capacity'),
  availableCapacity: real('available_capacity'),
  utilizationRate:   real('utilization_rate'),
  teamSize:          integer('team_size'),
  notes:             text('notes'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Desired investment mix per scope per month (migration 0226) — the goal half of
 * the allocation lens (EMP-2). One row per (scope, period, category) sets the
 * target share of effort (e.g. 30% innovation); the allocation rollup compares it
 * to the measured actual and surfaces the variance. tenant+segment scoped like the
 * other planning trackers, so segmentTrackerRoutes drives its CRUD.
 */
export const allocationGoals = pgTable('allocation_goals', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scopeKind:   varchar('scope_kind', { length: 16 }).notNull().default('tenant'), // tenant | team | project
  teamId:      integer('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  periodMonth: varchar('period_month', { length: 7 }).notNull(),                   // 'YYYY-MM'
  category:    varchar('category', { length: 16 }).notNull(),                      // innovation | ktlo | support | tech_debt | other
  targetPct:   real('target_pct').notNull().default(0),                            // desired share of effort (0..100)
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


// ── PEOPLE (migration 0237) ─────────────────────────────────────────────────

/** Append-only headcount event — drives the Headcount Waterfall + Attrition Rate
 *  on the People slide. `isVoluntary` (leave only) splits voluntary vs involuntary
 *  attrition. memberKind reuses the human/agent axis. */
export const headcountEvents = pgTable('headcount_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind:  varchar('member_kind', { length: 16 }).notNull().default('human'), // human | cloud_agent | host_agent
  memberRef:   varchar('member_ref', { length: 255 }),
  memberName:  varchar('member_name', { length: 255 }),
  eventType:   varchar('event_type', { length: 16 }).notNull(),                    // hire | leave | transfer
  teamId:      integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  effectiveOn: date('effective_on').notNull(),
  isVoluntary: boolean('is_voluntary'),                                            // leave only
  reason:      text('reason'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEffective: index('idx_headcount_events_effective').on(t.tenantId, t.effectiveOn),
}));


/** An open requisition — High Priority Open Positions on the People slide.
 *  days_open = today − openedOn (derived in the rollup). */
export const openPositions = pgTable('open_positions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  reqTitle:      varchar('req_title', { length: 255 }).notNull(),
  teamId:        integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  priority:      varchar('priority', { length: 16 }).notNull().default('normal'), // high | normal | low
  status:        varchar('status', { length: 16 }).notNull().default('open'),     // open | filled | on_hold | cancelled
  openedOn:      date('opened_on').notNull().defaultNow(),
  targetStartOn: date('target_start_on'),
  filledOn:      date('filled_on'),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byStatus: index('idx_open_positions_status').on(t.tenantId, t.status, t.priority),
}));


/** AI program investment linked to the PMO initiative tier — AI Program Investment
 *  (Objective → Summary) on the AI slide. investedUsd reconciles against budgets
 *  scoped to the same initiative. */
export const aiProgramInitiatives = pgTable('ai_program_initiatives', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  programName:  varchar('program_name', { length: 255 }).notNull(),
  tier:         varchar('tier', { length: 16 }).notNull().default('strategic'),   // strategic | experiment | enablement
  investedUsd:  real('invested_usd').notNull().default(0),
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  objective:    text('objective'),
  notes:        text('notes'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_ai_program_initiatives_tenant').on(t.tenantId),
  byInitiative: index('idx_ai_program_initiatives_init').on(t.initiativeId),
}));


/** Quarterly R&D FTE allocation by category — Historical Investment Allocation
 *  (R&D FTEs) on the Investment slide. Separate grain from dollars so neither
 *  null-pads the other. */
export const rdFteAllocationQuarterly = pgTable('rd_fte_allocation_quarterly', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fiscalYear: integer('fiscal_year').notNull(),
  quarter:    integer('quarter').notNull(),
  category:   varchar('category', { length: 24 }).notNull(),                       // growth | infrastructure | support | unplanned | other
  fte:        real('fte').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqCat: uniqueIndex('uq_rd_fte_cat').on(t.tenantId, t.fiscalYear, t.quarter, t.category),
}));
