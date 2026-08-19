/**
 * Schema — Revenue & CRM, owned by the **CRO** (PRD 20 §3).
 *
 * Root entity `deal`. 48 source tables in → 24 out: 15 absorbed by the kernel,
 * 6 merged into a sibling.
 *
 * THE COLLAPSES THIS DOMAIN PAID FOR. `business_contacts` and `sales_contacts`
 * were the same table (shared: name, company, email) and are now one `contact`
 * with a kind — expressed here as `party_roles` holding the `contact` role, with
 * the CRM-specific facts hanging off it. `saved_contact_searches` and
 * `saved_searches` were the same table (user_id, name, filters); they are one
 * `saved_searches` with a `scope`. `recruiter_deals` folded in from Hiring
 * (§3.3): both carry `pipeline_id`, a stage, an owner and a fee, and a placement
 * fee is a deal.
 *
 * `communication_tracking` is a MEASUREMENT of outbound, not a second copy of
 * it: the send is a kernel `deliveries` row, this is the CRM's read of whether
 * it landed.
 *
 * NO SIBLING IMPORTS beyond the kernel.
 *
 * See migration 0421.
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

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * A deal. The root entity, and after §3.3 the only one — `recruiter_deals` is a
 * `kind` of it, because a placement fee carries the same pipeline, stage, owner
 * and fee that a sales deal does.
 */
export const deals = pgTable('deals', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'sales' | 'placement' | 'investment' | 'renewal' | 'expansion' | 'partner'.
   *  PRD 20 §3.3: "a sales deal, a recruiter placement fee and an investor allocation
   *  are one shape with three kinds". Which BOARD a kind belongs to is declared once,
   *  in `application/revenue/pipelineFamilies.ts` — `placement` deliberately belongs
   *  to none of them yet. */
  kind:         varchar('kind', { length: 24 }).notNull().default('sales'),
  name:         varchar('name', { length: 300 }).notNull(),
  pipelineRef:  varchar('pipeline_ref', { length: 64 }),
  stage:        varchar('stage', { length: 64 }).notNull().default('new'),
  accountRef:   varchar('account_ref', { length: 64 }),
  primaryContactRef: varchar('primary_contact_ref', { length: 64 }),
  ownerRef:     varchar('owner_ref', { length: 64 }),
  amount:       numeric('amount', { precision: 16, scale: 2 }),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  probability:  numeric('probability', { precision: 5, scale: 2 }),
  expectedCloseAt: timestamp('expected_close_at'),
  closedAt:     timestamp('closed_at'),
  /** 'open' | 'won' | 'lost'. Distinct from `stage`, which every tenant renames. */
  outcome:      varchar('outcome', { length: 12 }).notNull().default('open'),
  lostReason:   varchar('lost_reason', { length: 160 }),
  source:       varchar('source', { length: 64 }),
  attrs:        jsonb('attrs'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_deals_pipeline').on(t.tenantId, t.pipelineRef, t.stage),
  index('idx_deals_owner').on(t.tenantId, t.ownerRef, t.outcome),
  index('idx_deals_close').on(t.tenantId, t.outcome, t.expectedCloseAt),
]);

/** A stage in a pipeline. A lookup with an order and a default probability —
 *  not an enum, because every tenant renames these and reports on the renames. */
export const pipelineStages = pgTable('pipeline_stages', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  pipelineRef: varchar('pipeline_ref', { length: 64 }).notNull(),
  key:         varchar('key', { length: 64 }).notNull(),
  label:       varchar('label', { length: 160 }).notNull(),
  position:    integer('position').notNull().default(0),
  probability: numeric('probability', { precision: 5, scale: 2 }),
  /** 'open' | 'won' | 'lost' — what landing here means for the deal's outcome. */
  outcome:     varchar('outcome', { length: 12 }).notNull().default('open'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_pipeline_stages_key').on(t.tenantId, t.pipelineRef, t.key),
]);

/** A touch on a deal — the CRM's timeline entry, kept separate from
 *  `activity_log` because it is EDITABLE: a rep logs a call after the fact and
 *  corrects it, which an append-only audit stream must never allow. */
export const pipelineTouchpoints = pgTable('pipeline_touchpoints', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  dealId:     integer('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  contactRef: varchar('contact_ref', { length: 64 }),
  /** 'call' | 'email' | 'meeting' | 'demo' | 'note'. */
  channel:    varchar('channel', { length: 24 }).notNull(),
  direction:  varchar('direction', { length: 12 }).notNull().default('outbound'),
  summary:    text('summary'),
  sentiment:  varchar('sentiment', { length: 16 }),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_pipeline_touchpoints_deal').on(t.dealId, t.occurredAt),
]);

/** An inbound opportunity before it is qualified into a deal. */
export const dealFlowOpportunities = pgTable('deal_flow_opportunities', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  source:      varchar('source', { length: 64 }).notNull(),
  companyName: varchar('company_name', { length: 255 }),
  contactEmail: varchar('contact_email', { length: 320 }),
  summary:     text('summary'),
  estimatedValue: numeric('estimated_value', { precision: 16, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  score:       numeric('score', { precision: 5, scale: 2 }),
  /** 'new' | 'qualifying' | 'converted' | 'rejected'. */
  status:      varchar('status', { length: 16 }).notNull().default('new'),
  convertedDealId: integer('converted_deal_id'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_deal_flow_opportunities_status').on(t.tenantId, t.status, t.createdAt),
]);

// ---------------------------------------------------------------------------
// Contacts — one contact, enriched, with provenance
// ---------------------------------------------------------------------------

/** A role a contact has held. `contact_experiences`, `contact_educations` and
 *  `contact_compensations` stay separate tables and not JSON on the contact for
 *  one reason: every one of them is filtered and aggregated independently
 *  ("everyone who worked at X", "median comp for role Y"), which is the exact
 *  test §3.1's thin-table move requires before a list may become an array. */
export const contactExperiences = pgTable('contact_experiences', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  contactRef: varchar('contact_ref', { length: 64 }).notNull(),
  company:    varchar('company', { length: 255 }),
  title:      varchar('title', { length: 200 }),
  startedAt:  timestamp('started_at'),
  endedAt:    timestamp('ended_at'),
  isCurrent:  boolean('is_current').notNull().default(false),
  location:   varchar('location', { length: 160 }),
  summary:    text('summary'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_contact_experiences_contact').on(t.tenantId, t.contactRef, t.isCurrent),
  index('idx_contact_experiences_company').on(t.tenantId, t.company),
]);

/** Where a contact studied. */
export const contactEducations = pgTable('contact_educations', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  contactRef: varchar('contact_ref', { length: 64 }).notNull(),
  institution: varchar('institution', { length: 255 }),
  degree:     varchar('degree', { length: 160 }),
  field:      varchar('field', { length: 160 }),
  startedAt:  timestamp('started_at'),
  endedAt:    timestamp('ended_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_contact_educations_contact').on(t.tenantId, t.contactRef),
]);

/** What a contact was paid, as reported or inferred. */
export const contactCompensations = pgTable('contact_compensations', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  contactRef: varchar('contact_ref', { length: 64 }).notNull(),
  base:       numeric('base', { precision: 14, scale: 2 }),
  bonus:      numeric('bonus', { precision: 14, scale: 2 }),
  equity:     varchar('equity', { length: 96 }),
  currency:   varchar('currency', { length: 8 }).notNull().default('USD'),
  period:     varchar('period', { length: 24 }),
  /** 'self_reported' | 'inferred' | 'verified'. */
  confidence: varchar('confidence', { length: 16 }).notNull().default('inferred'),
  observedAt: timestamp('observed_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_contact_compensations_contact').on(t.tenantId, t.contactRef, t.observedAt),
]);

/**
 * Where each field on a contact came from, and how much to trust it.
 *
 * This is the table that makes enrichment safe: without it, the last provider to
 * write wins and there is no way to tell a verified email from a guessed one.
 */
export const contactFieldProvenance = pgTable('contact_field_provenance', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  contactRef: varchar('contact_ref', { length: 64 }).notNull(),
  field:      varchar('field', { length: 96 }).notNull(),
  value:      text('value'),
  source:     varchar('source', { length: 64 }).notNull(),
  confidence: numeric('confidence', { precision: 5, scale: 2 }),
  observedAt: timestamp('observed_at').notNull().defaultNow(),
  supersededAt: timestamp('superseded_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_contact_field_provenance_field').on(t.tenantId, t.contactRef, t.field, t.observedAt),
]);

/** One paid call to an enrichment provider. The credit spend is a
 *  `ledger_entries` row in the `enrichment_credits` denomination; this is the
 *  call, which is what a cost investigation actually needs. */
export const enrichmentProviderCalls = pgTable('enrichment_provider_calls', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  provider:    varchar('provider', { length: 64 }).notNull(),
  operation:   varchar('operation', { length: 64 }).notNull(),
  subjectRef:  varchar('subject_ref', { length: 64 }),
  requestHash: varchar('request_hash', { length: 64 }),
  /** 'hit' | 'miss' | 'error' | 'cached'. */
  outcome:     varchar('outcome', { length: 16 }).notNull(),
  costCents:   integer('cost_cents').notNull().default(0),
  latencyMs:   integer('latency_ms'),
  fieldsReturned: integer('fields_returned').notNull().default(0),
  error:       text('error'),
  calledAt:    timestamp('called_at').notNull().defaultNow(),
}, (t) => [
  index('idx_enrichment_provider_calls_provider').on(t.tenantId, t.provider, t.calledAt),
  index('idx_enrichment_provider_calls_hash').on(t.requestHash),
]);

/**
 * A saved search.
 *
 * `saved_contact_searches` and `saved_searches` shared `user_id`, `name` and
 * `filters` — the same table under two names (§3.2). One table, one `scope`.
 */
export const savedSearches = pgTable('saved_searches', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  ownerRef:  varchar('owner_ref', { length: 64 }).notNull(),
  /** 'contact' | 'company' | 'deal' | 'candidate' | 'listing'. The column that
   *  replaced the second table. */
  scope:     varchar('scope', { length: 32 }).notNull().default('contact'),
  name:      varchar('name', { length: 200 }).notNull(),
  filters:   jsonb('filters').notNull().default('{}'),
  isShared:  boolean('is_shared').notNull().default(false),
  lastRunAt: timestamp('last_run_at'),
  resultCount: integer('result_count'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_saved_searches_name').on(t.tenantId, t.ownerRef, t.scope, t.name),
]);

/** A saved search kept under its original name because the coverage map keeps
 *  both targets. It is the same shape with `scope = 'contact'` fixed — the
 *  compatibility view for callers written against the hired.video name, and the
 *  row it points at lives in `saved_searches`. */
export const savedContactSearches = pgTable('saved_contact_searches', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  savedSearchId: integer('saved_search_id').references(() => savedSearches.id, { onDelete: 'cascade' }),
  ownerRef:      varchar('owner_ref', { length: 64 }).notNull(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_saved_contact_searches_search').on(t.savedSearchId),
]);

/** A static list of anything, owned by a user. */
export const lists = pgTable('lists', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  objectId:  uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  ownerRef:  varchar('owner_ref', { length: 64 }),
  /** 'contact' | 'company' | 'deal' | 'candidate'. */
  scope:     varchar('scope', { length: 32 }).notNull().default('contact'),
  name:      varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  itemCount: integer('item_count').notNull().default(0),
  isShared:  boolean('is_shared').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_lists_name').on(t.tenantId, t.ownerRef, t.scope, t.name),
]);

// ---------------------------------------------------------------------------
// Revenue intelligence
// ---------------------------------------------------------------------------

/** An ideal customer profile — the definition a prospect is scored against. */
export const riIcps = pgTable('ri_icps', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  criteria:    jsonb('criteria').notNull().default('{}'),
  weightings:  jsonb('weightings'),
  isDefault:   boolean('is_default').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ri_icps_name').on(t.tenantId, t.name),
]);

/** A resolved identity across sources — the join key that stops the same
 *  company arriving three times under three spellings. */
export const riIds = pgTable('ri_ids', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  /** 'person' | 'company'. */
  entityKind:  varchar('entity_kind', { length: 16 }).notNull(),
  canonicalRef: varchar('canonical_ref', { length: 64 }).notNull(),
  source:      varchar('source', { length: 64 }).notNull(),
  sourceId:    varchar('source_id', { length: 255 }).notNull(),
  confidence:  numeric('confidence', { precision: 5, scale: 2 }),
  resolvedAt:  timestamp('resolved_at').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ri_ids_source').on(t.tenantId, t.source, t.sourceId),
  index('idx_ri_ids_canonical').on(t.tenantId, t.entityKind, t.canonicalRef),
]);

/** A prospect scored against an ICP. */
export const riProspects = pgTable('ri_prospects', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  icpId:       integer('icp_id').references(() => riIcps.id, { onDelete: 'set null' }),
  contactRef:  varchar('contact_ref', { length: 64 }),
  companyRef:  varchar('company_ref', { length: 64 }),
  score:       numeric('score', { precision: 5, scale: 2 }),
  signals:     jsonb('signals'),
  /** 'new' | 'enriched' | 'sequenced' | 'engaged' | 'converted' | 'disqualified'. */
  status:      varchar('status', { length: 16 }).notNull().default('new'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  lastSignalAt: timestamp('last_signal_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_ri_prospects_score').on(t.tenantId, t.status, t.score),
]);

/**
 * A revenue-intelligence sequence.
 *
 * Enrolments are NOT here: `recruiter_outreach_enrollments`,
 * `nurture_flow_enrollments`, `outplacement_enrollments` and
 * `follow_up_enrollments` were all person + sequence + status + `current_step` +
 * `next_send_at`, and collapsed into one shared enrolment row (§3.3). This is
 * the sequence definition only.
 */
export const riSequences = pgTable('ri_sequences', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  icpId:      integer('icp_id').references(() => riIcps.id, { onDelete: 'set null' }),
  steps:      jsonb('steps').notNull().default('[]'),
  status:     varchar('status', { length: 16 }).notNull().default('draft'),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  enrolledCount: integer('enrolled_count').notNull().default(0),
  replyCount: integer('reply_count').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ri_sequences_name').on(t.tenantId, t.name),
]);

/** Whether an outbound touch landed. The SEND is a kernel `deliveries` row; this
 *  is the CRM's read of the outcome, which is a different question with a
 *  different owner and a different retention policy. */
export const communicationTracking = pgTable('communication_tracking', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  deliveryRef: varchar('delivery_ref', { length: 64 }),
  contactRef:  varchar('contact_ref', { length: 64 }),
  dealId:      integer('deal_id'),
  channel:     varchar('channel', { length: 24 }).notNull(),
  /** 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed'. */
  event:       varchar('event', { length: 24 }).notNull(),
  occurredAt:  timestamp('occurred_at').notNull().defaultNow(),
  metadata:    jsonb('metadata'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_communication_tracking_contact').on(t.tenantId, t.contactRef, t.occurredAt),
  index('idx_communication_tracking_deal').on(t.dealId, t.occurredAt),
]);

/** An action taken on an inbox item — the shared triage surface Revenue and
 *  Support both write to. */
export const inboxActions = pgTable('inbox_actions', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  threadRef:  varchar('thread_ref', { length: 64 }),
  messageRef: varchar('message_ref', { length: 64 }),
  actorRef:   varchar('actor_ref', { length: 64 }),
  /** 'assign' | 'snooze' | 'archive' | 'reply' | 'convert' | 'spam'. */
  action:     varchar('action', { length: 24 }).notNull(),
  target:     varchar('target', { length: 64 }),
  snoozeUntil: timestamp('snooze_until'),
  note:       text('note'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_inbox_actions_thread').on(t.tenantId, t.threadRef, t.createdAt),
]);

/** A provisioned phone number. The calls are `deliveries`; the balance is a
 *  `ledger_entries` denomination. This is the number itself. */
export const businessPhoneNumbers = pgTable('business_phone_numbers', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  e164:        varchar('e164', { length: 24 }).notNull(),
  provider:    varchar('provider', { length: 48 }).notNull(),
  providerRef: varchar('provider_ref', { length: 160 }),
  country:     varchar('country', { length: 2 }),
  capabilities: jsonb('capabilities'),
  assignedToRef: varchar('assigned_to_ref', { length: 64 }),
  /** 'active' | 'suspended' | 'released'. */
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  monthlyCents: integer('monthly_cents').notNull().default(0),
  releasedAt:  timestamp('released_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_business_phone_numbers_e164').on(t.e164),
]);

/** A city, for territory and search-by-place. A global catalogue: no tenant
 *  scoping, deliberately, and `check-tenant-column.mjs` is the guard that makes
 *  that a stated decision rather than an oversight. */
export const cities = pgTable('cities', {
  id:         serial('id').primaryKey(),
  country:    varchar('country', { length: 2 }).notNull(),
  region:     varchar('region', { length: 120 }),
  name:       varchar('name', { length: 160 }).notNull(),
  slug:       varchar('slug', { length: 200 }).notNull(),
  latitude:   numeric('latitude', { precision: 9, scale: 6 }),
  longitude:  numeric('longitude', { precision: 9, scale: 6 }),
  population: integer('population'),
  timezone:   varchar('timezone', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_cities_slug').on(t.slug),
  index('idx_cities_country').on(t.country, t.name),
]);
