import type { ConnectorManifest } from '../../connectorManifest';
import { p, q, qn } from '../dsl';
import { POSTING_PARAMS } from './shared';

/**
 * The tenant's OWN feed, and the most useful connector in this family.
 *
 * Most aggregators have no partner API and ingest an indexable feed instead, so one
 * correctly-published feed reaches every board the catalog does not name — including the
 * regional and niche ones no catalog will ever finish enumerating. It is also the only
 * distribution path that costs nothing and cannot be revoked.
 *
 * Its host is the tenant's own (`{{auth.feed_base_url}}`), so there is no registrable
 * domain a manifest could pin a reported link to; the link is still https-only.
 */
export const jobFeed: ConnectorManifest = {
  key: 'job-feed',
  name: 'Job feed (XML/JSON)',
  description: 'Publish postings as an indexable feed at your own URL — the ingestion path every aggregator without a partner API uses.',
  category: 'hiring',
  icon: '📡',
  baseUrl: '{{auth.feed_base_url}}',
  auth: {
    kind: 'api_key',
    // The key travels as a bearer-style Authorization header rather than a query
    // parameter: a posting write is authenticated, and a credential in a query string
    // is a credential in every access log between here and the careers site.
    in: 'header',
    name: 'Authorization',
    fields: [
      { key: 'feed_base_url', label: 'Feed base URL', secret: false, required: true, placeholder: 'https://careers.example.com/api', help: 'Where your careers site accepts posting writes. The feed it renders is what aggregators crawl.' },
      { key: 'api_key', label: 'API key', secret: true, required: true },
    ],
  },
  actions: [
    {
      // `create_posting`, like every other board here, so "publish this requisition"
      // is one action key across the category and the distribute use case never has to
      // know which board it is talking to. It is still an UPSERT on the wire — the
      // feed is keyed on `external_id`, so re-publishing replaces rather than duplicates.
      key: 'create_posting', label: 'Publish to feed', description: 'Create or replace a posting in the feed by external id.',
      method: 'PUT', path: '/jobs/{external_id}', mutates: true, required: ['external_id', 'title', 'description'],
      params: { ...POSTING_PARAMS, external_id: p('Your posting id — the feed is keyed on it, so re-publishing updates rather than duplicates') },
      // The careers site's own contract: it echoes the posting it now serves. An echo
      // with no id is NOT taken as confirmation, even though the id was ours to begin
      // with — a site that answered 200 and stored nothing must not read as live.
      response: { externalId: ['id', 'external_id', 'job.id'], url: ['url', 'job.url'], error: ['error'] },
    },
    {
      key: 'remove_posting', label: 'Remove from feed', description: 'Drop a posting from the feed.',
      method: 'DELETE', path: '/jobs/{external_id}', mutates: true, required: ['external_id'],
      params: { external_id: p('Your posting id') },
    },
    {
      key: 'list_feed', label: 'Read feed', description: 'Read every posting currently in the feed.',
      method: 'GET', path: '/jobs', mutates: false, resultPath: 'jobs',
      params: { updated_since: q('ISO instant') },
    },
    {
      key: 'list_applications', label: 'List applications', description: 'Read applications the careers site captured.',
      method: 'GET', path: '/applications', mutates: false, resultPath: 'applications',
      params: { external_id: q('Restrict to one posting'), since: q('ISO instant'), limit: qn('Page size') },
      // The feed's own contract: oldest first, `limit` per call, `since` as the cursor.
      applicants: {
        postingParam: 'external_id',
        postingIdField: ['external_id', 'job_id', 'job.id'],
        externalId: ['id'],
        candidateId: ['candidate.id', 'candidate_id'],
        name: ['name', 'candidate.name'],
        email: ['email', 'candidate.email'],
        appliedAt: ['applied_at', 'created_at'],
        limit: { param: 'limit', size: 100 },
        order: 'asc',
        cursorParam: 'since', cursorFrom: 'appliedAt', cursorFormat: 'iso',
      },
    },
  ],
};
