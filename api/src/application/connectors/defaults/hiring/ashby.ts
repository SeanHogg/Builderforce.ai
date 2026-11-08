import type { ConnectorManifest } from '../../connectorManifest';
import { b, bb, bn } from '../dsl';
import { POSTING_PARAMS } from './shared';

export const ashbyPostings: ConnectorManifest = {
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
  sourceAliases: ['ashby', 'ashbyhq', 'ashbyhq.com', 'jobs.ashbyhq.com'],
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
      // The stored publication id is a job-POSTING id (`jobPosting.create` / `.list`), but
      // `application.list` filters on the JOB id. `applicants.filterIdFrom` below calls this
      // action once to turn one into the other.
      // UNVERIFIED against the live Ashby API (no credentials available when this was
      // written): the `jobPosting.info` request/response shape, `results.jobId`, is from
      // Ashby's public reference.
      key: 'get_posting', label: 'Read posting', description: 'Read one job posting, including the job it belongs to.',
      method: 'POST', path: '/jobPosting.info', mutates: false, resultPath: 'results',
      params: { jobPostingId: b('The job posting id the create call returned') },
    },
    {
      // Ashby's RPC bodies are camelCase: `jobId` and `createdAfter` (epoch ms).
      key: 'list_applications', label: 'List applications', description: 'Read applications received.',
      method: 'POST', path: '/application.list', mutates: false, resultPath: 'results',
      params: { jobId: b('Restrict to one job'), createdAfter: bn('Epoch ms — only applications created after this'), limit: bn('Page size') },
      // Applications arrive oldest first and Ashby pages by an opaque cursor, so a run
      // reads ONE page of `limit`; a full page means more are waiting, and because the
      // order is ascending the cursor (`createdAfter`) moves forward after every run, so
      // a backlog is worked off across runs.
      applicants: {
        postingParam: 'jobId',
        filterIdFrom: { action: 'get_posting', idParam: 'jobPostingId', select: ['jobId'] },
        postingIdField: ['job.id'],
        externalId: ['id'],
        candidateId: ['candidate.id'],
        name: ['candidate.name'],
        email: ['candidate.primaryEmailAddress.value'],
        appliedAt: ['createdAt'],
        limit: { param: 'limit', size: 100 },
        order: 'asc',
        cursorParam: 'createdAfter', cursorFrom: 'appliedAt', cursorFormat: 'epochMs',
      },
    },
  ],
};
