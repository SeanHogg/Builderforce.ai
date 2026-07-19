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

  it('degrades gracefully when the jobs API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const be = await fetchBuildError(env, { ...coords, runId: 3042 });
    expect(be.failedJobs).toEqual([]);
    expect(be.summary).toContain('build failed');
  });

  it('degrades to a URL-only summary on an unsupported provider (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const be = await fetchBuildError(env, { ...coords, provider: 'gitea', runId: 2042 });
    expect(be.failedJobs).toEqual([]);
    expect(be.summary).toContain('https://gh/run/42');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchBuildError — gitlab', () => {
  const gl = { ...coords, provider: 'gitlab', runUrl: 'https://gl/grp/app/-/pipelines/77' };

  it('summarizes the pipeline\'s failed jobs + stages', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify([
      { name: 'lint', stage: 'verify', status: 'success' },
      { name: 'unit', stage: 'test', status: 'failed' },
      { name: 'e2e', stage: 'test', status: 'failed' },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const be = await fetchBuildError(env, { ...gl, runId: 4001 });
    expect(be.failedJobs).toEqual(['unit', 'e2e']);
    expect(be.summary).toContain('Job "unit" failed in stage: test');
    expect(be.runUrl).toBe('https://gl/grp/app/-/pipelines/77');
    // The pipeline id addresses the run; the project is its URL-encoded path.
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/projects/acme%2Fapp/pipelines/4001/jobs');
  });

  it('degrades to the URL when no job failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ name: 'unit', status: 'success' }]), { status: 200 })));
    const be = await fetchBuildError(env, { ...gl, runId: 4002 });
    expect(be.failedJobs).toEqual([]);
    expect(be.summary).toContain('https://gl/grp/app/-/pipelines/77');
  });
});

describe('fetchBuildError — bitbucket', () => {
  const steps = (results: Array<[string, string]>) => JSON.stringify({
    values: results.map(([name, result]) => ({ name, state: { name: 'COMPLETED', result: { name: result } } })),
  });
  const bb = { ...coords, provider: 'bitbucket', host: 'bitbucket.org', runId: null };

  it('summarizes failed steps, recovering the build number from the status URL', async () => {
    const fetchSpy = vi.fn(async () => new Response(steps([['Build', 'SUCCESSFUL'], ['Test', 'FAILED']]), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const be = await fetchBuildError(env, { ...bb, runUrl: 'https://bitbucket.org/ws/app/pipelines/results/123' });
    expect(be.failedJobs).toEqual(['Test']);
    expect(be.summary).toContain('Step "Test" failed');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/repositories/acme/app/pipelines/123/steps/');
  });

  it('treats ERROR as a failure too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(steps([['Deploy', 'ERROR']]), { status: 200 })));
    const be = await fetchBuildError(env, { ...bb, runUrl: 'https://bitbucket.org/ws/app/pipelines/results/124' });
    expect(be.failedJobs).toEqual(['Deploy']);
  });

  it('degrades to the URL when the status URL carries no build number (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const be = await fetchBuildError(env, { ...bb, runUrl: 'https://sonar.example.com/dashboard?id=app' });
    expect(be.failedJobs).toEqual([]);
    expect(be.summary).toContain('sonar.example.com');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('degrades on Bitbucket Server (no REST base) without throwing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const be = await fetchBuildError(env, { ...bb, host: 'bb.internal.acme.com', runUrl: 'https://bb.internal.acme.com/x/pipelines/results/9' });
    expect(be.failedJobs).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
