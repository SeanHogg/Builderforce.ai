/**
 * Built-in connectors — job distribution and applicant sources.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────────
 * The canvas gained a `jobPosting` object and the hiring domain already had
 * `job_items` and `job_websites`, and there was no way to PUBLISH a requisition
 * anywhere: `defaults/` shipped communication, twilio, business, productivity,
 * devtools, generic and social, and nothing that puts a role in front of a candidate.
 * So "post this role" — the action that starts every search — terminated in a document,
 * `job_applications` had no producer, and applicant volume was zero by construction.
 *
 * ── OUTBOUND, NOT INBOUND ────────────────────────────────────────────────────────
 * Deliberately distinct from the HRMS/ATS READER the register asks for separately: that
 * one reads a customer's existing Greenhouse or Workday roster, this one WRITES a
 * posting outward and reads back the applications it produced. A tenant will commonly
 * have both, pointed at different systems, and collapsing them would make "where do our
 * applications come from" unanswerable.
 *
 * ── WHY THESE ARE MANIFESTS AND NOT CODE ─────────────────────────────────────────
 * Migration 0410 made a connector DATA. Adding Otta, Welcome to the Jungle or a
 * country-specific board is an entry in this file — reviewed like data, validated by
 * the same `parseConnectorManifest` gate tenant-authored connectors pass, and shipped
 * without a new code path. Every call is credentialled per tenant and audited, because
 * it goes through `connectorTools.ts` like every other connector call.
 *
 * ── THE FEED CONNECTOR IS THE IMPORTANT ONE ──────────────────────────────────────
 * `job-feed` has no vendor at all: it publishes the tenant's own postings as an
 * indexable XML/JSON feed at a URL, which is how every aggregator that has no partner
 * API ingests roles. It is the connector that works for the boards not listed here, and
 * it is why this file is not a race to enumerate vendors.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, bb, bn, p, q, qn } from './dsl';

/**
 * The shared posting body, declared once.
 *
 * Every board takes the same nine facts about a job — they disagree only on field names,
 * which is what the manifest's `path`/`params` mapping is for. Writing them out per
 * vendor is how three boards come to advertise slightly different requisition shapes.
 */
const POSTING_PARAMS = {
  title: b('Job title as candidates search for it — "Senior React Engineer", not "Engineer III"'),
  description: b('Full posting body. HTML is accepted by every board here; plain text is safest.'),
  location: b('City and country, or "Remote" plus the timezones or countries the role is open to'),
  employment_type: b('permanent | fixed-term | contract | part-time | internship'),
  seniority: b('Seniority as the posting states it — graduate | junior | mid | senior | lead | staff | principal'),
  salary_min: bn('Lower bound of the published band, in major units. Required in jurisdictions with pay-transparency law.'),
  salary_max: bn('Upper bound of the published band, in major units'),
  salary_currency: b('ISO-4217 code for the band, e.g. "EUR"'),
  remote: bb('True when the role can be done fully remotely'),
  apply_url: b('Where an applicant lands. Point this at the tenant careers page so the application is captured, not at an email address.'),
  external_id: b('The tenant-side posting id, echoed back on every application so a candidate can be attributed to the board that produced them'),
} as const;

const greenhouseJobBoard: ConnectorManifest = {
  key: 'greenhouse-job-board',
  name: 'Greenhouse Job Board',
  description: 'Publish requisitions to a Greenhouse job board and read the applications they produce.',
  category: 'hiring',
  icon: '🌱',
  baseUrl: 'https://harvest.greenhouse.io/v1',
  docsUrl: 'https://developers.greenhouse.io/harvest.html',
  auth: {
    kind: 'basic',
    fields: [{ key: 'username', label: 'Harvest API key', secret: true, required: true, help: 'Greenhouse → Configure → Dev Center → API Credential Management. Used as the basic-auth username with an empty password.' }],
  },
  actions: [
    {
      key: 'create_posting', label: 'Publish posting', description: 'Create a job post on the board.',
      method: 'POST', path: '/jobs', mutates: true, required: ['title', 'description'],
      params: POSTING_PARAMS,
      // Harvest answers `201` with the created job object, whose `id` is the job. The
      // job object carries no public URL — that belongs to the job POST on a board,
      // which is a separate record — so none is declared rather than one guessed.
      response: { externalId: ['id'], error: ['errors.0.message', 'message'] },
    },
    {
      key: 'update_posting', label: 'Update posting', description: 'Amend a live posting in place.',
      method: 'PATCH', path: '/jobs/{job_id}', mutates: true, required: ['job_id'],
      params: { job_id: p('Greenhouse job id'), ...POSTING_PARAMS },
    },
    {
      key: 'close_posting', label: 'Close posting', description: 'Take a posting down.',
      method: 'PATCH', path: '/jobs/{job_id}', mutates: true, required: ['job_id'],
      params: { job_id: p('Greenhouse job id'), status: b('Set to "closed"') },
    },
    {
      key: 'list_applications', label: 'List applications', description: 'Read applications received against a posting.',
      method: 'GET', path: '/applications', mutates: false, resultPath: 'applications',
      params: { job_id: qn('Restrict to one job'), created_after: q('ISO instant — only applications after this'), per_page: qn('Page size (default 100)') },
    },
  ],
};

const leverPostings: ConnectorManifest = {
  key: 'lever-postings',
  name: 'Lever Postings',
  description: 'Publish and manage postings in Lever, and read their opportunities.',
  category: 'hiring',
  icon: '🎚️',
  baseUrl: 'https://api.lever.co/v1',
  docsUrl: 'https://hire.lever.co/developer/documentation',
  auth: {
    kind: 'basic',
    fields: [{ key: 'username', label: 'Lever API key', secret: true, required: true, help: 'Lever → Settings → Integrations → API credentials. Used as the basic-auth username.' }],
  },
  actions: [
    {
      key: 'create_posting', label: 'Publish posting', description: 'Create a Lever posting.',
      method: 'POST', path: '/postings', mutates: true, required: ['title', 'description'],
      params: POSTING_PARAMS,
      // `{ data: { id, urls: { list, show, apply } } }` — `show` is the public posting.
      response: { externalId: ['data.id'], url: ['data.urls.show', 'data.urls.apply'], error: ['message'] },
    },
    {
      key: 'list_postings', label: 'List postings', description: 'Read the tenant\'s postings and their states.',
      method: 'GET', path: '/postings', mutates: false, resultPath: 'data',
      params: { state: q('published | internal | closed | draft'), limit: qn('Page size (default 100)') },
    },
    {
      key: 'list_opportunities', label: 'List applicants', description: 'Read the people who applied.',
      method: 'GET', path: '/opportunities', mutates: false, resultPath: 'data',
      params: { posting_id: q('Restrict to one posting'), updated_at_start: q('Epoch ms — only records changed since'), limit: qn('Page size (default 100)') },
    },
  ],
};

const ashbyPostings: ConnectorManifest = {
  key: 'ashby-postings',
  name: 'Ashby',
  description: 'Publish requisitions to Ashby and read applications back.',
  category: 'hiring',
  icon: '🪵',
  baseUrl: 'https://api.ashbyhq.com',
  docsUrl: 'https://developers.ashbyhq.com',
  auth: {
    kind: 'basic',
    fields: [{ key: 'username', label: 'Ashby API key', secret: true, required: true, help: 'Ashby → Admin → API Keys. Used as the basic-auth username with an empty password.' }],
  },
  actions: [
    {
      key: 'create_posting', label: 'Publish posting', description: 'Create a job posting.',
      method: 'POST', path: '/jobPosting.create', mutates: true, required: ['title', 'description'],
      params: POSTING_PARAMS,
      // Ashby answers every RPC `200 { success, results }` and reports a refusal as
      // `200 { success: false, errors: [...] }` (or `errorInfo`), which is why `error`
      // is declared: trusting the status would read a refused posting as a live one.
      response: {
        externalId: ['results.id'],
        url: ['results.externalLink', 'results.applyLink'],
        error: ['errorInfo.message', 'errors.0'],
      },
    },
    {
      key: 'list_postings', label: 'List postings', description: 'Read published postings.',
      method: 'POST', path: '/jobPosting.list', mutates: false, resultPath: 'results',
      params: { listed_only: bb('Only postings currently listed publicly') },
    },
    {
      key: 'list_applications', label: 'List applications', description: 'Read applications received.',
      method: 'POST', path: '/application.list', mutates: false, resultPath: 'results',
      params: { job_id: b('Restrict to one job'), created_after: b('ISO instant'), limit: bn('Page size') },
    },
  ],
};

const indeedSponsored: ConnectorManifest = {
  key: 'indeed-jobs',
  name: 'Indeed',
  description: 'Publish roles to Indeed and read the applications they produce.',
  category: 'hiring',
  icon: '🔎',
  baseUrl: 'https://apis.indeed.com',
  docsUrl: 'https://docs.indeed.com',
  auth: {
    kind: 'oauth2',
    fields: [
      { key: 'client_id', label: 'Client ID', secret: false, required: true, help: 'Indeed → Developer portal → your app' },
      { key: 'client_secret', label: 'Client secret', secret: true, required: true },
    ],
  },
  actions: [
    {
      // One GraphQL endpoint for both actions — the operation is carried in the body,
      // not the path, which is why they share it. `path` must still be a real segment:
      // an empty path is how a manifest silently posts to the base URL.
      key: 'create_posting', label: 'Publish posting', description: 'Publish a job to Indeed.',
      method: 'POST', path: '/graphql', mutates: true, required: ['title', 'description'],
      params: POSTING_PARAMS,
      // Job Sync's `createSourcedJobPostings` mutation. GraphQL reports failure in a
      // `200` body's `errors`, so the error selector is what keeps a refused posting from
      // reading as live. Indeed returns no public URL for a sourced posting.
      response: {
        externalId: ['data.jobsIngest.createSourcedJobPostings.results.0.jobPosting.sourcedPostingId'],
        error: ['errors.0.message'],
      },
    },
    {
      key: 'list_applications', label: 'List applications', description: 'Read applications delivered by Indeed.',
      method: 'POST', path: '/graphql', mutates: false, resultPath: 'data',
      params: { job_id: b('Restrict to one job'), since: b('ISO instant') },
    },
  ],
};

const linkedinJobs: ConnectorManifest = {
  key: 'linkedin-jobs',
  name: 'LinkedIn Jobs',
  description: 'Publish requisitions to LinkedIn Jobs. Distinct from the LinkedIn social connector, which posts to a company page.',
  category: 'hiring',
  icon: '💼',
  baseUrl: 'https://api.linkedin.com/rest',
  docsUrl: 'https://learn.microsoft.com/en-us/linkedin/talent/job-postings',
  auth: {
    kind: 'oauth2',
    fields: [
      { key: 'client_id', label: 'Client ID', secret: false, required: true },
      { key: 'client_secret', label: 'Client secret', secret: true, required: true },
    ],
  },
  actions: [
    {
      key: 'create_posting', label: 'Publish posting', description: 'Publish a job to LinkedIn Jobs.',
      method: 'POST', path: '/simpleJobPostings', mutates: true, required: ['title', 'description'],
      params: { ...POSTING_PARAMS, company_id: b('LinkedIn organisation URN the job is posted under') },
      // A batch create: `{ elements: [{ id, status, error? }] }`, one element per job,
      // with the per-job failure inside an element of a `200`. Rest.li also carries a
      // single created id in `x-restli-id`, kept as the fallback.
      response: {
        externalId: ['elements.0.id', 'header:x-restli-id'],
        error: ['elements.0.error.message', 'message'],
      },
    },
    {
      key: 'close_posting', label: 'Close posting', description: 'Close a live job posting.',
      method: 'POST', path: '/simpleJobPostings', mutates: true, required: ['external_id'],
      params: { external_id: b('Your posting id'), status: b('Set to "CLOSED"') },
    },
  ],
};

/**
 * The tenant's OWN feed, and the most useful connector in this file.
 *
 * Most aggregators have no partner API and ingest an indexable feed instead, so one
 * correctly-published feed reaches every board this file does not name — including the
 * regional and niche ones no catalog will ever finish enumerating. It is also the only
 * distribution path that costs nothing and cannot be revoked.
 */
const jobFeed: ConnectorManifest = {
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
    },
  ],
};

export const HIRING_CONNECTORS: readonly ConnectorManifest[] = [
  jobFeed,
  greenhouseJobBoard,
  leverPostings,
  ashbyPostings,
  indeedSponsored,
  linkedinJobs,
];
