import type { ConnectorManifest } from '../../connectorManifest';
import { q, qn } from '../dsl';
import { POSTING_PARAMS } from './shared';

export const leverPostings: ConnectorManifest = {
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
  sourceAliases: ['lever', 'lever.co', 'jobs.lever.co', 'lever postings'],
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
      params: {
        posting_id: q('Restrict to one posting'), updated_at_start: q('Epoch ms — only records changed since'), limit: qn('Page size (default 100)'),
        offset: q('Opaque paging token — the `next` of the previous page'),
      },
      // Lever pages by an opaque `next` offset (returned beside `data`, with `hasNext`),
      // newest first. `nextToken` feeds it back as `offset`, and a walk that stops at a
      // cap stores it on the publication (`import_resume_token`) and resumes there, so a
      // backlog bigger than one run is worked off across runs. The cursor only moves once
      // a walk reaches the end. Lever's `next`/`offset` contract is from its public
      // reference; it has not been exercised against a live account.
      applicants: {
        postingParam: 'posting_id',
        postingIdField: ['posting', 'applications.0.posting'],
        externalId: ['id'],
        candidateId: ['contact'],
        name: ['name'],
        email: ['emails.0'],
        appliedAt: ['createdAt'],
        limit: { param: 'limit', size: 100 },
        nextToken: { select: ['next'], param: 'offset' },
        order: 'desc',
        cursorParam: 'updated_at_start', cursorFrom: 'appliedAt', cursorFormat: 'epochMs',
      },
    },
  ],
};
