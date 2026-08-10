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
