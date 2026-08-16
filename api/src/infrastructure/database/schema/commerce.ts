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
  bigint,
  bigserial,
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
import { sql } from 'drizzle-orm';
import { creationSessionObjects, creationSessions, freelancerEngagements, timecards } from './canvas';
import { artifactTypeEnum, objects, pricingModelEnum } from './kernel';
import { segments, tenants, users } from './identity';
import { proposalEvaluations } from './agents';
import { jobPostings, skills } from './agents';
import { projects, tasks } from './delivery';


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
  /** The person's résumé — a `creation_session_objects` row of kind `resume` (0471).
   *
   *  It is a POINTER, not a copy. The résumé is the same Canvas object they edit on a
   *  board, which is what makes the master/variant family, the chosen template and the
   *  public link one document instead of three. This replaced four `hired_video_*`
   *  columns plus a flat R2 key: the résumé used to be a file we stored and an iframe
   *  we embedded from a third party, and is now a first-class object this platform owns.
   *  See application/resume/profileResume.ts. */
  resumeObjectId:         uuid('resume_object_id').references(() => creationSessionObjects.id, { onDelete: 'set null' }),
  /** Career intent (0462) — the SAME listing, offered to two kinds of demand.
   *
   *  `job_postings.posting_type` already accepts 'fte' and `job_proposals` already
   *  carries submitted → shortlisted → accepted → declined → withdrawn, so a full-time
   *  job is a posting and an application is a proposal. The only thing missing was the
   *  supply side saying which it wants — hence columns here rather than a second
   *  candidate profile that would fork this person's résumé and reputation in two.
   *  Defaults to 'services', so every row written before this migration keeps behaving
   *  exactly as it did. See application/career/listing.ts for the readings over it. */
  seeking:                varchar('seeking', { length: 20 }).notNull().default('services'), // services|employment|both|not_looking
  targetRoles:            text('target_roles'),                    // JSON string[]
  seniority:              varchar('seniority', { length: 30 }),
  desiredSalaryMinCents:  integer('desired_salary_min_cents'),
  desiredSalaryMaxCents:  integer('desired_salary_max_cents'),
  workMode:               varchar('work_mode', { length: 10 }),    // remote|hybrid|onsite
  noticePeriodDays:       integer('notice_period_days'),
  openToRelocation:       boolean('open_to_relocation').notNull().default(false),
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

// Person-scoped CRM for sales associates. Platform superadmins collaborate on
// these same rows; no browser-only shadow copy exists (migration 0401).
export const salesContacts = pgTable('sales_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: varchar('owner_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull().default(''),
  email: varchar('email', { length: 255 }).notNull().default(''),
  company: varchar('company', { length: 255 }).notNull().default(''),
  market: varchar('market', { length: 255 }).notNull().default(''),
  stage: varchar('stage', { length: 24 }).notNull().default('new'),
  lastTouchAt: timestamp('last_touch_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_sales_contacts_owner_stage').on(t.ownerUserId, t.stage, t.updatedAt)]);

export const salesCampaigns = pgTable('sales_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: varchar('owner_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  market: varchar('market', { length: 255 }).notNull().default(''),
  subject: varchar('subject', { length: 500 }).notNull().default(''),
  status: varchar('status', { length: 24 }).notNull().default('draft'),
  sent: integer('sent').notNull().default(0),
  replies: integer('replies').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_sales_campaigns_owner_status').on(t.ownerUserId, t.status, t.updatedAt)]);

export const salesWeeklyGoals = pgTable('sales_weekly_goals', {
  ownerUserId: varchar('owner_user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  outreachTarget: integer('outreach_target').notNull().default(50),
  contactsTarget: integer('contacts_target').notNull().default(20),
  meetingsTarget: integer('meetings_target').notNull().default(3),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesCoachingNotes = pgTable('sales_coaching_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  associateUserId: varchar('associate_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  authorUserId: varchar('author_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_sales_coaching_notes_associate').on(t.associateUserId, t.createdAt)]);

export const salesCanvasSessions = pgTable('sales_canvas_sessions', {
  ownerUserId: varchar('owner_user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().unique().references(() => creationSessions.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesCommissionRules = pgTable('sales_commission_rules', {
  ruleKey: varchar('rule_key', { length: 40 }).primaryKey(),
  plan: varchar('plan', { length: 20 }).notNull(),
  billingCycle: varchar('billing_cycle', { length: 20 }).notNull(),
  referralBps: integer('referral_bps').notNull().default(0),
  salesBps: integer('sales_bps').notNull().default(0),
  updatedBy: varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesAssociateSettings = pgTable('sales_associate_settings', {
  ownerUserId: varchar('owner_user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  referralCode: varchar('referral_code', { length: 32 }).notNull().unique(),
  salesCode: varchar('sales_code', { length: 32 }).notNull().unique(),
  revenueGoalCents: bigint('revenue_goal_cents', { mode: 'number' }).notNull().default(0),
  notifyOnSignup: boolean('notify_on_signup').notNull().default(true),
  notifyOnConversion: boolean('notify_on_conversion').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesReferrals = pgTable('sales_referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  associateUserId: varchar('associate_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  referredUserId: varchar('referred_user_id', { length: 36 }).notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  attributionType: varchar('attribution_type', { length: 16 }).notNull().default('referral'),
  signedUpAt: timestamp('signed_up_at', { withTimezone: true }).notNull().defaultNow(),
  signupNotifiedAt: timestamp('signup_notified_at', { withTimezone: true }),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  plan: varchar('plan', { length: 20 }), billingCycle: varchar('billing_cycle', { length: 20 }),
  revenueCents: bigint('revenue_cents', { mode: 'number' }), commissionBps: integer('commission_bps'),
  commissionCents: bigint('commission_cents', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_sales_referrals_associate').on(t.associateUserId, t.signedUpAt),
  index('idx_sales_referrals_conversion').on(t.referredUserId, t.convertedAt),
  uniqueIndex('uq_sales_referrals_tenant_attribution').on(t.tenantId).where(sql`${t.tenantId} IS NOT NULL`),
]);

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Commerce — the platform's twenty remaining targets (PRD 20 §3.2).
//
// 58 source tables in → 24 out, 32 of them absorbed by the kernel. Every
// marketplace listing, template, pack and offering is a `catalog_items` row with
// a kind; every licence key, seat grant and entitlement is a `settings` row;
// every payout and commission is a `ledger_entries` row with a denomination.
// What survives is the transaction and the counterparty — the two things a
// catalogue row genuinely is not.
//
// `is_template` (§3.1) is why there is no `X_templates` beside any `X` here: an
// `X_template` sitting next to an `X` with the same columns is one table and a
// boolean, and keeping them apart is how the two drift until the template stops
// producing a valid instance.

/** A cart in flight. Deliberately not an order: an abandoned cart is a marketing
 *  fact with its own retention policy, and merging the two is how "revenue"
 *  starts counting things nobody paid for. */
export const carts = pgTable('carts', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull(),
  buyerRef:    varchar('buyer_ref', { length: 64 }),
  /** Set for a signed-out cart, so the canvas's no-account path reaches checkout. */
  guestToken:  varchar('guest_token', { length: 64 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents:  integer('total_cents').notNull().default(0),
  discountCode: varchar('discount_code', { length: 64 }),
  /** 'open' | 'converted' | 'abandoned' | 'expired'. */
  status:      varchar('status', { length: 16 }).notNull().default('open'),
  convertedOrderId: integer('converted_order_id'),
  expiresAt:   timestamp('expires_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_carts_buyer').on(t.tenantId, t.buyerRef, t.status),
  index('idx_carts_guest').on(t.guestToken),
]);

/** An order. The money movement is `ledger_entries`; this is the agreement. */
export const orders = pgTable('orders', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  orderNumber: varchar('order_number', { length: 48 }).notNull(),
  buyerRef:    varchar('buyer_ref', { length: 64 }),
  buyerEmail:  varchar('buyer_email', { length: 320 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  taxCents:    integer('tax_cents').notNull().default(0),
  totalCents:  integer('total_cents').notNull().default(0),
  /** 'pending' | 'paid' | 'fulfilled' | 'refunded' | 'cancelled'. */
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  provider:    varchar('provider', { length: 48 }),
  providerRef: varchar('provider_ref', { length: 160 }),
  placedAt:    timestamp('placed_at').notNull().defaultNow(),
  fulfilledAt: timestamp('fulfilled_at'),
  refundedAt:  timestamp('refunded_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_orders_number').on(t.tenantId, t.orderNumber),
  index('idx_orders_status').on(t.tenantId, t.status, t.placedAt),
]);

/** A line on an order, pointing at the `catalog_items` row that was bought. */
export const orderLineItems = pgTable('order_line_items', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  orderId:       integer('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  catalogItemId: uuid('catalog_item_id'),
  description:   varchar('description', { length: 500 }).notNull(),
  quantity:      integer('quantity').notNull().default(1),
  unitCents:     integer('unit_cents').notNull().default(0),
  amountCents:   integer('amount_cents').notNull().default(0),
  /** Who gets paid for this line — the seller, when the platform is the
   *  marketplace rather than the merchant. */
  sellerRef:     varchar('seller_ref', { length: 64 }),
  commissionCents: integer('commission_cents').notNull().default(0),
  position:      integer('position').notNull().default(0),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_order_line_items_order').on(t.orderId, t.position),
]);

/** A licence granted over a template. The entitlement CHECK reads kernel
 *  `settings`; this is the licence's own terms, which outlive any one grant. */
export const templateLicenses = pgTable('template_licenses', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  catalogItemId: uuid('catalog_item_id'),
  licenseeRef:   varchar('licensee_ref', { length: 64 }).notNull(),
  /** 'single' | 'team' | 'unlimited' | 'trial'. */
  scope:         varchar('scope', { length: 16 }).notNull().default('single'),
  seatLimit:     integer('seat_limit'),
  seatsUsed:     integer('seats_used').notNull().default(0),
  orderId:       integer('order_id'),
  /**
   * The publication snapshot this licence was granted against (migration 0466).
   *
   * This is what makes "you own v1.1" a fact. Without it the launch and install
   * paths serve whatever the listing currently points at, so a buyer's copy
   * silently changes under them every time the seller re-publishes — and a seller
   * who ships a broken version takes every existing buyer with them.
   *
   * NULL means unpinned and resolves to the listing's current snapshot: the
   * pre-0466 behaviour, kept for licences granted before there was anything to
   * pin. Never rewritten in place — accepting an update is a new grant, not a
   * silent move.
   */
  snapshotId:    uuid('snapshot_id'),
  startsAt:      timestamp('starts_at').notNull().defaultNow(),
  expiresAt:     timestamp('expires_at'),
  revokedAt:     timestamp('revoked_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_template_licenses_licensee').on(t.tenantId, t.catalogItemId, t.licenseeRef),
]);

/** A white-labelled tenant reselling the platform. */
export const whitelabelTenants = pgTable('whitelabel_tenants', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  resellerRef: varchar('reseller_ref', { length: 64 }).notNull(),
  domain:      varchar('domain', { length: 255 }),
  brandName:   varchar('brand_name', { length: 200 }),
  /** Theme TOKENS, never literal colours — the reseller's palette has to work in
   *  both themes exactly as the platform's does. */
  theme:       jsonb('theme'),
  supportEmail: varchar('support_email', { length: 320 }),
  revenueSharePercent: numeric('revenue_share_percent', { precision: 5, scale: 2 }),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_whitelabel_tenants_domain').on(t.domain),
]);

/** An agency's brand presentation on the platform. */
export const agencyBrandings = pgTable('agency_brandings', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  agencyRef:  varchar('agency_ref', { length: 64 }).notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  logoArtifactId: uuid('logo_artifact_id'),
  theme:      jsonb('theme'),
  tagline:    varchar('tagline', { length: 300 }),
  website:    varchar('website', { length: 255 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_agency_brandings_agency').on(t.tenantId, t.agencyRef),
]);

/** A client an agency works for. The people are `memberships`; this is the
 *  commercial relationship. */
export const agencyClients = pgTable('agency_clients', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  agencyRef:  varchar('agency_ref', { length: 64 }).notNull(),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  companyRef: varchar('company_ref', { length: 64 }),
  retainerCents: integer('retainer_cents'),
  currency:   varchar('currency', { length: 8 }).notNull().default('USD'),
  status:     varchar('status', { length: 16 }).notNull().default('active'),
  startedAt:  timestamp('started_at'),
  endedAt:    timestamp('ended_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_agency_clients_name').on(t.tenantId, t.agencyRef, t.clientName),
]);

/** A bookable service. */
export const bookingServices = pgTable('booking_services', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  slug:        varchar('slug', { length: 160 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  durationMin: integer('duration_min').notNull().default(30),
  bufferMin:   integer('buffer_min').notNull().default(0),
  priceCents:  integer('price_cents').notNull().default(0),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'one_to_one' | 'group' | 'round_robin'. */
  mode:        varchar('mode', { length: 16 }).notNull().default('one_to_one'),
  capacity:    integer('capacity').notNull().default(1),
  isActive:    boolean('is_active').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_booking_services_slug').on(t.tenantId, t.slug),
]);

/** Somebody who can be booked. Their availability is `availability_slots`
 *  (Identity) and their calendar is a `connections` row. */
export const bookingHosts = pgTable('booking_hosts', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  serviceId:  integer('service_id').references(() => bookingServices.id, { onDelete: 'cascade' }),
  hostRef:    varchar('host_ref', { length: 64 }).notNull(),
  connectionId: integer('connection_id'),
  timezone:   varchar('timezone', { length: 64 }).notNull().default('UTC'),
  priority:   integer('priority').notNull().default(0),
  isActive:   boolean('is_active').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_booking_hosts_host').on(t.serviceId, t.hostRef),
]);

/** A booking. */
export const bookingReservations = pgTable('booking_reservations', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  serviceId:   integer('service_id').references(() => bookingServices.id, { onDelete: 'set null' }),
  hostRef:     varchar('host_ref', { length: 64 }),
  bookerRef:   varchar('booker_ref', { length: 64 }),
  bookerEmail: varchar('booker_email', { length: 320 }),
  startsAt:    timestamp('starts_at').notNull(),
  endsAt:      timestamp('ends_at').notNull(),
  timezone:    varchar('timezone', { length: 64 }).notNull().default('UTC'),
  /** 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'. */
  status:      varchar('status', { length: 16 }).notNull().default('confirmed'),
  meetingUrl:  text('meeting_url'),
  orderId:     integer('order_id'),
  cancelReason: varchar('cancel_reason', { length: 200 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_booking_reservations_host').on(t.tenantId, t.hostRef, t.startsAt),
  index('idx_booking_reservations_status').on(t.tenantId, t.status, t.startsAt),
]);

/** A posted gig. */
export const gigProjects = pgTable('gig_projects', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  clientRef:   varchar('client_ref', { length: 64 }).notNull(),
  title:       varchar('title', { length: 300 }).notNull(),
  brief:       text('brief'),
  skills:      jsonb('skills'),
  budgetMinCents: integer('budget_min_cents'),
  budgetMaxCents: integer('budget_max_cents'),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'fixed' | 'hourly'. */
  pricing:     varchar('pricing', { length: 16 }).notNull().default('fixed'),
  /** 'draft' | 'open' | 'awarded' | 'in_progress' | 'delivered' | 'closed'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  awardedBidId: integer('awarded_bid_id'),
  dueAt:       timestamp('due_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_gig_projects_status').on(t.tenantId, t.status, t.createdAt),
]);

/** A bid on a gig. */
export const gigBids = pgTable('gig_bids', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  gigProjectId: integer('gig_project_id').references(() => gigProjects.id, { onDelete: 'cascade' }),
  bidderRef:   varchar('bidder_ref', { length: 64 }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  deliveryDays: integer('delivery_days'),
  pitch:       text('pitch'),
  /** 'submitted' | 'shortlisted' | 'awarded' | 'declined' | 'withdrawn'. */
  status:      varchar('status', { length: 16 }).notNull().default('submitted'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_gig_bids_bidder').on(t.gigProjectId, t.bidderRef),
]);

/** A dispute on a gig. Its conversation is a `threads` + `messages` pair and its
 *  evidence is `artifacts`; what is here is the claim and the ruling. */
export const gigDisputes = pgTable('gig_disputes', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  gigProjectId: integer('gig_project_id').references(() => gigProjects.id, { onDelete: 'cascade' }),
  raisedByRef:  varchar('raised_by_ref', { length: 64 }).notNull(),
  reason:       varchar('reason', { length: 200 }).notNull(),
  detail:       text('detail'),
  amountDisputedCents: integer('amount_disputed_cents'),
  /** 'open' | 'mediating' | 'resolved' | 'withdrawn'. */
  status:       varchar('status', { length: 16 }).notNull().default('open'),
  resolution:   text('resolution'),
  resolvedBy:   varchar('resolved_by', { length: 64 }),
  resolvedAt:   timestamp('resolved_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_gig_disputes_status').on(t.tenantId, t.status, t.createdAt),
]);

/** A consultation booked with a consultant. */
export const consultantConsultations = pgTable('consultant_consultations', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  consultantRef: varchar('consultant_ref', { length: 64 }).notNull(),
  clientRef:     varchar('client_ref', { length: 64 }),
  reservationId: integer('reservation_id'),
  topic:         varchar('topic', { length: 300 }),
  durationMin:   integer('duration_min'),
  rateCents:     integer('rate_cents'),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  status:        varchar('status', { length: 16 }).notNull().default('scheduled'),
  /** The recording and its transcript are `artifacts`, one derived from the other. */
  recordingArtifactId: uuid('recording_artifact_id'),
  heldAt:        timestamp('held_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_consultant_consultations_consultant').on(t.tenantId, t.consultantRef, t.heldAt),
]);

/** A knowledge document a consultant sells or shares. The FILE is an `artifacts`
 *  row; this is the offering's own commercial identity. */
export const consultantKnowledgeDocs = pgTable('consultant_knowledge_docs', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  consultantRef: varchar('consultant_ref', { length: 64 }).notNull(),
  artifactId:    uuid('artifact_id'),
  title:         varchar('title', { length: 300 }).notNull(),
  summary:       text('summary'),
  priceCents:    integer('price_cents').notNull().default(0),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  visibility:    varchar('visibility', { length: 16 }).notNull().default('private'),
  downloadCount: integer('download_count').notNull().default(0),
  publishedAt:   timestamp('published_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_consultant_knowledge_docs_consultant').on(t.tenantId, t.consultantRef, t.publishedAt),
]);

/** A deck of cards sold or shared as a product — the smallest packaged artifact
 *  kind, kept because its ORDERING and reveal rules are commerce, not content. */
export const cardDecks = pgTable('card_decks', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  slug:       varchar('slug', { length: 160 }).notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  cards:      jsonb('cards').notNull().default('[]'),
  cardCount:  integer('card_count').notNull().default(0),
  priceCents: integer('price_cents').notNull().default(0),
  currency:   varchar('currency', { length: 8 }).notNull().default('USD'),
  visibility: varchar('visibility', { length: 16 }).notNull().default('private'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_card_decks_slug').on(t.tenantId, t.slug),
]);

/** A board only some people can reach. The people are `memberships` and the
 *  invite is an `invitations` row; this is the exclusivity RULE. */
export const exclusiveBoards = pgTable('exclusive_boards', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  /** What earns entry: a plan, a badge, a rung, an invitation only. */
  entryRule:   jsonb('entry_rule'),
  memberCap:   integer('member_cap'),
  memberCount: integer('member_count').notNull().default(0),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_exclusive_boards_name').on(t.tenantId, t.name),
]);

/** A shared resource posted to the community. */
export const communityResources = pgTable('community_resources', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  title:      varchar('title', { length: 300 }).notNull(),
  url:        text('url'),
  artifactId: uuid('artifact_id'),
  category:   varchar('category', { length: 96 }),
  summary:    text('summary'),
  authorRef:  varchar('author_ref', { length: 64 }),
  /** Upvotes and saves are `annotations` rows; this is the denormalised count so
   *  a listing does not fan out one aggregate per row. */
  upvoteCount: integer('upvote_count').notNull().default(0),
  status:     varchar('status', { length: 16 }).notNull().default('published'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_community_resources_category').on(t.category, t.upvoteCount),
]);

/** A partner's opt-in to a programme. */
export const partnerProgramOptIns = pgTable('partner_program_opt_ins', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  partnerRef:  varchar('partner_ref', { length: 64 }).notNull(),
  programKey:  varchar('program_key', { length: 96 }).notNull(),
  /** 'pending' | 'active' | 'suspended' | 'left'. */
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  commissionPercent: numeric('commission_percent', { precision: 5, scale: 2 }),
  terms:       jsonb('terms'),
  acceptedAt:  timestamp('accepted_at'),
  leftAt:      timestamp('left_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_partner_program_opt_ins_program').on(t.tenantId, t.partnerRef, t.programKey),
]);

/** Extra inbox seats bought on top of a plan. A quantity purchase, which is why
 *  it is not a `plan_features` limit: the limit is what the plan grants, this is
 *  what was bought beyond it. */
export const inboxSeatAddons = pgTable('inbox_seat_addons', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  orderId:     integer('order_id'),
  seats:       integer('seats').notNull().default(1),
  unitCents:   integer('unit_cents').notNull().default(0),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  startsAt:    timestamp('starts_at').notNull().defaultNow(),
  endsAt:      timestamp('ends_at'),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_inbox_seat_addons_tenant').on(t.tenantId, t.status, t.endsAt),
]);

/**
 * The people who will vouch for you (migration 0476).
 *
 * Owned by the individual, like `freelancer_profiles` beside it — a reference is
 * part of a person's career, not a workspace's HR record, so it is keyed by user
 * and carries no tenant.
 */
export const professionalReferences = pgTable('professional_references', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          varchar('name', { length: 160 }).notNull(),
  /** One line: "Manager at Fintech Co, 2021–2024" — what an employer reads first. */
  relationship:  varchar('relationship', { length: 240 }),
  company:       varchar('company', { length: 160 }),
  title:         varchar('title', { length: 160 }),
  email:         varchar('email', { length: 320 }),
  phone:         varchar('phone', { length: 60 }),
  /** The two or three things this person can actually confirm. */
  canSpeakTo:    text('can_speak_to'),
  /** draft | requested | confirmed | declined. Recorded by the owner — the referee
   *  has no account here, so it is a claim rather than a signature. */
  status:        varchar('status', { length: 16 }).notNull().default('draft'),
  requestedAt:   timestamp('requested_at', { withTimezone: true }),
  confirmedAt:   timestamp('confirmed_at', { withTimezone: true }),
  notes:         text('notes'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_professional_references_user').on(t.userId, t.createdAt),
]);

/**
 * One share = one token = one chosen subset, immutable once issued.
 *
 * Widening an existing token would silently extend an employer's access to a link
 * they already hold, so changing the selection means issuing a new one.
 */
export const referenceShares = pgTable('reference_shares', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** SHA-256 hex only — never the raw token. Same rule as kernel `share_links`. */
  tokenHash:      varchar('token_hash', { length: 64 }).notNull().unique(),
  label:          varchar('label', { length: 160 }),
  referenceIds:   jsonb('reference_ids').$type<string[]>().notNull().default([]),
  /** Contact details are the sensitive half; a share can prove the reference exists
   *  and what they can speak to without handing over their phone number. */
  includeContact: boolean('include_contact').notNull().default(false),
  expiresAt:      timestamp('expires_at', { withTimezone: true }),
  revokedAt:      timestamp('revoked_at', { withTimezone: true }),
  viewCount:      integer('view_count').notNull().default(0),
  lastViewedAt:   timestamp('last_viewed_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_reference_shares_user').on(t.userId, t.createdAt),
]);
