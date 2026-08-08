/**
 * Schema — Investor & portfolio, owned by the **CEO** (PRD 20 §3).
 *
 * Root entity `company`. 54 source tables in → 14 out: 21 absorbed by the
 * kernel, 7 by the canvas, 10 merged into a sibling. BurnRateOS contributed 10
 * of the 14 — it owns this domain the way hired.video owns hiring.
 *
 * SEVEN ABSORBED BY THE CANVAS, WHICH IS THE POINT OF §2.1. A pitch deck, a
 * data-room folder, a validation dashboard and a scratch pad are all authored
 * content that people can be present in and that can be shared. That is the
 * canvas; none of them earn a container table. What survives here is what the
 * canvas is NOT: the diligence obligation, the funding instrument, the
 * comparable, the scenario.
 *
 * `forecast_scenarios`, `what_if_scenarios` and `validation_scenarios` collapsed
 * into one `scenario` with a kind (§3.3) — assumptions in, projected numbers
 * out — and `break_even_scenarios` survived as the root, in Finance. What is
 * kept here is `mvp_scenarios`, and deliberately: it carries pricing model, team
 * size and timeline constraint, which makes it a business-model variant, not a
 * financial projection. Same word, different noun.
 *
 * NO SIBLING IMPORTS beyond the kernel.
 *
 * See migration 0422.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { objects } from './kernel';

/** A company in the portfolio, or the tenant's own. The root entity. */
export const companies = pgTable('companies', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  slug:        varchar('slug', { length: 200 }),
  website:     varchar('website', { length: 255 }),
  /** References the global `stage_lookup` vocabulary, not a per-tenant enum. */
  stage:       varchar('stage', { length: 48 }),
  sector:      varchar('sector', { length: 120 }),
  country:     varchar('country', { length: 2 }),
  foundedAt:   timestamp('founded_at'),
  headcount:   integer('headcount'),
  /** The CRM facet. `company_crm` was a 1:1 facet table split by which screen
   *  read it — the flattening move from §3.1 — so it is columns here. */
  crmOwnerRef: varchar('crm_owner_ref', { length: 64 }),
  crmStatus:   varchar('crm_status', { length: 32 }),
  crmLastTouchedAt: timestamp('crm_last_touched_at'),
  arr:         numeric('arr', { precision: 16, scale: 2 }),
  valuation:   numeric('valuation', { precision: 18, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  isPortfolio: boolean('is_portfolio').notNull().default(false),
  attrs:       jsonb('attrs'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_companies_name').on(t.tenantId, t.name),
  index('idx_companies_portfolio').on(t.tenantId, t.isPortfolio, t.stage),
]);

/** A product a company sells. */
export const products = pgTable('products', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  companyId:  integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 255 }).notNull(),
  summary:    text('summary'),
  /** 'concept' | 'alpha' | 'beta' | 'ga' | 'sunset'. */
  stage:      varchar('stage', { length: 24 }).notNull().default('concept'),
  launchedAt: timestamp('launched_at'),
  attrs:      jsonb('attrs'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_products_name').on(t.tenantId, t.companyId, t.name),
]);

/** An idea for a product, before it is one. Scored ideas that reach a backlog
 *  become kernel `work_items` of kind `feature` — `features` collapsed there
 *  (§3.3) because `reach`/`impact`/`confidence`/`effort`/`rice_score` describe a
 *  work item, not a separate noun. This is the stage before that. */
export const productIdeas = pgTable('product_ideas', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  productId:  integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  title:      varchar('title', { length: 300 }).notNull(),
  body:       text('body'),
  problem:    text('problem'),
  hypothesis: text('hypothesis'),
  /** 'captured' | 'exploring' | 'validated' | 'promoted' | 'parked'. */
  status:     varchar('status', { length: 16 }).notNull().default('captured'),
  /** Set when the idea became a `work_items` row of kind `feature`. */
  promotedWorkItemRef: varchar('promoted_work_item_ref', { length: 64 }),
  authorRef:  varchar('author_ref', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_product_ideas_status').on(t.tenantId, t.status, t.updatedAt),
]);

/** A data room. The DOCUMENTS in it are `artifacts`, its members are
 *  `memberships`, its external access is a `share_link` — this row is the room's
 *  identity and its disclosure policy, which is the part that is not the canvas. */
export const dataRooms = pgTable('data_rooms', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  companyId:   integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  purpose:     varchar('purpose', { length: 64 }),
  /** 'open' | 'restricted' | 'closed'. */
  status:      varchar('status', { length: 16 }).notNull().default('restricted'),
  ndaRequired: boolean('nda_required').notNull().default(true),
  watermark:   boolean('watermark').notNull().default(true),
  expiresAt:   timestamp('expires_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_data_rooms_name').on(t.tenantId, t.companyId, t.name),
]);

/** A diligence checklist. */
export const dueDiligenceChecklists = pgTable('due_diligence_checklists', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  companyId:  integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  dataRoomId: integer('data_room_id').references(() => dataRooms.id, { onDelete: 'set null' }),
  name:       varchar('name', { length: 255 }).notNull(),
  /** 'financial' | 'legal' | 'technical' | 'commercial' | 'people'. */
  category:   varchar('category', { length: 32 }).notNull().default('financial'),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  dueAt:      timestamp('due_at'),
  completedAt: timestamp('completed_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_due_diligence_checklists_company').on(t.tenantId, t.companyId, t.category),
]);

/** A document a checklist REQUIRES — the obligation, not the file. The file is
 *  an `artifacts` row; deleting it must not delete the requirement, which is the
 *  same two-nouns test `placement_documents` passes in Hiring. */
export const dueDiligenceDocuments = pgTable('due_diligence_documents', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  checklistId: integer('checklist_id').references(() => dueDiligenceChecklists.id, { onDelete: 'cascade' }),
  label:       varchar('label', { length: 255 }).notNull(),
  artifactId:  uuid('artifact_id'),
  /** 'requested' | 'provided' | 'accepted' | 'rejected' | 'waived'. */
  status:      varchar('status', { length: 16 }).notNull().default('requested'),
  required:    boolean('required').notNull().default(true),
  reviewerRef: varchar('reviewer_ref', { length: 64 }),
  reviewedAt:  timestamp('reviewed_at'),
  note:        text('note'),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_due_diligence_documents_checklist').on(t.checklistId, t.position),
]);

/** An investment being considered. */
export const investmentOpportunities = pgTable('investment_opportunities', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  companyId:   integer('company_id').references(() => companies.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  round:       varchar('round', { length: 48 }),
  askAmount:   numeric('ask_amount', { precision: 18, scale: 2 }),
  preMoney:    numeric('pre_money', { precision: 18, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'sourced' | 'screening' | 'diligence' | 'ic' | 'committed' | 'passed'. */
  status:      varchar('status', { length: 16 }).notNull().default('sourced'),
  leadRef:     varchar('lead_ref', { length: 64 }),
  conviction:  numeric('conviction', { precision: 5, scale: 2 }),
  passReason:  text('pass_reason'),
  decidedAt:   timestamp('decided_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_investment_opportunities_status').on(t.tenantId, t.status, t.updatedAt),
]);

/** A comparable used to price a company. */
export const investorPeerComparables = pgTable('investor_peer_comparables', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  companyId:  integer('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  peerName:   varchar('peer_name', { length: 255 }).notNull(),
  sector:     varchar('sector', { length: 120 }),
  revenue:    numeric('revenue', { precision: 18, scale: 2 }),
  growthRate: numeric('growth_rate', { precision: 6, scale: 2 }),
  multiple:   numeric('multiple', { precision: 8, scale: 2 }),
  valuation:  numeric('valuation', { precision: 18, scale: 2 }),
  currency:   varchar('currency', { length: 8 }).notNull().default('USD'),
  source:     varchar('source', { length: 96 }),
  asOf:       timestamp('as_of'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_investor_peer_comparables_company').on(t.tenantId, t.companyId, t.asOf),
]);

/** A validation dashboard's DEFINITION — which metrics, which thresholds, which
 *  audience. The rendered dashboard is the canvas; the numbers are
 *  `metric_facts`. What is left is the definition, and that is a real noun. */
export const validationDashboards = pgTable('validation_dashboards', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  productId:  integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  name:       varchar('name', { length: 255 }).notNull(),
  hypothesis: text('hypothesis'),
  /** Metric keys read from `metric_facts`, with their pass thresholds. */
  metrics:    jsonb('metrics').notNull().default('[]'),
  /** 'running' | 'validated' | 'invalidated' | 'paused'. */
  status:     varchar('status', { length: 16 }).notNull().default('running'),
  startedAt:  timestamp('started_at'),
  concludedAt: timestamp('concluded_at'),
  conclusion: text('conclusion'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_validation_dashboards_name').on(t.tenantId, t.name),
]);

/** One import of external evidence into a validation dashboard. The RUN is a
 *  `runs` row; this is the resulting dataset's provenance, which outlives it. */
export const validationDataImports = pgTable('validation_data_imports', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  dashboardId: integer('dashboard_id').references(() => validationDashboards.id, { onDelete: 'cascade' }),
  source:      varchar('source', { length: 96 }).notNull(),
  artifactId:  uuid('artifact_id'),
  rowCount:    integer('row_count').notNull().default(0),
  mapping:     jsonb('mapping'),
  /** 'pending' | 'imported' | 'failed'. */
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  importedAt:  timestamp('imported_at'),
  lastError:   text('last_error'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_validation_data_imports_dashboard').on(t.dashboardId, t.importedAt),
]);

/** A file pinned to a scratch pad. The pad itself is the canvas (§2.1 — this is
 *  the table whose absence proves the point: `scratch_pad_meetings` existed only
 *  because the pad owned its own meeting, and hoisting presence into the shell
 *  deleted it). What remains is the attachment's placement on the pad. */
export const scratchPadAttachments = pgTable('scratch_pad_attachments', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  /** The pad, as a registered canvas object. */
  padObjectId: uuid('pad_object_id').references(() => objects.id, { onDelete: 'cascade' }),
  artifactId: uuid('artifact_id'),
  label:      varchar('label', { length: 255 }),
  /** Position on the board — a canvas coordinate, not a list index. */
  placement:  jsonb('placement'),
  addedBy:    varchar('added_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_scratch_pad_attachments_pad').on(t.padObjectId),
]);

/**
 * A permission module.
 *
 * One of the three tables the machine kept and should have (§3.3): `modules` is
 * a permission module, `course_modules` is a chapter. Same word, different noun,
 * and collapsing them would have made an entitlement check and a syllabus the
 * same query.
 */
export const modules = pgTable('modules', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  key:         varchar('key', { length: 64 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  /** The roster domain this module gates, so the fifteen seats and the fifteen
   *  permission modules cannot drift (PRD 20 §7). */
  domain:      varchar('domain', { length: 32 }),
  /** The rung at which this module lights up. Progressive disclosure gates
   *  STATE, never capability — a dimmed module is an invitation. */
  requiredRung: integer('required_rung').notNull().default(0),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_modules_key').on(t.tenantId, t.key),
]);
