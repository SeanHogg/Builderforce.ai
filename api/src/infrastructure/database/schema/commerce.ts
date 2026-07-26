/**
 * Schema — commerce context.
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
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
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
import { sql } from 'drizzle-orm';
import { freelancerEngagements, timecards } from './collaboration';
import { artifactTypeEnum, pricingModelEnum } from './common';
import { segments, tenants, users } from './identity';
import { proposalEvaluations } from './llm';
import { jobPostings, skills } from './runtime';
import { projects, tasks } from './work';


/**
 * Records completed marketplace purchases.
 * Flat-fee: one row per purchase. Consumption: one row per billing cycle summary.
 */
export const marketplacePurchases = pgTable('marketplace_purchases', {
  id:                   serial('id').primaryKey(),
  userId:               varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  artifactType:         artifactTypeEnum('artifact_type').notNull(),
  artifactSlug:         varchar('artifact_slug', { length: 255 }).notNull(),
  priceCents:           integer('price_cents').notNull().default(0),
  pricingModel:         pricingModelEnum('pricing_model').notNull().default('flat_fee'),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// DevSecOps governance surfaces (doc 07 SEC-8/9; migration 0061). Segment-scoped.
// ---------------------------------------------------------------------------

export const accessReviews = pgTable('access_reviews', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  period:      varchar('period', { length: 120 }).notNull(),
  scope:       varchar('scope', { length: 20 }),
  scopeRef:    varchar('scope_ref', { length: 255 }),
  status:      varchar('status', { length: 20 }).notNull().default('open'),
  reviewerId:  varchar('reviewer_id', { length: 64 }),
  dueDate:     timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  findings:    text('findings'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Human-authored qualitative update stream on any deliverable (migration 0248) —
 * the narrative companion (EMP-11) to the delivery lens's quantitative status.
 * Polymorphic target via (scopeKind, scopeId); newest-first per deliverable.
 */
export const deliverableUpdates = pgTable('deliverable_updates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scopeKind:   varchar('scope_kind', { length: 16 }).notNull(),  // initiative | project | release | sprint
  scopeId:     varchar('scope_id', { length: 64 }).notNull(),
  statusLabel: varchar('status_label', { length: 16 }),          // on_track | at_risk | blocked | done | note
  body:        text('body').notNull(),
  authorId:    varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  authorName:  varchar('author_name', { length: 255 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Anonymous demo-funnel telemetry (migration 0360). The signed-in activity
 * tracker never fires for marketing-shell visitors, so the demo experience
 * writes its own append-only stream keyed by the same visitorId as
 * marketing_sessions: demo_start → page views → convert prompt shown/clicked →
 * lead/newsletter/exit. The admin funnel panel aggregates this by persona.
 */
export const demoEvents = pgTable('demo_events', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  visitorId:  varchar('visitor_id', { length: 64 }).notNull(),
  persona:    varchar('persona', { length: 32 }),
  kind:       varchar('kind', { length: 64 }).notNull(),
  path:       varchar('path', { length: 300 }),
  metadata:   jsonb('metadata'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byPersonaTime: index('idx_demo_events_persona_time').on(t.persona, t.occurredAt),
  byVisitor: index('idx_demo_events_visitor').on(t.visitorId, t.occurredAt),
}));


/**
 * "Book a demo with sales" capture (migration 0360) — written by the public
 * /book-demo page and the demo exit-intent/convert prompts. Platform-global
 * (no tenant): these are prospects, not customers.
 */
export const salesLeads = pgTable('sales_leads', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      varchar('name', { length: 200 }).notNull(),
  email:     varchar('email', { length: 320 }).notNull(),
  company:   varchar('company', { length: 200 }),
  interest:  varchar('interest', { length: 64 }),
  message:   text('message'),
  source:    varchar('source', { length: 64 }),
  locale:    varchar('locale', { length: 5 }),
  visitorId: varchar('visitor_id', { length: 64 }),
  status:    varchar('status', { length: 16 }).notNull().default('new'), // new | contacted | qualified | closed
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byCreated: index('idx_sales_leads_created').on(t.createdAt),
}));


/** A business contact — a stakeholder to talk to during an incident. */
export const businessContacts = pgTable('business_contacts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 255 }).notNull(),
  roleTitle: varchar('role_title', { length: 255 }),
  company:   varchar('company', { length: 255 }),
  email:     varchar('email', { length: 255 }),
  phone:     varchar('phone', { length: 64 }),
  teamsId:   varchar('teams_id', { length: 255 }),
  notes:     text('notes'),
  tags:      jsonb('tags').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_business_contacts_tenant').on(t.tenantId, t.name),
}));


/** A customer-support ticket — Support Issues / Tech Support Tix / Support-Tix-
 *  per-Customer (distinct customerRef). `isBug` flags the post-production-bug
 *  subset. Fed by Freshservice/ServiceNow poll (boardsync) keyed by externalRef,
 *  or entered manually. */
export const supportTickets = pgTable('support_tickets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  source:      varchar('source', { length: 24 }).notNull().default('manual'), // freshservice | servicenow | zendesk | manual
  externalRef: varchar('external_ref', { length: 255 }),
  subject:     varchar('subject', { length: 512 }),
  category:    varchar('category', { length: 24 }).notNull().default('other'), // bug | how_to | billing | feature_request | other
  isBug:       boolean('is_bug').notNull().default(false),
  priority:    varchar('priority', { length: 16 }).notNull().default('normal'),
  status:      varchar('status', { length: 16 }).notNull().default('open'),
  customerRef: varchar('customer_ref', { length: 255 }),
  openedAt:    timestamp('opened_at').notNull().defaultNow(),
  resolvedAt:  timestamp('resolved_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byOpened: index('idx_support_tickets_opened').on(t.tenantId, t.openedAt),
  byBug:    index('idx_support_tickets_bug').on(t.tenantId, t.isBug),
  uqExternal: uniqueIndex('uq_support_tickets_external').on(t.tenantId, t.source, t.externalRef),
}));


// ===========================================================================
// Deck generator (migrations 0242-0243) — the template library + generated-deck
// records behind the board-deck download / Brain "generate deck" tooling.
// ===========================================================================

/** A stored .pptx template + its {{token}}→binding manifest. Built-in templates
 *  (the R&D board deck, the CFO/DevFinOps deck) live at tenant_id=0; tenant
 *  uploads carry their own tenant_id. The binary lives in R2 at r2Key. */
export const deckTemplates = pgTable('deck_templates', {
  id:           uuid('id').primaryKey().defaultRandom(),
  // Sentinel 0 = BUILTIN_TENANT (global, tenant-less built-in templates); real
  // templates carry a live tenant id. Intentionally NO FK to tenants(id): the
  // 0 sentinel is not a real tenant row (tenants.id is serial from 1), so an FK
  // here rejected the built-in seed and blocked deploys (see migration 0243).
  // Tenant scoping is enforced in TemplateLibraryService queries.
  tenantId:     integer('tenant_id').notNull().default(0),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  archetype:    varchar('archetype', { length: 24 }).notNull().default('custom'), // board | cfo_devfinops | custom | generative
  r2Key:        varchar('r2_key', { length: 512 }),
  manifestJson: jsonb('manifest_json').notNull().default(sql`'{"version":1,"bindings":[]}'::jsonb`),
  isBuiltin:    boolean('is_builtin').notNull().default(false),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_deck_templates_tenant').on(t.tenantId),
}));


/** A generated deck instance — the audit/history record + the R2 pointer to the
 *  rendered .pptx the user downloads. */
export const generatedDecks = pgTable('generated_decks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  templateId:   uuid('template_id').references(() => deckTemplates.id, { onDelete: 'set null' }),
  mode:         varchar('mode', { length: 16 }).notNull().default('generative'),  // generative | fill
  quarter:      varchar('quarter', { length: 12 }),
  r2Key:        varchar('r2_key', { length: 512 }),
  status:       varchar('status', { length: 16 }).notNull().default('pending'),   // pending | ready | failed
  warningsJson: jsonb('warnings_json').notNull().default(sql`'[]'::jsonb`),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_generated_decks_tenant').on(t.tenantId, t.createdAt),
}));


// ---------------------------------------------------------------------------
// Freelance worker marketplace (0269)
//
// A freelancer (users.account_type='freelancer') publishes a for-hire profile,
// is hired across many tenants/projects via engagements, and has time measured
// from an audited activity-signal stream that resolves into billable timecards.
// ---------------------------------------------------------------------------

/** One per freelancer user: skills / resume / rate + public-or-private toggle. */
export const freelancerProfiles = pgTable('freelancer_profiles', {
  userId:                 varchar('user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  headline:               varchar('headline', { length: 200 }),
  bio:                    text('bio'),
  slug:                   varchar('slug', { length: 60 }),         // vanity alias for the public URL (/talent/:slug); unique, case-insensitive (0280)
  avatarKey:              varchar('avatar_key', { length: 300 }),  // R2 key for uploaded profile picture; served at GET /:id/avatar (0280)
  discipline:             varchar('discipline', { length: 60 }),  // developer|dba|designer|... (card role)
  skills:                 text('skills'),                          // JSON string[]
  hourlyRateCents:        integer('hourly_rate_cents'),
  currency:               varchar('currency', { length: 3 }).notNull().default('USD'),
  visibility:             varchar('visibility', { length: 10 }).notNull().default('private'), // public|private
  published:              boolean('published').notNull().default(false),
  availability:           varchar('availability', { length: 20 }).notNull().default('open'),  // open|limited|unavailable
  location:               varchar('location', { length: 120 }),
  timezone:               varchar('timezone', { length: 60 }),
  hiredVideoUserId:       varchar('hired_video_user_id', { length: 120 }),
  hiredVideoConnectionId: varchar('hired_video_connection_id', { length: 120 }),
  hiredVideoResumeId:     varchar('hired_video_resume_id', { length: 120 }),
  hiredVideoClaimUrl:     varchar('hired_video_claim_url', { length: 500 }),
  resumeKey:              varchar('resume_key', { length: 300 }),
  resumeFilename:         varchar('resume_filename', { length: 255 }),
  resumeExtract:          text('resume_extract'),                  // cached hired.video getProfile JSON
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byPublished: index('idx_freelancer_profiles_published').on(t.published),
}));


/** A hired worker "presents a proposal" against the published scope — tied to the
 *  engagement (+ optional ticket / posting). AI-evaluable via proposalEvaluations. */
export const deliverableProposals = pgTable('deliverable_proposals', {
  id:               varchar('id', { length: 36 }).primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  engagementId:     varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  ticketId:         integer('ticket_id').references(() => tasks.id, { onDelete: 'set null' }),
  jobId:            varchar('job_id', { length: 36 }).references(() => jobPostings.id, { onDelete: 'set null' }),
  authorUserId:     varchar('author_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:            varchar('title', { length: 200 }).notNull(),
  body:             text('body'),
  status:           varchar('status', { length: 20 }).notNull().default('submitted'), // submitted|accepted|changes_requested|withdrawn
  lastEvalOverall:  integer('last_eval_overall'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagement: index('idx_deliverable_proposals_engagement').on(t.engagementId),
  byTenant:     index('idx_deliverable_proposals_tenant').on(t.tenantId, t.createdAt),
}));


/** Employer's rating of a freelancer for an engagement (reputation). One per engagement. */
export const freelancerReviews = pgTable('freelancer_reviews', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  engagementId:      varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  reviewerUserId:    varchar('reviewer_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  rating:            integer('rating').notNull(),   // 1..5
  comment:           text('comment'),
  /**
   * Which way the review points (0299): 'employer_to_freelancer' (the freelancer's
   * received rating) or 'freelancer_to_employer' (the client rating). The SUBJECT is
   * implied by direction — freelancerUserId for the former, tenantId for the latter.
   */
  direction:         varchar('direction', { length: 24 }).notNull().default('employer_to_freelancer'),
  wouldWorkAgain:    boolean('would_work_again'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byFreelancer: index('idx_reviews_freelancer').on(t.freelancerUserId),
  byFreelancerDir: index('idx_reviews_freelancer_dir').on(t.freelancerUserId, t.direction),
  byTenantDir: index('idx_reviews_tenant_dir').on(t.tenantId, t.direction),
  /** Replaces the single-column unique so BOTH sides may review one engagement. */
  uqEngagementDirection: uniqueIndex('uq_review_engagement_direction').on(t.engagementId, t.direction),
}));


// ---------------------------------------------------------------------------
// RFP / RFQ Response (PRD 15, migration 0335) — pre-sales proposal generation.
// A request captures the asking business's brand + requirements and is either
// greenfield or grounded on an existing project; a response is the co-branded
// proposal (capability roster + P&L + phase plan + risks + branded document).
// ---------------------------------------------------------------------------
export const rfpRequests = pgTable('rfp_requests', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  title:            varchar('title', { length: 255 }).notNull(),
  requesterOrgName: varchar('requester_org_name', { length: 255 }),
  requesterBrand:   jsonb('requester_brand'),                 // BrandPalette of the asking business
  requirements:     text('requirements'),
  sourceMode:       varchar('source_mode', { length: 16 }).notNull().default('new').$type<'new' | 'existing_project'>(),
  basedOnProjectId: integer('based_on_project_id').references(() => projects.id, { onDelete: 'set null' }),
  marginPct:        real('margin_pct'),
  marketingPct:     real('marketing_pct'),
  contingencyPct:   real('contingency_pct'),
  dueDate:          timestamp('due_date', { withTimezone: true }),
  status:           varchar('status', { length: 24 }).notNull().default('draft').$type<'draft' | 'analyzing' | 'ready' | 'submitted'>(),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_rfp_requests_tenant').on(t.tenantId, t.updatedAt),
  index('idx_rfp_requests_project').on(t.basedOnProjectId),
]);


export const rfpResponses = pgTable('rfp_responses', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:          uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  requestId:          uuid('request_id').notNull().references(() => rfpRequests.id, { onDelete: 'cascade' }),
  projectId:          integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  status:             varchar('status', { length: 24 }).notNull().default('draft').$type<'draft' | 'ready' | 'submitted'>(),
  body:               jsonb('body'),                          // RfpResponseBody (typed in application/rfp/types.ts)
  docHtml:            text('doc_html'),
  quotedPriceUsdCents: integer('quoted_price_usd_cents'),
  marginPct:          real('margin_pct'),
  scanRefreshed:      boolean('scan_refreshed').notNull().default(false),
  generatedBy:        jsonb('generated_by'),                  // { cto, productOwner } agent refs
  createdBy:          varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_rfp_responses_tenant').on(t.tenantId, t.updatedAt),
  index('idx_rfp_responses_request').on(t.requestId, t.createdAt),
  index('idx_rfp_responses_project').on(t.projectId),
]);


// ---------------------------------------------------------------------------
// Generic, timestamped catalog adoption event log (skill | persona | prompt).
// Feeds the over-time series in /api/catalog-analytics. Append-only. Mig 0301.
// ---------------------------------------------------------------------------
export const catalogAdoptionEvents = pgTable('catalog_adoption_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 16 }).notNull(),
  itemId:     varchar('item_id', { length: 128 }).notNull(),
  itemName:   varchar('item_name', { length: 255 }),
  eventType:  varchar('event_type', { length: 16 }).notNull().default('install'),
  actorId:    varchar('actor_id', { length: 64 }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_catalog_events_tenant_kind_time').on(t.tenantId, t.kind, t.createdAt),
  index('idx_catalog_events_tenant_kind_item').on(t.tenantId, t.kind, t.itemId),
]);
