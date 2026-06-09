import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBuildError } from './fetchBuildError';
import { cloudAutofixOnBuildFailure, MAX_AUTOFIX_ATTEMPTS } from '../repos/mergeBranchToBase';

afterEach(() => vi.unstubAllGlobals());

// No KV binding → getOrSetCached falls straight through to the loader.
const env = {} as unknown as import('../../env').Env;

// Distinct runId per test — getOrSetCached keys by runId and the L1 Map persists
// across tests in this module, so reusing an id would return a stale cached result.
const coords = { provider: 'github', host: null, owner: 'acme', repo: 'app', token: 'tok', runId: 42, runUrl: 'https://gh/run/42' };

describe('cloudAutofixOnBuildFailure', () => {
  it('defaults ON', () => {
    expect(cloudAutofixOnBuildFailure(undefined)).toBe(true);
    expect(cloudAutofixOnBuildFailure({})).toBe(true);
    expect(cloudAutofixOnBuildFailure({ CLOUD_AUTOFIX_ON_BUILD_FAILURE: '' })).toBe(true);
  });
  it('is disabled only by explicit off values', () => {
    expect(cloudAutofixOnBuildFailure({ CLOUD_AUTOFIX_ON_BUILD_FAILURE: '0' })).toBe(false);
    expect(cloudAutofixOnBuildFailure({ CLOUD_AUTOFIX_ON_BUILD_FAILURE: 'false' })).toBe(false);
    expect(cloudAutofixOnBuildFailure({ CLOUD_AUTOFIX_ON_BUILD_FAILURE: 'off' })).toBe(false);
    expect(cloudAutofixOnBuildFailure({ CLOUD_AUTOFIX_ON_BUILD_FAILURE: '1' })).toBe(true);
  });
  it('caps attempts at 2', () => {
    expect(MAX_AUTOFIX_ATTEMPTS).toBe(2);
  });
});

describe('fetchBuildError', () => {
  it('summarizes failed jobs + steps from the Actions jobs API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      jobs: [
        { name: 'build', conclusion: 'success', steps: [{ name: 'compile', conclusion: 'success' }] },
        { name: 'test', conclusion: 'failure', steps: [
          { name: 'install', conclusion: 'success' },
          { name: 'unit tests', conclusion: 'failure' },
        ] },
      ],
    }), { status: 200 })));
    const be = await fetchBuildError(env, { ...coords, runId: 1042 });
    expect(be.failedJobs).toEqual(['test']);
    expect(be.summary).toContain('test');
    expect(be.summary).toContain('unit tests');
    expect(be.runUrl).toBe('https://gh/run/42');
  });

  it('degrades to a URL-only summary on a non-github provider (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const be = await fetchBuildError(env, { ...coords, provider: 'gitlab', runId: 2042 });
    expect(be.failedJobs).toEqual([]);
    expect(be.summary).toContain('https://gh/run/42');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('degrades gracefully when the jobs API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const be = await fetchBuildError(env, { ...coords, runId: 3042 });
    expect(be.failedJobs).toEqual([]);
    expect(be.summary).toContain('build failed');
  });
});
