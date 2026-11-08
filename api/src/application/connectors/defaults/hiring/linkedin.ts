import type { ConnectorManifest } from '../../connectorManifest';
import { b, q } from '../dsl';
import { POSTING_PARAMS } from './shared';

export const linkedinJobs: ConnectorManifest = {
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
      // A LinkedIn job is posted UNDER an organisation. The URN is a connection
      // fact, not a requisition fact — the same company for every role this
      // connection publishes — so it is collected here (Gusto's company_id, the
      // same pattern) rather than asked of each distribute call. `create_posting`
      // defaults `company_id` from it; `distributePosting` passes that value and
      // refuses to publish when it is absent, instead of posting with no company.
      {
        key: 'company_id',
        label: 'Organisation URN',
        secret: false,
        required: true,
        placeholder: 'urn:li:organization:123456',
        help: 'The LinkedIn organisation the job is posted under (Jobs → Company). A posting cannot go out without it.',
      },
    ],
  },
  sourceAliases: ['linkedin', 'linkedin.com', 'linkedin jobs', 'linked in'],
  actions: [
    {
      key: 'create_posting', label: 'Publish posting', description: 'Publish a job to LinkedIn Jobs.',
      method: 'POST', path: '/simpleJobPostings', mutates: true, required: ['title', 'description'],
      params: {
        ...POSTING_PARAMS,
        company_id: b('LinkedIn organisation URN the job is posted under', { default: '{{auth.company_id}}' }),
      },
      // A batch create: `{ elements: [{ id, status, error? }] }`, one element per job,
      // with the per-job failure inside an element of a `200`. Rest.li also carries a
      // single created id in `x-restli-id`, kept as the fallback.
      response: {
        externalId: ['elements.0.id', 'header:x-restli-id'],
        // The public job page is addressed by the numeric job id. The create call is
        // asynchronous and answers with a TASK urn (`urn:li:simpleJobPostingTask:…`), not a
        // job id (that comes from the task-status read later), so the template fires only
        // for a purely numeric id and is withheld for the URN.
        urlTemplate: 'https://www.linkedin.com/jobs/view/{externalId}',
        externalIdPattern: '\\d+',
        error: ['elements.0.error.message', 'message'],
      },
    },
    {
      // The create call returns a TASK urn. Its status read returns, once LinkedIn has
      // processed the job, `jobPosting: "urn:li:jobPosting:<id>"` — the numeric id the
      // public page (/jobs/view/<id>) is addressed by. The stored task urn is then
      // REPLACED by that id, so later closes and updates target the job, not the task.
      // Rest.li 2.0 takes a batch key as `ids=List(<urlencoded urn>)`, not a bare urn.
      key: 'resolve_url', label: 'Find public link', description: 'Read a publish task\'s status and the job it produced.',
      method: 'GET', path: '/simpleJobPostingTasks', mutates: false,
      headers: { 'LinkedIn-Version': '202604', 'X-Restli-Protocol-Version': '2.0.0' },
      params: { ids: q('The task urn the create call returned') },
      resolve: {
        idParam: 'ids',
        idEncoding: 'restli-list',
        listPath: 'results',
        matchField: 'id',
        equals: '{externalId}',
        resolvedId: ['jobPosting'],
        resolvedIdPattern: 'urn:li:jobPosting:(\\d+)',
        urlTemplate: 'https://www.linkedin.com/jobs/view/{externalId}',
      },
    },
    {
      key: 'close_posting', label: 'Close posting', description: 'Close a live job posting.',
      method: 'POST', path: '/simpleJobPostings', mutates: true, required: ['external_id'],
      params: { external_id: b('Your posting id'), status: b('Set to "CLOSED"') },
    },
  ],
};
