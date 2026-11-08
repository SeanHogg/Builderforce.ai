/**
 * The `resolve_url` match rule: find the entry that is about THIS posting in a list (or
 * a keyed object) and read its link and real id from it. Nothing is guessed.
 */
import { describe, expect, it } from 'vitest';
import { HIRING_CONNECTORS } from './defaults/hiring';
import { parseConnectorManifest } from './connectorManifest';
import { extractResolvedUrl } from './connectorUrlResolution';

const resolveOf = (key: string) =>
  HIRING_CONNECTORS.find((m) => m.key === key)!.actions.find((a) => a.key === 'resolve_url')!.resolve!;

describe('Greenhouse: match internal_job_id, take absolute_url', () => {
  const resolve = resolveOf('greenhouse-job-board');
  const board = {
    jobs: [
      { id: 111, internal_job_id: 4011, absolute_url: 'https://boards.greenhouse.io/acme/jobs/111' },
      { id: 222, internal_job_id: 4012, absolute_url: 'https://boards.greenhouse.io/acme/jobs/222' },
    ],
    meta: { total: 2 },
  };

  it('finds the link by the stored JOB id (a number in the body, a string in storage)', () => {
    expect(extractResolvedUrl(resolve, board, '4012')).toEqual({ url: 'https://boards.greenhouse.io/acme/jobs/222', resolvedId: null });
  });

  it('is nothing when no entry matches — it does not fall back to the first job', () => {
    expect(extractResolvedUrl(resolve, board, '9999')).toEqual({ url: null, resolvedId: null });
    expect(extractResolvedUrl(resolve, { jobs: [] }, '4012')).toEqual({ url: null, resolvedId: null });
    expect(extractResolvedUrl(resolve, { meta: {} }, '4012')).toEqual({ url: null, resolvedId: null });
  });
});

describe('LinkedIn: match the task urn in a keyed map, read the numeric job id', () => {
  const resolve = resolveOf('linkedin-jobs');
  const task = 'urn:li:simpleJobPostingTask:f582859f-bafc-4b7c-a656-d042470ccae1';

  it('builds the link and returns the real id once the task has succeeded', () => {
    const data = { results: { [task]: { id: task, status: 'SUCCEEDED', jobPosting: 'urn:li:jobPosting:4215800322' } } };
    expect(extractResolvedUrl(resolve, data, task)).toEqual({ url: 'https://www.linkedin.com/jobs/view/4215800322', resolvedId: '4215800322' });
  });

  it('is nothing while the task is still in progress (no jobPosting yet) — never a link on the task urn', () => {
    const data = { results: { [task]: { id: task, status: 'IN_PROGRESS' } } };
    expect(extractResolvedUrl(resolve, data, task)).toEqual({ url: null, resolvedId: null });
  });

  it('ignores another task’s entry', () => {
    const other = 'urn:li:simpleJobPostingTask:other';
    const data = { results: { [other]: { id: other, status: 'SUCCEEDED', jobPosting: 'urn:li:jobPosting:1' } } };
    expect(extractResolvedUrl(resolve, data, task)).toEqual({ url: null, resolvedId: null });
  });
});

describe('the rule itself', () => {
  it('takes the whole body as the entry when no listPath is declared, and renders connection fields', () => {
    const resolve = { url: ['link'], urlTemplate: 'https://x.test/{connection.slug}/{externalId}' };
    expect(extractResolvedUrl(resolve, { link: 'https://x.test/own' }, '7')).toEqual({ url: 'https://x.test/own', resolvedId: null });
    expect(extractResolvedUrl({ urlTemplate: resolve.urlTemplate }, {}, '7', { slug: 'acme' }).url).toBe('https://x.test/acme/7');
    expect(extractResolvedUrl({ urlTemplate: resolve.urlTemplate }, {}, '7', {}).url).toBeNull();
  });

  it('applies resolvedIdPattern as a FULL match: capture group 1, else the whole value, else nothing', () => {
    const data = { id: 'urn:li:jobPosting:55' };
    const base = { resolvedId: ['id'], urlTemplate: 'https://x.test/{externalId}' };
    expect(extractResolvedUrl({ ...base, resolvedIdPattern: 'urn:li:jobPosting:(\\d+)' }, data, 'old').resolvedId).toBe('55');
    expect(extractResolvedUrl({ ...base, resolvedIdPattern: 'urn:li:jobPosting:\\d+' }, data, 'old').resolvedId).toBe('urn:li:jobPosting:55');
    // Anchored: a pattern that only matches part of the value does not match it.
    expect(extractResolvedUrl({ ...base, resolvedIdPattern: '\\d+' }, data, 'old')).toEqual({ url: null, resolvedId: null });
    expect(extractResolvedUrl({ ...base, resolvedIdPattern: 'nomatch' }, data, 'old')).toEqual({ url: null, resolvedId: null });
  });

  it('does not run a pattern against an oversize value', () => {
    const data = { id: `urn:li:jobPosting:${'9'.repeat(300)}` };
    expect(extractResolvedUrl({ resolvedId: ['id'], resolvedIdPattern: 'urn:li:jobPosting:(\\d+)', urlTemplate: 'https://x.test/{externalId}' }, data, 'old'))
      .toEqual({ url: null, resolvedId: null });
  });
});

describe('manifest validation', () => {
  it('keeps resolve and public through the tenant validator, and rejects a half-declared rule', () => {
    for (const key of ['greenhouse-job-board', 'linkedin-jobs']) {
      const manifest = HIRING_CONNECTORS.find((m) => m.key === key)!;
      const parsed = parseConnectorManifest(manifest);
      const original = manifest.actions.find((a) => a.key === 'resolve_url')!;
      const out = parsed.actions.find((a) => a.key === 'resolve_url')!;
      expect(out.resolve, key).toEqual(original.resolve);
      expect(out.public, key).toBe(original.public);
    }
    const base = HIRING_CONNECTORS.find((m) => m.key === 'greenhouse-job-board')!;
    const withResolve = (resolve: unknown) => ({
      ...base,
      actions: base.actions.map((a) => (a.key === 'resolve_url' ? { ...a, resolve } : a)),
    });
    expect(() => parseConnectorManifest(withResolve({ listPath: 'jobs', matchField: 'id', url: ['u'] }))).toThrow();
    expect(() => parseConnectorManifest(withResolve({ listPath: 'jobs', url: ['u'], resolvedIdPattern: '(' }))).toThrow();
    expect(() => parseConnectorManifest(withResolve({ listPath: 'jobs' }))).toThrow();
  });

  it('only the Greenhouse public read is credential-free', () => {
    const publics = HIRING_CONNECTORS.flatMap((m) => m.actions.filter((a) => a.public).map((a) => `${m.key}.${a.key}`));
    expect(publics).toEqual(['greenhouse-job-board.resolve_url']);
  });
});
