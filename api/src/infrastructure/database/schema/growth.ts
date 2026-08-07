/**
 * Growth context — what happens to a published site AFTER it goes live.
 *
 * Three previously-missing halves of "idea → delivered outcome", grouped
 * because they are one chain and nothing else depends on them:
 *
 *   traffic      — `site_traffic_daily`, the per-site/per-day request rollup
 *                  that turns "we shipped it" into "people used it".
 *   site backend — `site_collections` / `site_records`: a published static
 *                  site's public write endpoint and the rows it collects, so a
 *                  contact form on a deployed page has somewhere to post.
 *   marketing    — audiences, verified sender identities, suppression, campaigns
 *                  and the per-recipient send ledger, so a tenant can market the
 *                  thing they just built.
 *
 * Deliberately NOT `sales_campaigns` (commerce.ts / migration 0401) — that is
 * the Builderforce referral team's own CRM, scoped to a user with hand-typed
 * counters. Everything here is tenant-scoped and machine-maintained.
 *
 * This file imports from work/identity/collaboration and nothing imports it, so
 * the schema barrel stays acyclic. See migration 0412.
 */

import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { creationSessions } from './collaboration';
import { tenants } from './identity';
import { projects, projectSites } from './work';

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

/**
 * Per-site, per-UTC-day request rollup.
 *
 * A row per request would put a database write on the worker's hottest path and
 * dominate Neon cost, so the hosting middleware buffers counts in-isolate and
 * flushes an additive UPSERT (`application/ide/siteTraffic.ts`). `visitors` is
 * approximate by construction — it counts distinct daily visitor hashes an
 * isolate observed, so concurrent isolates can double-count a visitor. The UI
 * labels it as approximate rather than pretending otherwise.
 */
export const siteTrafficDaily = pgTable('site_traffic_daily', {
  id:          serial('id').primaryKey(),
  siteId:      integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  day:         date('day').notNull(),
  pageViews:   integer('page_views').notNull().default(0),
  assetHits:   integer('asset_hits').notNull().default(0),
  visitors:    integer('visitors').notNull().default(0),
  bytesServed: bigint('bytes_served', { mode: 'number' }).notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_site_traffic_daily_site_day').on(t.siteId, t.day),
  index('idx_site_traffic_daily_tenant_day').on(t.tenantId, t.day),
  index('idx_site_traffic_daily_project_day').on(t.projectId, t.day),
]);

// ---------------------------------------------------------------------------
// Site backend
// ---------------------------------------------------------------------------

/**
 * A named public write endpoint on a published site, served at
 * `https://<site-host>/__api/collections/<name>`.
 *
 * Reads are never public — exposing a GET would hand every visitor the whole
 * submission list. The owner reads records back through the authenticated
 * project API instead.
 */
export const siteCollections = pgTable('site_collections', {
  id:                   serial('id').primaryKey(),
  siteId:               integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:            integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:                 varchar('name', { length: 64 }).notNull(),
  acceptsPublicWrites:  boolean('accepts_public_writes').notNull().default(true),
  /** When set, a submission carrying an `email` also lands in this audience. */
  audienceId:           integer('audience_id'),
  /** Per-collection daily write ceiling; 0 = use the platform default. */
  dailyWriteCap:        integer('daily_write_cap').notNull().default(0),
  recordCount:          integer('record_count').notNull().default(0),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_site_collections_site_name').on(t.siteId, t.name),
  index('idx_site_collections_tenant').on(t.tenantId),
  index('idx_site_collections_project').on(t.projectId),
]);

/** One public submission. `ipHash` is a salted hash — rate limiting and dedupe
 *  without ever storing a visitor's IP address. */
export const siteRecords = pgTable('site_records', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  collectionId: integer('collection_id').notNull().references(() => siteCollections.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  payload:      jsonb('payload').notNull().default({}),
  email:        varchar('email', { length: 320 }),
  ipHash:       varchar('ip_hash', { length: 64 }),
  userAgent:    varchar('user_agent', { length: 500 }),
  referrer:     varchar('referrer', { length: 1000 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_site_records_collection_time').on(t.collectionId, t.createdAt),
  index('idx_site_records_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_site_records_email').on(t.email),
]);

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

/**
 * A verified `From:` identity. A campaign cannot send until `status='verified'`,
 * so a tenant can never send as a domain they do not control. Ownership is
 * proven with a TXT record resolved over DNS-over-HTTPS — the same verifier the
 * custom-domain flow uses (`application/ide/dnsVerification.ts`).
 */
export const marketingSenderIdentities = pgTable('marketing_sender_identities', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  fromEmail:   varchar('from_email', { length: 320 }).notNull(),
  fromName:    varchar('from_name', { length: 255 }).notNull().default(''),
  replyTo:     varchar('reply_to', { length: 320 }),
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  verifyToken: varchar('verify_token', { length: 64 }).notNull(),
  verifiedAt:  timestamp('verified_at'),
  lastError:   text('last_error'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_sender_tenant_email').on(t.tenantId, t.fromEmail),
]);

export const marketingAudiences = pgTable('marketing_audiences', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  memberCount: integer('member_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_audiences_tenant').on(t.tenantId, t.updatedAt),
]);

/** Membership is never deleted on unsubscribe — the row IS the record that
 *  consent was withdrawn, and deleting it would let a re-import resurrect them. */
export const marketingAudienceMembers = pgTable('marketing_audience_members', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  audienceId: integer('audience_id').notNull().references(() => marketingAudiences.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 320 }).notNull(),
  name:       varchar('name', { length: 255 }).notNull().default(''),
  status:     varchar('status', { length: 16 }).notNull().default('subscribed'),
  source:     varchar('source', { length: 32 }).notNull().default('manual'),
  attributes: jsonb('attributes').notNull().default({}),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_audience_member').on(t.audienceId, t.email),
  index('idx_marketing_audience_members_tenant').on(t.tenantId),
]);

/** Tenant-wide do-not-contact, checked at send time regardless of audience. */
export const marketingSuppressions = pgTable('marketing_suppressions', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:     varchar('email', { length: 320 }).notNull(),
  reason:    varchar('reason', { length: 32 }).notNull().default('unsubscribed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_suppressions_tenant_email').on(t.tenantId, t.email),
]);

export const marketingCampaigns = pgTable('marketing_campaigns', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  audienceId:       integer('audience_id').notNull().references(() => marketingAudiences.id, { onDelete: 'cascade' }),
  senderIdentityId: integer('sender_identity_id').references(() => marketingSenderIdentities.id, { onDelete: 'set null' }),
  name:             varchar('name', { length: 255 }).notNull(),
  subject:          varchar('subject', { length: 500 }).notNull().default(''),
  bodyHtml:         text('body_html').notNull().default(''),
  status:           varchar('status', { length: 16 }).notNull().default('draft'),
  scheduledAt:      timestamp('scheduled_at'),
  startedAt:        timestamp('started_at'),
  completedAt:      timestamp('completed_at'),
  recipients:       integer('recipients').notNull().default(0),
  sent:             integer('sent').notNull().default(0),
  failed:           integer('failed').notNull().default(0),
  suppressed:       integer('suppressed').notNull().default(0),
  opened:           integer('opened').notNull().default(0),
  clicked:          integer('clicked').notNull().default(0),
  /** Launching session, so campaign delivery rolls up into the SAME outcome
   *  ledger as the site it markets. */
  sessionId:        uuid('session_id').references(() => creationSessions.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_campaigns_tenant_status').on(t.tenantId, t.status, t.updatedAt),
]);

/** One row per (campaign, recipient). The unique index is what makes a resumed
 *  or retried send idempotent — a second pass cannot email the same person twice. */
export const marketingCampaignSends = pgTable('marketing_campaign_sends', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => marketingCampaigns.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 320 }).notNull(),
  status:     varchar('status', { length: 16 }).notNull().default('queued'),
  error:      text('error'),
  /** Opaque per-recipient token behind the open pixel, click links and the
   *  one-click unsubscribe. Unique so a token resolves to exactly one send. */
  trackToken: varchar('track_token', { length: 64 }).notNull(),
  openedAt:   timestamp('opened_at'),
  clickedAt:  timestamp('clicked_at'),
  sentAt:     timestamp('sent_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_sends_campaign_email').on(t.campaignId, t.email),
  uniqueIndex('uq_marketing_sends_token').on(t.trackToken),
  index('idx_marketing_sends_campaign_status').on(t.campaignId, t.status),
]);
