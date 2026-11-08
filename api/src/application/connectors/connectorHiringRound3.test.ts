/**
 * Regression tests for the connector half of the third board-import review: a Rest.li key
 * that must not be encoded twice, a literal dot in the pattern grammar, stored manifests
 * that predate a rule, and the selector/lookup declarations the import reads.
 */
import { describe, expect, it } from 'vitest';
import { HIRING_CONNECTORS } from './defaults/hiring';
import { parseConnectorManifest } from './connectorManifest';
import { parseStoredConnectorManifest } from './connectorStoredManifest';
import { buildConnectorRequest } from './connectorRuntime';
import { encodeResolveId } from './connectorUrlResolution';
import { matchesPattern, validateSelectorList } from './connectorMappingValidators';
import { allOf } from './connectorResponseMapping';
import { distributableAction } from '../hiring/distributePosting';

const linkedin = HIRING_CONNECTORS.find((m) => m.key === 'linkedin-jobs')!;
const resolveAction = linkedin.actions.find((a) => a.key === 'resolve_url')!;
const TASK = 'urn:li:simpleJobPostingTask:f582859f-bafc-4b7c-a656-d042470ccae1';

describe('regression: LinkedIn resolve sends the Rest.li key encoded exactly once', () => {
  it('builds the exact outgoing URL — only the urn is percent-encoded, the List( ) stay literal', () => {
    const { url } = buildConnectorRequest({
      manifest: linkedin,
      action: resolveAction,
      input: { ids: encodeResolveId(resolveAction.resolve!, TASK) },
      auth: { accessToken: 't' },
    });
    expect(url).toBe('https://api.linkedin.com/rest/simpleJobPostingTasks?ids=List(urn%3Ali%3AsimpleJobPostingTask%3Af582859f-bafc-4b7c-a656-d042470ccae1)');
    expect(url).not.toContain('%25'); // no double encoding
    expect(url).not.toContain('%28');
  });

  it('encodes a raw value normally when it holds anything that could end the param', () => {
    const { url } = buildConnectorRequest({
      manifest: linkedin, action: resolveAction, input: { ids: 'List(a&b=c#x)' }, auth: { accessToken: 't' },
    });
    expect(url).toBe('https://api.linkedin.com/rest/simpleJobPostingTasks?ids=List%28a%26b%3Dc%23x%29');
  });

  it('puts raw params after the encoded ones, and keeps the host guard on the resolved URL', () => {
    const manifest = parseConnectorManifest({
      key: 'raw-test', name: 'Raw', category: 'other', baseUrl: 'https://api.example.com', auth: { kind: 'none' },
      actions: [{
        key: 'get', method: 'GET', path: '/x', mutates: false,
        params: { a: { type: 'string', in: 'query' }, k: { type: 'string', in: 'query', raw: true } },
      }],
    });
    const { url } = buildConnectorRequest({ manifest, action: manifest.actions[0]!, input: { a: 'x y', k: 'List(1%3A2)' }, auth: {} });
    expect(url).toBe('https://api.example.com/x?a=x+y&k=List(1%3A2)');
  });

  it('the manifest gate refuses a restli-list id on a param that is not raw (it would be double-encoded)', () => {
    const raw = JSON.parse(JSON.stringify(linkedin));
    raw.actions.find((a: { key: string }) => a.key === 'resolve_url').params.ids.raw = false;
    expect(() => parseConnectorManifest(raw)).toThrow(/raw: true/);
  });
});

describe('regression: "." in the pattern grammar is a literal dot', () => {
  it('does not match a different character in its place', () => {
    expect(matchesPattern('job.(\\d+)', 'job.42')?.[1]).toBe('42');
    expect(matchesPattern('job.(\\d+)', 'jobx42')).toBeNull();
    expect(matchesPattern('urn:li:jobPosting:(\\d+)', 'urn:li:jobPosting:77')?.[1]).toBe('77');
  });
});

describe('regression: any element of an array can carry the posting id', () => {
  it('a * segment fans out over the array; only membership selectors may use it', () => {
    expect(allOf({ jobs: [{ id: 1 }, { id: 4012 }] }, ['jobs.*.id'])).toEqual(['1', '4012']);
    expect(allOf({ jobs: [] }, ['jobs.*.id'])).toEqual([]);
    const errors: string[] = [];
    expect(validateSelectorList(['jobs.*.id'], 's', errors, { allowWildcard: true })).toEqual(['jobs.*.id']);
    expect(validateSelectorList(['jobs.*.id'], 's', errors)).toBeNull();
  });
});

const legacy = (extra: { applicants?: Record<string, unknown>; resolve?: Record<string, unknown> } = {}) => ({
  key: 'legacy-board', name: 'Legacy board', category: 'hiring', baseUrl: 'https://api.example.com', auth: { kind: 'bearer' },
  actions: [
    {
      key: 'create_posting', method: 'POST', path: '/jobs', mutates: true, required: ['title', 'description'],
      params: { title: { type: 'string', in: 'body' }, description: { type: 'string', in: 'body' } },
      response: { externalId: ['id'] },
    },
    {
      key: 'list_applications', method: 'GET', path: '/apps', mutates: false,
      params: { job: { type: 'string', in: 'query' }, since: { type: 'string', in: 'query' } },
      applicants: { postingParam: 'job', externalId: ['id'], appliedAt: ['at'], cursorParam: 'since', cursorFrom: 'appliedAt', ...(extra.applicants ?? {}) },
    },
    {
      key: 'resolve_url', method: 'GET', path: '/resolve', mutates: false, params: {},
      resolve: { url: ['link'], resolvedId: ['id'], resolvedIdPattern: '(a|aa)+', ...(extra.resolve ?? {}) },
    },
  ],
});

describe('regression: a stored manifest that predates a rule still loads and publishes', () => {
  it('is refused on WRITE (strict) …', () => {
    expect(() => parseConnectorManifest(legacy())).toThrow();
  });

  it('… but kept on READ: the cursor without an order defaults to desc, and the stale pattern disables only resolve', () => {
    const stored = parseStoredConnectorManifest(legacy());
    expect(stored.key).toBe('legacy-board');
    const applicants = stored.actions.find((a) => a.key === 'list_applications')!.applicants;
    expect(applicants?.order).toBe('desc'); // the safe reading: re-reads, never skips
    expect(stored.actions.find((a) => a.key === 'resolve_url')!.resolve).toBeUndefined();
    expect(stored.degraded?.join(' ')).toMatch(/resolve mapping disabled/);
    expect(distributableAction(stored)?.key).toBe('create_posting'); // still publishes
  });

  it('disables a broken applicants mapping and nothing else', () => {
    const stored = parseStoredConnectorManifest(legacy({ applicants: { postingParam: 'nope' }, resolve: { resolvedIdPattern: '\\d+' } }));
    expect(stored.actions.find((a) => a.key === 'list_applications')!.applicants).toBeUndefined();
    expect(stored.actions.find((a) => a.key === 'resolve_url')!.resolve).toBeDefined();
    expect(stored.degraded?.some((reason) => /applicants mapping disabled/.test(reason))).toBe(true);
  });

  it('still throws for a fault that is not a data mapping (the connector cannot run)', () => {
    const broken = legacy();
    (broken.actions[0] as { method: string }).method = 'FETCH';
    expect(() => parseStoredConnectorManifest(broken)).toThrow();
  });

  it('a clean manifest carries no degraded note', () => {
    expect(parseStoredConnectorManifest(HIRING_CONNECTORS[1]).degraded).toBeUndefined();
  });
});

describe('the new applicant declarations are validated', () => {
  const ashby = JSON.parse(JSON.stringify(HIRING_CONNECTORS.find((m) => m.key === 'ashby-postings')));
  it('accepts the shipped filterIdFrom / nextToken declarations', () => {
    expect(() => parseConnectorManifest(ashby)).not.toThrow();
    expect(() => parseConnectorManifest(HIRING_CONNECTORS.find((m) => m.key === 'lever-postings'))).not.toThrow();
  });

  it('refuses a nextToken whose param is not declared', () => {
    const lever = JSON.parse(JSON.stringify(HIRING_CONNECTORS.find((m) => m.key === 'lever-postings')));
    lever.actions.find((a: { key: string }) => a.key === 'list_opportunities').applicants.nextToken.param = 'missing';
    expect(() => parseConnectorManifest(lever)).toThrow(/nextToken/);
  });
});
