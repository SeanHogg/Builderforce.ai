import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  resolveRepoAuth: vi.fn(),
  githubRequest: vi.fn(),
}));

vi.mock('./githubClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./githubClient')>()),
  resolveRepoAuth: mocks.resolveRepoAuth,
  githubRequest: mocks.githubRequest,
}));

const {
  probeRepoDelivery, runToBuildStatus, pipelineToBuildStatus, bitbucketPipelineToBuildStatus,
} = await import('./repoDelivery');

const ENV = { JWT_SECRET: 'test-secret' } as unknown as Env;
const DB = {} as never;

const auth = (provider: string, over: Record<string, unknown> = {}) => ({
  ok: true,
  auth: {
    coords: { host: provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : null, owner: 'acme', repo: 'site' },
    token: 'tok',
    authKind: 'user_token',
    repo: { id: 'repo-1', provider, projectId: 1, defaultBranch: 'main', segmentId: null },
    ...over,
  },
});

/** GitHub `Link` header for a `per_page=1` listing with `total` results. */
const linkFor = (total: number) =>
  new Headers(total > 1
    ? { link: `<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=${total}>; rel="last"` }
    : {});

/** Queue of fetch responses, consumed in call order, with the URLs recorded. */
function stubFetch(responses: Array<{ ok?: boolean; status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const urls: string[] = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const r = responses[i++] ?? { ok: false, status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? (r.ok === false ? 500 : 200),
      headers: r.headers,
    });
  }));
  return urls;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('build-status mapping', () => {
  it('maps a GitHub run to the four-state verdict', () => {
    expect(runToBuildStatus({ status: 'completed', conclusion: 'success', html_url: null, head_branch: null, updated_at: null })).toBe('success');
    // A workflow saying "nothing to do here" is not a break.
    expect(runToBuildStatus({ status: 'completed', conclusion: 'skipped', html_url: null, head_branch: null, updated_at: null })).toBe('success');
    expect(runToBuildStatus({ status: 'in_progress', conclusion: null, html_url: null, head_branch: null, updated_at: null })).toBe('pending');
    expect(runToBuildStatus({ status: 'completed', conclusion: 'timed_out', html_url: null, head_branch: null, updated_at: null })).toBe('failure');
    expect(runToBuildStatus(undefined)).toBeNull();
  });

  it('maps a GitLab pipeline status to the same vocabulary', () => {
    expect(pipelineToBuildStatus('success')).toBe('success');
    // `manual` is a pipeline waiting on a human gate — the build itself is fine.
    expect(pipelineToBuildStatus('manual')).toBe('success');
    expect(pipelineToBuildStatus('failed')).toBe('failure');
    expect(pipelineToBuildStatus('canceled')).toBe('cancelled');
    expect(pipelineToBuildStatus('running')).toBe('pending');
    expect(pipelineToBuildStatus(undefined)).toBeNull();
  });

  it('maps a Bitbucket pipeline state/result to the same vocabulary', () => {
    expect(bitbucketPipelineToBuildStatus({ state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } } })).toBe('success');
    expect(bitbucketPipelineToBuildStatus({ state: { name: 'COMPLETED', result: { name: 'FAILED' } } })).toBe('failure');
    expect(bitbucketPipelineToBuildStatus({ state: { name: 'COMPLETED', result: { name: 'STOPPED' } } })).toBe('cancelled');
    expect(bitbucketPipelineToBuildStatus({ state: { name: 'IN_PROGRESS' } })).toBe('pending');
    expect(bitbucketPipelineToBuildStatus(undefined)).toBeNull();
  });
});

describe('probeRepoDelivery', () => {
  it('reads GitHub pulls + the latest Actions run on the default branch', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('github'));
    mocks.githubRequest
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{}], headers: linkFor(4) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        data: { workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'https://gh/run/9', head_branch: 'main', updated_at: '2026-08-06T10:00:00.000Z' }] },
      });

    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1')).toEqual({
      health: 'ok', reason: null, openPullRequests: 4,
      buildStatus: 'success', buildUrl: 'https://gh/run/9',
      buildBranch: 'main', buildAt: '2026-08-06T10:00:00.000Z',
    });
  });

  it('treats a failed pulls listing as the connection being broken', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('github'));
    mocks.githubRequest.mockResolvedValue({ ok: false, status: 401, code: 'unauthorized', reason: '401: Bad credentials' });
    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1'))
      .toMatchObject({ health: 'error', reason: 'unauthorized', buildStatus: null });
  });

  it('reads GitLab merge requests + pipelines — a cohort that used to say `unknown`', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('gitlab'));
    const urls = stubFetch([
      { body: [{}], headers: { 'x-total': '3' } },
      { body: [{ status: 'failed', web_url: 'https://gitlab.com/acme/site/-/pipelines/5', ref: 'main', updated_at: '2026-08-06T11:00:00.000Z' }] },
    ]);

    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1')).toEqual({
      health: 'ok', reason: null, openPullRequests: 3,
      buildStatus: 'failure', buildUrl: 'https://gitlab.com/acme/site/-/pipelines/5',
      buildBranch: 'main', buildAt: '2026-08-06T11:00:00.000Z',
    });
    expect(urls[0]).toContain('/merge_requests?state=opened');
    // The pipeline is read for the repo's DEFAULT branch, not whatever ran last.
    expect(urls[1]).toContain('ref=main');
  });

  it('maps a GitLab 404 onto the shared reason vocabulary', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('gitlab'));
    stubFetch([{ status: 404 }, { status: 404 }]);
    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1'))
      .toMatchObject({ health: 'error', reason: 'not_found' });
  });

  it('reads Bitbucket pull requests + Pipelines', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('bitbucket'));
    const urls = stubFetch([
      { body: { size: 2, values: [{}] } },
      { body: { values: [{ state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } }, target: { ref_name: 'main' }, build_number: 42, completed_on: '2026-08-06T12:00:00.000Z' }] } },
    ]);

    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1')).toEqual({
      health: 'ok', reason: null, openPullRequests: 2,
      buildStatus: 'success',
      buildUrl: 'https://bitbucket.org/acme/site/pipelines/results/42',
      buildBranch: 'main', buildAt: '2026-08-06T12:00:00.000Z',
    });
    expect(urls[0]).toContain('/pullrequests?state=OPEN');
  });

  it('still reports a healthy repo whose CI listing 404s — no Actions is not a fault', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('github'));
    mocks.githubRequest
      .mockResolvedValueOnce({ ok: true, status: 200, data: [], headers: linkFor(0) })
      .mockResolvedValueOnce({ ok: false, status: 404, code: 'not_found', reason: 'Not Found' });

    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1'))
      .toMatchObject({ health: 'ok', openPullRequests: 0, buildStatus: null, buildBranch: 'main' });
  });

  it('says no_credential when the repo has no usable auth', async () => {
    mocks.resolveRepoAuth.mockResolvedValue({ ok: false, status: 400, error: 'no credential' });
    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1'))
      .toMatchObject({ health: 'error', reason: 'no_credential' });
  });

  it('says not_probed for a provider with no reader, rather than inventing a verdict', async () => {
    mocks.resolveRepoAuth.mockResolvedValue(auth('gitea'));
    expect(await probeRepoDelivery(ENV, DB, 's', 1, 'repo-1'))
      .toMatchObject({ health: 'unknown', reason: 'not_probed', buildStatus: null });
  });
});
