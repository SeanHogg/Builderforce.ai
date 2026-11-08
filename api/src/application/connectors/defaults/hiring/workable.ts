import type { ConnectorManifest } from '../../connectorManifest';
import { q, qn } from '../dsl';

/**
 * Workable — IMPORT-ONLY, by what its public API supports.
 *
 * Workable's v3 API (`/spi/v3`) lets a token READ jobs (`GET /jobs`, scope `r_jobs`) and
 * candidates (`GET /candidates?shortcode=…`, scope `r_candidates`); its public reference
 * documents no endpoint that creates a job. So this manifest has NO `create_posting`:
 * `distributableAction` therefore excludes it from the distribute picker automatically,
 * and a faked publish action that could only ever fail is not shipped. Jobs are created
 * in Workable; this connector reads them and the people who applied.
 *
 * A job's `shortcode` is both the filter for its candidates and the path segment of its
 * public page (`apply.workable.com/<account>/j/<shortcode>/`).
 */
export const workable: ConnectorManifest = {
  key: 'workable',
  name: 'Workable',
  description: 'Read Workable jobs and import the candidates who applied. Workable does not accept jobs created through its public API, so postings are created in Workable.',
  category: 'hiring',
  icon: '🧰',
  baseUrl: 'https://{{auth.subdomain}}.workable.com/spi/v3',
  docsUrl: 'https://workable.readme.io/reference',
  auth: {
    kind: 'bearer',
    fields: [
      { key: 'subdomain', label: 'Account subdomain', secret: false, required: true, placeholder: 'acme', help: 'The <subdomain> in <subdomain>.workable.com.' },
      { key: 'token', label: 'API access token', secret: true, required: true, help: 'Workable → Settings → Integrations → Apps → Generate API token (scopes r_jobs and r_candidates).' },
    ],
  },
  sourceAliases: ['workable', 'workable.com', 'apply.workable.com'],
  actions: [
    {
      key: 'list_postings', label: 'List jobs', description: 'Read the account\'s jobs and their states.',
      method: 'GET', path: '/jobs', mutates: false, resultPath: 'jobs',
      params: { state: q('draft | published | archived | closed'), limit: qn('Page size (default 50, max 100)'), since_id: qn('Only jobs with an id at or after this') },
      // A job created in Workable is LINKED to a BuilderForce posting by its shortcode
      // (`linkBoardJob`); the public page is addressed by the same shortcode.
      boardJobs: { externalId: ['shortcode'], title: ['title'], state: ['state'], url: ['url'] },
      response: { urlTemplate: 'https://apply.workable.com/{connection.subdomain}/j/{externalId}/' },
    },
    {
      key: 'list_applications', label: 'List candidates', description: 'Read the candidates who applied to a job.',
      method: 'GET', path: '/candidates', mutates: false, resultPath: 'candidates',
      params: { shortcode: q('The job shortcode'), limit: qn('Page size (default 50, max 100)'), since_id: qn('Only candidates with an id at or after this'), created_after: q('ISO instant — only candidates created after this') },
      // Workable pages by a `paging.next` URL, not a page number, newest first. The URL is
      // never requested (a board must not choose where a credentialled call goes): the
      // `since_id` it carries is taken out and fed back as the `since_id` param, and a walk
      // that stops at a cap stores it (`import_resume_token`) and resumes there. The cursor
      // only moves when a walk reaches the end. UNVERIFIED against a live account: that
      // `paging.next` carries `since_id` is from Workable's public reference. A Workable
      // candidate is one person per job, so its id is both the application's and the person's.
      applicants: {
        postingParam: 'shortcode',
        postingIdField: ['job.shortcode'],
        externalId: ['id'],
        candidateId: ['id'],
        name: ['name'],
        firstName: ['firstname'],
        lastName: ['lastname'],
        email: ['email'],
        appliedAt: ['created_at'],
        limit: { param: 'limit', size: 100 },
        nextToken: { select: ['paging.next'], fromQuery: 'since_id', param: 'since_id' },
        order: 'desc',
        cursorParam: 'created_after', cursorFrom: 'appliedAt', cursorFormat: 'iso',
      },
    },
  ],
};
