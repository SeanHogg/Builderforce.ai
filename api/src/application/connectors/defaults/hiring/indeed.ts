import type { ConnectorManifest } from '../../connectorManifest';
import { b } from '../dsl';
import { POSTING_PARAMS } from './shared';

export const indeedSponsored: ConnectorManifest = {
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
  // Indeed publishes no per-job public link for a sourced posting (no `url` selector, no
  // `urlTemplate`), and its `list_applications` takes no query, so it declares no
  // `applicants` mapping — nothing here is invented to make it look importable.
  sourceAliases: ['indeed', 'indeed.com', 'indeed jobs', 'indeed sponsored'],
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
