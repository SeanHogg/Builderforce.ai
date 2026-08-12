import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './identity';

export const webSearchSources = pgTable('web_search_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  seedUrl: text('seed_url').notNull(),
  allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
  blockedDomains: jsonb('blocked_domains').$type<string[]>().notNull().default([]),
  maxDepth: integer('max_depth').notNull().default(2),
  crawlDelayMs: integer('crawl_delay_ms').notNull().default(1000),
  perDomainConcurrency: integer('per_domain_concurrency').notNull().default(1),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [unique('uq_web_search_sources_seed').on(t.tenantId, t.seedUrl)]);

export const webSearchFrontier = pgTable('web_search_frontier', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => webSearchSources.id, { onDelete: 'cascade' }),
  url: text('url').notNull(), normalizedUrl: text('normalized_url').notNull(), domain: varchar('domain', { length: 255 }).notNull(),
  depth: integer('depth').notNull().default(0), priority: integer('priority').notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('queued'), attempts: integer('attempts').notNull().default(0),
  nextFetchAt: timestamp('next_fetch_at').notNull().defaultNow(), leaseExpiresAt: timestamp('lease_expires_at'), lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_web_search_frontier_url').on(t.tenantId, t.normalizedUrl),
  index('idx_web_search_frontier_ready').on(t.tenantId, t.status, t.nextFetchAt, t.priority),
  index('idx_web_search_frontier_domain').on(t.tenantId, t.domain, t.status, t.nextFetchAt),
]);

export const webSearchRobots = pgTable('web_search_robots', {
  domain: varchar('domain', { length: 255 }).primaryKey(), body: text('body').notNull().default(''),
  fetchedAt: timestamp('fetched_at').notNull().defaultNow(), expiresAt: timestamp('expires_at').notNull(), fetchStatus: integer('fetch_status').notNull().default(0),
});

export const webSearchDocuments = pgTable('web_search_documents', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  canonicalUrl: text('canonical_url').notNull(), originalUrl: text('original_url').notNull(), title: text('title'), text: text('text').notNull(),
  headings: jsonb('headings').$type<string[]>().notNull().default([]), domain: varchar('domain', { length: 255 }).notNull(), language: varchar('language', { length: 16 }),
  crawlTimestamp: timestamp('crawl_timestamp').notNull().defaultNow(), publicationTimestamp: timestamp('publication_timestamp'), contentHash: varchar('content_hash', { length: 64 }).notNull(),
  httpStatus: integer('http_status').notNull(), contentType: varchar('content_type', { length: 255 }).notNull(), outboundLinks: jsonb('outbound_links').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), author: text('author'), wordCount: integer('word_count').notNull().default(0),
  duplicateOf: uuid('duplicate_of'), nextCrawlAt: timestamp('next_crawl_at'), createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_web_search_documents_url').on(t.tenantId, t.canonicalUrl),
  index('idx_web_search_documents_hash').on(t.tenantId, t.contentHash),
  index('idx_web_search_documents_fresh').on(t.tenantId, t.publicationTimestamp, t.crawlTimestamp),
  index('idx_web_search_documents_domain').on(t.tenantId, t.domain),
]);

export const webSearchTerms = pgTable('web_search_terms', {
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => webSearchDocuments.id, { onDelete: 'cascade' }),
  term: varchar('term', { length: 128 }).notNull(), titleFrequency: integer('title_frequency').notNull().default(0),
  headingFrequency: integer('heading_frequency').notNull().default(0), bodyFrequency: integer('body_frequency').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.documentId, t.term] }), index('idx_web_search_terms_lookup').on(t.tenantId, t.term, t.documentId)]);

export const webSearchRequests = pgTable('web_search_requests', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  query: text('query').notNull(), normalizedQuery: text('normalized_query').notNull(), status: varchar('status', { length: 16 }).notNull().default('queued'),
  resultCount: integer('result_count').notNull().default(0), lastError: text('last_error'), requestedAt: timestamp('requested_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'), completedAt: timestamp('completed_at'), updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [unique('uq_web_search_requests_query').on(t.tenantId, t.normalizedQuery), index('idx_web_search_requests_status').on(t.tenantId, t.status, t.requestedAt)]);

export const webSearchRequestUrls = pgTable('web_search_request_urls', {
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull().references(() => webSearchRequests.id, { onDelete: 'cascade' }),
  frontierId: bigint('frontier_id', { mode: 'number' }).notNull().references(() => webSearchFrontier.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('queued'),
}, (t) => [primaryKey({ columns: [t.tenantId, t.requestId, t.frontierId] }), index('idx_web_search_request_urls_frontier').on(t.tenantId, t.frontierId, t.requestId)]);
