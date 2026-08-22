/**
 * Schema — Support & knowledge, owned by **Support** (PRD 20 §3).
 *
 * Root entity `ticket`. 22 source tables in → 9 out: 12 absorbed by the kernel,
 * 1 by the canvas.
 *
 * NINE OUT OF TWENTY-TWO IS THE HEADLINE HERE. A support conversation is a
 * kernel `threads` + `messages` pair — the same surface as chat, comments and
 * ceremony notes (§7.1). A satisfaction survey is `question_sets` + `responses`.
 * An SLA breach notification is a `deliveries` row. An article's revision
 * history is `revisions`; its attachments are `artifacts`; who is watching it is
 * `memberships`. What is left is what support genuinely owns: the article, the
 * widget that collects feedback, and the sentiment read off it.
 *
 * NO SIBLING IMPORTS beyond the kernel.
 *
 * See migration 0423.
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

/**
 * A knowledge-base article.
 *
 * Versioning is kernel `revisions` and read-acknowledgement is kernel
 * `memberships` — the two things the Knowledge Management subsystem built
 * itself before the kernel existed to build them once.
 */
export const supportArticles = pgTable('support_articles', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  slug:        varchar('slug', { length: 200 }).notNull(),
  title:       varchar('title', { length: 300 }).notNull(),
  summary:     text('summary'),
  body:        text('body'),
  /** 'article' | 'sop' | 'faq' | 'runbook' | 'policy'. */
  kind:        varchar('kind', { length: 24 }).notNull().default('article'),
  category:    varchar('category', { length: 96 }),
  tags:        jsonb('tags'),
  /** 'draft' | 'review' | 'published' | 'archived'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  /** 'private' | 'tenant' | 'public' — a public article is the same row read
   *  through the public shell, not a second copy of it. */
  visibility:  varchar('visibility', { length: 16 }).notNull().default('tenant'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  /** Set when the article must be re-acknowledged, which is what makes an SOP an
   *  SOP rather than a document. */
  reviewDueAt: timestamp('review_due_at'),
  viewCount:   integer('view_count').notNull().default(0),
  helpfulCount: integer('helpful_count').notNull().default(0),
  unhelpfulCount: integer('unhelpful_count').notNull().default(0),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_support_articles_slug').on(t.tenantId, t.slug),
  index('idx_support_articles_status').on(t.tenantId, t.status, t.visibility, t.updatedAt),
  index('idx_support_articles_review').on(t.tenantId, t.reviewDueAt),
]);

/**
 * An embeddable widget that collects customer feedback.
 *
 * The widget is a CONFIGURATION, not a page: where it renders, what it asks,
 * which audience sees it. What it asks is a `question_sets` reference, so the
 * one form runner (§7.1) serves the widget, the pulse and the screening form
 * without three implementations.
 */
export const customerEngagementFeedbackWidgets = pgTable('customer_engagement_feedback_widgets', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  key:           varchar('key', { length: 64 }).notNull(),
  name:          varchar('name', { length: 200 }).notNull(),
  /** 'nps' | 'csat' | 'thumbs' | 'free_text' | 'form'. */
  kind:          varchar('kind', { length: 24 }).notNull().default('csat'),
  questionSetId: uuid('question_set_id'),
  /** Where it appears — a path glob, an app surface, a trigger event. */
  placement:     jsonb('placement'),
  audience:      jsonb('audience'),
  /** Theme tokens only: a widget that hardcodes a colour reads wrong in one of
   *  the two themes it is guaranteed to be rendered in. */
  theme:         jsonb('theme'),
  enabled:       boolean('enabled').notNull().default(true),
  /** Do not ask the same person again within this window. */
  cooldownDays:  integer('cooldown_days').notNull().default(30),
  responseCount: integer('response_count').notNull().default(0),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_customer_engagement_feedback_widgets_key').on(t.tenantId, t.key),
  index('idx_customer_engagement_feedback_widgets_enabled').on(t.tenantId, t.enabled),
]);

/**
 * The sentiment read off a piece of feedback.
 *
 * A DERIVED value with its own DDL would normally be a `metric_fact` (§3.1). It
 * is not, and the distinction is the reason the flattening rule has an
 * exception: a metric fact is a number in a time series, and this is a
 * classification OF A SPECIFIC ROW, carrying the model that produced it and the
 * span of text it applies to. Rolling it up into a trend is what produces the
 * `metric_fact`; this is the evidence underneath.
 */
export const feedbackSentiments = pgTable('feedback_sentiments', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  /** What was classified — a `responses` row, a `messages` row, an annotation. */
  sourceRef:   varchar('source_ref', { length: 64 }).notNull(),
  sourceTable: varchar('source_table', { length: 48 }).notNull(),
  widgetId:    integer('widget_id').references(() => customerEngagementFeedbackWidgets.id, { onDelete: 'set null' }),
  /** 'positive' | 'neutral' | 'negative' | 'mixed'. */
  label:       varchar('label', { length: 16 }).notNull(),
  /** −1.00 … 1.00. */
  score:       numeric('score', { precision: 4, scale: 2 }),
  confidence:  numeric('confidence', { precision: 4, scale: 2 }),
  themes:      jsonb('themes'),
  excerpt:     text('excerpt'),
  /** The model that produced it, so a re-classification is comparable rather
   *  than an unexplained change of mind. */
  model:       varchar('model', { length: 96 }),
  classifiedAt: timestamp('classified_at').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_feedback_sentiments_source').on(t.tenantId, t.sourceTable, t.sourceRef, t.model),
  index('idx_feedback_sentiments_label').on(t.tenantId, t.label, t.classifiedAt),
]);


// =========================================================================
// The rest of the feedback family.
//
// This module’s own header claims support owns "the widget that collects
// feedback, and the sentiment read off it" — and it did own the widget and the
// sentiment, while the COLLECTOR, the submissions it gathers and the provider
// webhooks that feed it were declared in `canvas.ts`. One concept, two seats,
// and `feedback_sentiments.source_table` pointing at a table in the other one.
// The family is here now, so a sentiment and the submission it classifies are
// reviewable together.
//
// Cross-domain columns travelled as plain ids (`project_id`, `task_id`, the
// `*_user_id`s), which is this module’s "no sibling imports beyond the kernel"
// rule and §3’s both; the foreign keys are declared in migrations 0354 / 1076 /
// 1077 and are unchanged.
// =========================================================================

// ---------------------------------------------------------------------------
// Product Feedback collection (migration 0354)
// ---------------------------------------------------------------------------

/**
 * A project's feedback collector — the human-input twin of [[errorCollectors]].
 * ONE per project (one ingest key = one embeddable snippet), so any application
 * carrying the snippet can gather feature requests, bug reports and ideas from
 * its own users. `keyHash` authenticates the public snippet POST; `dailyLimit`
 * is the abuse ceiling on an endpoint that opens TICKETS.
 */
export const feedbackCollectors = pgTable('feedback_collectors', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull(),
  projectId:        integer('project_id').notNull(),
  name:             varchar('name', { length: 255 }).notNull(),
  /** SHA-256 of the bff_* ingest key (raw key shown once at creation). */
  keyHash:          varchar('key_hash', { length: 64 }).unique(),
  enabled:          boolean('enabled').notNull().default(true),
  /** Open a backlog ticket per submission (off = record + triage only). */
  autoCreateTask:   boolean('auto_create_task').notNull().default(true),
  /** Submissions accepted from this collector per rolling 24h. */
  dailyLimit:       integer('daily_limit').notNull().default(100),
  /** '*' or a comma-separated origin allow-list the snippet may post from. */
  allowedOrigins:   text('allowed_origins').notNull().default('*'),
  lastSubmissionAt: timestamp('last_submission_at'),
  createdBy:        varchar('created_by', { length: 36 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  // One collector per project — a project's feedback has a single front door.
  uqProject: uniqueIndex('uq_feedback_collectors_project').on(t.tenantId, t.projectId),
}));


/**
 * A single feedback request and its link to the backlog ticket it opened.
 * `collectorId` is NULL for an IN-APP submission (the signed-in right-edge
 * feedback panel), which the session authenticates and which needs no key.
 * `fingerprint` collapses a repeat/double submit onto the existing request.
 */
export const feedbackSubmissions = pgTable('feedback_submissions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull(),
  projectId:       integer('project_id').notNull(),
  collectorId:     uuid('collector_id').references(() => feedbackCollectors.id, { onDelete: 'set null' }),
  /** 'feature' | 'bug' | 'idea' | 'other'. */
  kind:            varchar('kind', { length: 16 }).notNull().default('feature'),
  title:           varchar('title', { length: 300 }).notNull(),
  body:            text('body').notNull(),
  /** 'new' | 'approved' | 'declined' — approval is the human gate on execution. */
  status:          varchar('status', { length: 16 }).notNull().default('new'),
  submitterUserId: varchar('submitter_user_id', { length: 36 }),
  submitterEmail:  varchar('submitter_email', { length: 255 }),
  submitterName:   varchar('submitter_name', { length: 255 }),
  pageUrl:         text('page_url'),
  userAgent:       text('user_agent'),
  appVersion:      varchar('app_version', { length: 64 }),
  context:         jsonb('context'),
  /** SHA-256 of kind+title+body — the duplicate-collapse key. */
  fingerprint:     varchar('fingerprint', { length: 128 }).notNull(),
  taskId:          integer('task_id'),
  reviewedBy:      varchar('reviewed_by', { length: 36 }),
  reviewedAt:      timestamp('reviewed_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject:     index('idx_feedback_submissions_project').on(t.projectId, t.createdAt),
  byTenant:      index('idx_feedback_submissions_tenant_status').on(t.tenantId, t.status, t.createdAt),
  byCollector:   index('idx_feedback_submissions_collector').on(t.collectorId, t.createdAt),
  byFingerprint: index('idx_feedback_submissions_fingerprint').on(t.projectId, t.fingerprint),
}));


/**
 * A provider webhook wired into a project's feedback collector (migration 1076).
 *
 * A team that already gathers requests in Sentry (User Feedback) or PostHog
 * (surveys / `$feedback` events) should not have to re-instrument their app to get
 * them onto this board. This row is the per-tenant configuration behind
 * `/api/feedback-webhooks/:collectorId/:provider`: which provider, and the shared
 * secret its signature is verified against.
 *
 * ── WHY THE SECRET IS ENCRYPTED, NOT HASHED ─────────────────────────────────
 * An ingest key is hashed (`feedback_collectors.key_hash`) because verification
 * only needs to compare a presented key. A webhook secret is different: HMAC
 * verification has to RECOMPUTE the digest over the raw body, which needs the
 * secret itself. So it is encrypted at rest with the same tenant-salted AES-GCM
 * envelope every other stored credential uses (`credentialCrypto`), and the
 * ciphertext/IV pair is split across two columns exactly like
 * `error_collector_integrations`.
 *
 * ── TENANCY ─────────────────────────────────────────────────────────────────
 * `tenant_id` is carried directly rather than reached through `collector_id`. The
 * tenant-scope guard can only check a predicate it can SEE on the table being
 * queried, and this row decrypts a secret — a child that reaches its tenant
 * through a join is unscoped by construction, and one forgotten join condition
 * would decrypt another workspace's secret under this tenant's salt.
 */
export const feedbackCollectorIntegrations = pgTable('feedback_collector_integrations', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull(),
  collectorId: uuid('collector_id').notNull().references(() => feedbackCollectors.id, { onDelete: 'cascade' }),
  /** 'sentry' | 'posthog' — must match a feedbackProviders.ts adapter id. */
  provider:    varchar('provider', { length: 32 }).notNull(),
  /** AES-GCM ciphertext of `{ secret }`, tenant-salted. Never returned to a client. */
  secretEnc:   text('secret_enc'),
  secretIv:    varchar('secret_iv', { length: 32 }),
  /** Pausing an integration stops imports without discarding the secret, so a
   *  noisy provider can be silenced and resumed without re-configuring it there. */
  enabled:     boolean('enabled').notNull().default(true),
  lastEventAt: timestamp('last_event_at'),
  createdBy:   varchar('created_by', { length: 36 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  // One integration per (collector, provider) — a second row would make "the
  // secret for Sentry on this collector" a question with two answers, and
  // verification would then depend on which one the query happened to return.
  uqProvider: uniqueIndex('uq_feedback_collector_integration').on(t.collectorId, t.provider),
  byTenant:   index('idx_feedback_collector_integrations_tenant').on(t.tenantId),
}));


/**
 * One accepted provider webhook delivery, keyed by the PROVIDER's event id
 * (migration 1077) — the replay guard.
 *
 * Webhook senders retry: on a timeout, on a 5xx, and sometimes just because. Every
 * accepted delivery here can open a backlog ticket, so an at-least-once sender
 * meeting a non-idempotent receiver puts duplicate cards in front of a human. The
 * submission fingerprint cannot close this on its own — it collapses identical
 * PROSE, whereas a retry is the same EVENT and must collapse even when the
 * provider edited the payload between attempts (a resolved issue, a re-sent
 * survey answer).
 *
 * The unique index IS the guard: the route inserts first and treats a unique
 * violation as "already handled", so two concurrent retries cannot both pass a
 * read-then-write check.
 */
export const feedbackWebhookDeliveries = pgTable('feedback_webhook_deliveries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull(),
  collectorId:  uuid('collector_id').notNull().references(() => feedbackCollectors.id, { onDelete: 'cascade' }),
  provider:     varchar('provider', { length: 32 }).notNull(),
  /** The provider's own delivery id, or a SHA-256 of the raw body when it sends none. */
  eventId:      varchar('event_id', { length: 200 }).notNull(),
  /** The submission this delivery produced; null when it normalized to nothing
   *  (an event we do not import), which still gets recorded so retries stay cheap. */
  submissionId: uuid('submission_id').references(() => feedbackSubmissions.id, { onDelete: 'set null' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqDelivery: uniqueIndex('uq_feedback_webhook_delivery').on(t.collectorId, t.provider, t.eventId),
  byTenant:   index('idx_feedback_webhook_deliveries_tenant').on(t.tenantId, t.createdAt),
}));


// =========================================================================
// The root entity. `DOMAIN_MANIFEST` names `ticket` as this seat’s rootKind and
// `support_tickets` IS it — declared, until this move, in `commerce.ts`, three
// modules away from `support_articles` and from the sentiment that classifies it.
// `support.first_response_min`, one of this seat’s three charted metrics, is read
// off the column below.
//
// `tenant_id` and `segment_id` travelled as plain ids — this module takes no
// sibling imports beyond the kernel, and the FKs are declared in the migration.
// =========================================================================

/** A customer-support ticket — Support Issues / Tech Support Tix / Support-Tix-
 *  per-Customer (distinct customerRef). `isBug` flags the post-production-bug
 *  subset. Fed by Freshservice/ServiceNow poll (boardsync) keyed by externalRef,
 *  or entered manually. */
export const supportTickets = pgTable('support_tickets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull(),
  segmentId:   uuid('segment_id'),
  source:      varchar('source', { length: 24 }).notNull().default('manual'), // freshservice | servicenow | zendesk | manual
  externalRef: varchar('external_ref', { length: 255 }),
  subject:     varchar('subject', { length: 512 }),
  category:    varchar('category', { length: 24 }).notNull().default('other'), // bug | how_to | billing | feature_request | other
  isBug:       boolean('is_bug').notNull().default(false),
  priority:    varchar('priority', { length: 16 }).notNull().default('normal'),
  status:      varchar('status', { length: 16 }).notNull().default('open'),
  customerRef: varchar('customer_ref', { length: 255 }),
  openedAt:    timestamp('opened_at').notNull().defaultNow(),
  /** When the help desk recorded the FIRST agent reply (0941) — the provider's own
   *  clock, never our poll time, because it is what the customer experienced.
   *  NULL = never answered, or the provider does not report one; excluded from
   *  `support.first_response_min` rather than counted as an instant answer. */
  firstRespondedAt: timestamp('first_responded_at'),
  resolvedAt:  timestamp('resolved_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byOpened: index('idx_support_tickets_opened').on(t.tenantId, t.openedAt),
  byFirstResponse: index('idx_support_tickets_first_response').on(t.tenantId, t.firstRespondedAt),
  byBug:    index('idx_support_tickets_bug').on(t.tenantId, t.isBug),
  uqExternal: uniqueIndex('uq_support_tickets_external').on(t.tenantId, t.source, t.externalRef),
}));
