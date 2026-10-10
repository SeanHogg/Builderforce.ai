/**
 * The `response` mapping — the half of a manifest that says where a write's answer is.
 *
 * Asserted on the declaration (does the validator accept what the hiring manifests say,
 * and refuse what would silently map nothing?) and on the reader (does one function
 * read six vendors' shapes?). Both fail quietly in production: a dropped mapping turns
 * every publish into "no id", and a selector that lands on an object would record
 * `[object Object]` as a confirmed vendor id.
 */
import { describe, expect, it } from 'vitest';
import { parseConnectorManifest, validateConnectorManifest } from './connectorManifest';
import { mapConnectorResponse, responseHeaderNames } from './connectorResponseMapping';
import { HIRING_CONNECTORS } from './defaults/hiring';

const manifestWith = (response: unknown) => ({
  key: 'acme-jobs',
  name: 'Acme Jobs',
  description: 'test',
  category: 'hiring',
  icon: '🔌',
  baseUrl: 'https://api.acme.test',
  auth: { kind: 'bearer' },
  actions: [
    { key: 'create_posting', label: 'Publish', description: 'p', method: 'POST', path: '/jobs', mutates: true, params: {}, response },
  ],
});

describe('validating a response mapping', () => {
  it('accepts a selector list and normalises a single string to one', () => {
    const manifest = parseConnectorManifest(manifestWith({ externalId: 'data.id', url: ['data.urls.show', 'header:Location'] }));
    expect(manifest.actions[0]?.response).toEqual({ externalId: ['data.id'], url: ['data.urls.show', 'header:Location'] });
  });

  it('refuses an unknown field rather than dropping it', () => {
    const result = validateConnectorManifest(manifestWith({ postingId: 'id' }));
    expect(result.ok).toBe(false);
  });

  it('refuses a selector that is a query language, not a location', () => {
    for (const selector of ['data[0].id', '$..id', 'data.*.id', 'header:', '']) {
      expect(validateConnectorManifest(manifestWith({ externalId: [selector] })).ok, selector).toBe(false);
    }
  });

  it('refuses an empty selector list', () => {
    expect(validateConnectorManifest(manifestWith({ externalId: [] })).ok).toBe(false);
  });
});

describe('reading a response through a mapping', () => {
  it('takes the first selector that yields a value', () => {
    const mapped = mapConnectorResponse(
      { externalId: ['data.id', 'id'], url: ['data.urls.show'] },
      { data: { data: { id: 'lever-123', urls: { show: 'https://jobs.lever.co/acme/lever-123' } } } },
    );
    expect(mapped).toEqual({ externalId: 'lever-123', url: 'https://jobs.lever.co/acme/lever-123', error: null });
  });

  it('indexes arrays with numeric segments', () => {
    const mapped = mapConnectorResponse(
      { externalId: ['elements.0.id'] },
      { data: { elements: [{ id: 'urn:li:simpleJobPostingTask:9', status: 201 }] } },
    );
    expect(mapped.externalId).toBe('urn:li:simpleJobPostingTask:9');
  });

  it('reads a header selector from the captured headers, case-insensitively', () => {
    const mapping = { externalId: ['elements.0.id', 'header:X-RestLi-Id'] };
    expect(responseHeaderNames(mapping)).toEqual(['x-restli-id']);
    const mapped = mapConnectorResponse(mapping, { data: null, headers: { 'x-restli-id': 'urn:li:job:42' } });
    expect(mapped.externalId).toBe('urn:li:job:42');
  });

  it('stringifies a numeric id and never an object', () => {
    expect(mapConnectorResponse({ externalId: ['id'] }, { data: { id: 109 } }).externalId).toBe('109');
    // A selector pointed one level too high must yield NOTHING, not "[object Object]".
    expect(mapConnectorResponse({ externalId: ['data'] }, { data: { data: { id: 'x' } } }).externalId).toBeNull();
    expect(mapConnectorResponse({ externalId: ['id'] }, { data: { id: '   ' } }).externalId).toBeNull();
  });

  it('reports a refusal carried inside a successful body', () => {
    const mapped = mapConnectorResponse(
      { externalId: ['results.id'], error: ['errorInfo.message', 'errors.0'] },
      { data: { success: false, errors: ['title is too long'] } },
    );
    expect(mapped).toEqual({ externalId: null, url: null, error: 'title is too long' });
  });

  it('maps nothing when there is no mapping', () => {
    expect(mapConnectorResponse(undefined, { data: { id: 'x' } })).toEqual({ externalId: null, url: null, error: null });
  });
});

describe('the hiring catalog', () => {
  it('declares where every board returns its posting id', () => {
    // Every board ships `create_posting`, and every one says where its id comes back —
    // otherwise the distribute use case could only ever record a failure for it.
    for (const manifest of HIRING_CONNECTORS) {
      const action = manifest.actions.find((candidate) => candidate.key === 'create_posting');
      expect(action, manifest.key).toBeDefined();
      expect(action?.response?.externalId?.length, manifest.key).toBeGreaterThan(0);
      // And it survives the validator tenant manifests pass through.
      const parsed = parseConnectorManifest(manifest);
      expect(parsed.actions.find((candidate) => candidate.key === 'create_posting')?.response).toEqual(action?.response);
    }
  });

  it('reads each vendor’s documented create response', () => {
    const answers: Record<string, { data: unknown; headers?: Record<string, string> }> = {
      'greenhouse-job-board': { data: { id: 4012, name: 'Senior React Engineer' } },
      'lever-postings': { data: { data: { id: 'f2f01e16', urls: { show: 'https://jobs.lever.co/acme/f2f01e16' } } } },
      'ashby-postings': { data: { success: true, results: { id: 'a1', externalLink: 'https://jobs.ashbyhq.com/acme/a1' } } },
      'indeed-jobs': { data: { data: { jobsIngest: { createSourcedJobPostings: { results: [{ jobPosting: { sourcedPostingId: 'ind-7' } }] } } } } },
      'linkedin-jobs': { data: { elements: [{ id: 'urn:li:simpleJobPostingTask:3', status: 201 }] } },
      'job-feed': { data: { id: 'posting-a', url: 'https://careers.acme.test/jobs/posting-a' } },
    };
    for (const manifest of HIRING_CONNECTORS) {
      const action = manifest.actions.find((candidate) => candidate.key === 'create_posting');
      const answer = answers[manifest.key];
      expect(answer, `no fixture for ${manifest.key}`).toBeDefined();
      const mapped = mapConnectorResponse(action?.response, answer!);
      expect(mapped.externalId, manifest.key).toBeTruthy();
      expect(mapped.error, manifest.key).toBeNull();
    }
  });
});
