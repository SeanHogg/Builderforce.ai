/**
 * Public URLs built from a manifest's `urlTemplate` — the contract is that a template
 * with any hole yields NO url, never a broken one.
 */
import { describe, expect, it } from 'vitest';
import { HIRING_CONNECTORS } from './defaults/hiring';
import { parseConnectorManifest } from './connectorManifest';
import { manifestYieldsPublicLink, mappingYieldsUrl, renderUrlTemplate, responseHeaderNames } from './connectorResponseMapping';
import { templateConnectionFields } from './connectorMappingValidators';
import { derivedUrl } from '../hiring/postingDistributionSupport';

const publishMapping = (key: string) =>
  HIRING_CONNECTORS.find((m) => m.key === key)!.actions.find((a) => a.key === 'create_posting')!.response;

describe('renderUrlTemplate', () => {
  const greenhouse = publishMapping('greenhouse-job-board')?.urlTemplate;
  const linkedin = publishMapping('linkedin-jobs');

  it('fills the job-post id and a connection field', () => {
    expect(renderUrlTemplate(greenhouse, { externalId: '4012', postId: '77', connection: { board_token: 'acme' } }))
      .toBe('https://boards.greenhouse.io/acme/jobs/77');
  });

  it('does not fire for Greenhouse without a job-post id — the JOB id would 404', () => {
    expect(renderUrlTemplate(greenhouse, { externalId: '4012', connection: { board_token: 'acme' } })).toBeNull();
  });

  it('is null when the connection field is missing or blank — never a link with a hole', () => {
    expect(renderUrlTemplate(greenhouse, { externalId: '4012', postId: '77', connection: {} })).toBeNull();
    expect(renderUrlTemplate(greenhouse, { externalId: '4012', postId: '77', connection: { board_token: '  ' } })).toBeNull();
  });

  it('needs exactly the ids its template names: the post id for Greenhouse, the job id for LinkedIn', () => {
    // The Greenhouse template is addressed by the job-POST id and never mentions
    // {externalId}, so the stored job id is irrelevant to it — a link needs `postId`.
    expect(renderUrlTemplate(greenhouse, { externalId: null, postId: '1', connection: { board_token: 'acme' } }))
      .toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(renderUrlTemplate(greenhouse, { externalId: '4012', postId: null, connection: { board_token: 'acme' } })).toBeNull();
    // LinkedIn's names {externalId}: without one there is no link.
    expect(renderUrlTemplate(linkedin?.urlTemplate, { externalId: null, externalIdPattern: linkedin?.externalIdPattern, connection: {} })).toBeNull();
  });

  it('is null with no template', () => {
    expect(renderUrlTemplate(undefined, { externalId: '1', connection: {} })).toBeNull();
  });

  it('percent-encodes values so a field cannot add path or query structure', () => {
    expect(renderUrlTemplate(greenhouse, { externalId: '1', postId: '1', connection: { board_token: 'a/b?x=1' } }))
      .toBe('https://boards.greenhouse.io/a%2Fb%3Fx%3D1/jobs/1');
  });

  it('builds the LinkedIn link for a numeric job id only, never for the task URN', () => {
    const pattern = linkedin?.externalIdPattern;
    expect(renderUrlTemplate(linkedin?.urlTemplate, { externalId: '3912345', externalIdPattern: pattern, connection: {} }))
      .toBe('https://www.linkedin.com/jobs/view/3912345');
    expect(renderUrlTemplate(linkedin?.urlTemplate, { externalId: 'urn:li:simpleJobPostingTask:3', externalIdPattern: pattern, connection: {} }))
      .toBeNull();
  });

  it('builds the Workable link from the shortcode and the account subdomain', () => {
    const workable = HIRING_CONNECTORS.find((m) => m.key === 'workable')!.actions.find((a) => a.key === 'list_postings')!;
    expect(renderUrlTemplate(workable.response?.urlTemplate, { externalId: 'ABC123', connection: { subdomain: 'acme' } }))
      .toBe('https://apply.workable.com/acme/j/ABC123/');
  });
});

describe('manifests', () => {
  it('Indeed declares no link at all, by design; Greenhouse and LinkedIn do', () => {
    expect(mappingYieldsUrl(publishMapping('indeed-jobs'))).toBe(false);
    expect(mappingYieldsUrl(publishMapping('greenhouse-job-board'))).toBe(true);
    expect(mappingYieldsUrl(publishMapping('linkedin-jobs'))).toBe(true);
  });

  it('a board counts as link-capable by ANY declared route: publish url, resolve_url, or a linked job’s link', () => {
    const can = (key: string) => manifestYieldsPublicLink(HIRING_CONNECTORS.find((m) => m.key === key)!, 'create_posting');
    expect(can('indeed-jobs')).toBe(false);
    expect(can('lever-postings')).toBe(true); // the create answer's own url selectors
    expect(can('greenhouse-job-board')).toBe(true);
    expect(can('linkedin-jobs')).toBe(true);
    // Workable has no create_posting at all — a LINKED Workable row has a link through
    // its list action's template and boardJobs.url, so it must not read as link-less.
    expect(can('workable')).toBe(true);
  });

  it('names the connection fields a template needs, and a template is not read as header selectors', () => {
    expect(templateConnectionFields(publishMapping('greenhouse-job-board')?.urlTemplate)).toEqual(['board_token']);
    expect(responseHeaderNames(publishMapping('greenhouse-job-board'))).toEqual([]);
    expect(responseHeaderNames(publishMapping('linkedin-jobs'))).toEqual(['x-restli-id']);
  });

  it('every hiring manifest passes the tenant validator, urlTemplate and applicants included', () => {
    for (const manifest of HIRING_CONNECTORS) {
      const parsed = parseConnectorManifest(manifest);
      expect(parsed.sourceAliases, manifest.key).toEqual(manifest.sourceAliases);
      for (const action of manifest.actions) {
        const out = parsed.actions.find((a) => a.key === action.key)!;
        expect(out.response, `${manifest.key}.${action.key}`).toEqual(action.response);
        expect(out.applicants, `${manifest.key}.${action.key}`).toEqual(action.applicants);
      }
    }
  });

  it('rejects a template with an unknown placeholder or a non-https scheme', () => {
    const base = HIRING_CONNECTORS.find((m) => m.key === 'lever-postings')!;
    const withTemplate = (urlTemplate: string) => ({
      ...base,
      actions: base.actions.map((a) => (a.key === 'create_posting' ? { ...a, response: { ...a.response, urlTemplate } } : a)),
    });
    expect(() => parseConnectorManifest(withTemplate('https://x.test/{externalId}'))).not.toThrow();
    expect(() => parseConnectorManifest(withTemplate('https://x.test/{secret}'))).toThrow();
    expect(() => parseConnectorManifest(withTemplate('http://x.test/{externalId}'))).toThrow();
  });
});

describe('derivedUrl (the distributor)', () => {
  const action = HIRING_CONNECTORS.find((m) => m.key === 'greenhouse-job-board')!.actions.find((a) => a.key === 'create_posting')!;
  const args = { tenantId: 1, connectionId: 'c1', action };
  const deps = (auth: Record<string, string>) => ({
    execute: (() => { throw new Error('unused'); }) as never,
    loadConnection: (async () => ({ id: 'c1', connectorKey: 'greenhouse-job-board', name: 'x', auth, baseUrlOverride: null })) as never,
  });

  it('renders from the connection and the job-post id; only the named field is read', async () => {
    expect(await derivedUrl({} as never, {} as never, deps({ username: 'secret', board_token: 'acme' }), args, '99', '555'))
      .toBe('https://boards.greenhouse.io/acme/jobs/555');
  });

  it('is null with no job-post id, no token, or an unreadable connection', async () => {
    expect(await derivedUrl({} as never, {} as never, deps({ board_token: 'acme' }), args, '99')).toBeNull();
    expect(await derivedUrl({} as never, {} as never, deps({ username: 'secret' }), args, '99', '555')).toBeNull();
    const failing = { ...deps({}), loadConnection: (async () => { throw new Error('boom'); }) as never };
    expect(await derivedUrl({} as never, {} as never, failing, args, '99', '555')).toBeNull();
  });
});
