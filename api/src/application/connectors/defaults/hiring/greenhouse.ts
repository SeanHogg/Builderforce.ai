import type { ConnectorManifest } from '../../connectorManifest';
import { b, p, q, qn } from '../dsl';
import { POSTING_PARAMS } from './shared';

export const greenhouseJobBoard: ConnectorManifest = {
  key: 'greenhouse-job-board',
  name: 'Greenhouse Job Board',
  description: 'Publish requisitions to a Greenhouse job board and read the applications they produce.',
  category: 'hiring',
  icon: '🌱',
  baseUrl: 'https://harvest.greenhouse.io/v1',
  docsUrl: 'https://developers.greenhouse.io/harvest.html',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'Harvest API key', secret: true, required: true, help: 'Greenhouse → Configure → Dev Center → API Credential Management. Used as the basic-auth username with an empty password.' },
      // Not a credential: the public job board's slug, which is what the public posting
      // URL is built from. Optional so connections made before this field existed keep
      // working — they simply get no link until the token is added.
      { key: 'board_token', label: 'Job board token', secret: false, required: false, placeholder: 'acme', help: 'The slug in your public board URL (boards.greenhouse.io/<token>). Lets a published posting link to its public page.' },
    ],
  },
  sourceAliases: ['greenhouse', 'greenhouse.io', 'boards.greenhouse.io', 'greenhouse job board'],
  actions: [
    {
      key: 'create_posting', label: 'Publish posting', description: 'Create a job post on the board.',
      method: 'POST', path: '/jobs', mutates: true, required: ['title', 'description'],
      params: POSTING_PARAMS,
      // Harvest answers `201` with the created job object, whose `id` is the JOB id. The
      // public page (boards.greenhouse.io/<token>/jobs/<id>) is addressed by the JOB-POST
      // id, a different record the create answer does not carry. So the link is built
      // only when the answer DOES carry a job-post id (`postId` selectors) and the
      // connection has its board token; otherwise there is no link, never a guessed one
      // that could 404 on a job id.
      response: {
        externalId: ['id'],
        postId: ['job_posts.0.id', 'job_post_id'],
        urlTemplate: 'https://boards.greenhouse.io/{connection.board_token}/jobs/{postId}',
        error: ['errors.0.message', 'message'],
      },
    },
    {
      key: 'update_posting', label: 'Update posting', description: 'Amend a live posting in place.',
      method: 'PATCH', path: '/jobs/{job_id}', mutates: true, required: ['job_id'],
      params: { job_id: p('Greenhouse job id'), ...POSTING_PARAMS },
    },
    {
      // Greenhouse's PUBLIC Job Board API: no credential, a different host, and the one
      // place the job-post link lives. `id` is the job POST id, `internal_job_id` the job
      // id Harvest returns from create, `absolute_url` the public page — so the link is
      // found by matching the stored job id, not guessed from it. `absolute_url` can point
      // at a customer's own careers domain; the link is then withheld (see `linkHosts`).
      key: 'resolve_url', label: 'Find public link', description: 'Find the public page of a published job on the board.',
      method: 'GET', baseUrl: 'https://boards-api.greenhouse.io/v1', path: '/boards/{board_token}/jobs',
      mutates: false, public: true,
      params: { board_token: p('Public job board token', { default: '{{auth.board_token}}' }) },
      resolve: { listPath: 'jobs', matchField: 'internal_job_id', equals: '{externalId}', url: ['absolute_url'] },
    },
    {
      key: 'close_posting', label: 'Close posting', description: 'Take a posting down.',
      method: 'PATCH', path: '/jobs/{job_id}', mutates: true, required: ['job_id'],
      params: { job_id: p('Greenhouse job id'), status: b('Set to "closed"') },
    },
    {
      key: 'list_applications', label: 'List applications', description: 'Read applications received against a posting.',
      method: 'GET', path: '/applications', mutates: false, resultPath: 'applications',
      params: { job_id: qn('Restrict to one job'), created_after: q('ISO instant — only applications after this'), per_page: qn('Page size (default 100)'), page: qn('Page number, from 1') },
      // Harvest nests the person under `candidate` on newer API responses; the
      // selectors fall through harmlessly when it is absent (a person with no name or
      // email is still imported, by id). Applications arrive oldest first; each carries
      // the jobs it is for, which is what the import's guard compares.
      applicants: {
        postingParam: 'job_id',
        postingIdField: ['jobs.0.id'],
        externalId: ['id'],
        candidateId: ['candidate_id', 'candidate.id'],
        firstName: ['candidate.first_name'],
        lastName: ['candidate.last_name'],
        email: ['candidate.email_addresses.0.value'],
        appliedAt: ['applied_at'],
        page: { param: 'page', sizeParam: 'per_page', size: 100 },
        order: 'asc',
        cursorParam: 'created_after', cursorFrom: 'appliedAt', cursorFormat: 'iso',
      },
    },
  ],
};
