import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoBySlug = vi.fn();
const repoAuth = vi.fn();
const latestRun = vi.fn();
const ghRequest = vi.fn();
vi.mock('../repos/resolveDefaultRepo', () => ({ resolveTenantRepoBySlug: (...a: unknown[]) => repoBySlug(...a) }));
vi.mock('../repos/githubClient', () => ({
  resolveRepoAuth: (...a: unknown[]) => repoAuth(...a),
  githubRequest: (...a: unknown[]) => ghRequest(...a),
  repoPath: (c: { owner: string; repo: string }, s: string) => `/repos/${c.owner}/${c.repo}${s}`,
}));
vi.mock('../repos/repoDelivery', () => ({ readLatestActionsRun: (...a: unknown[]) => latestRun(...a) }));

import {
  composeDeployStatus, DEPLOY_STATUS_TOOLS, parseCommitPrefix, PLATFORM_OPERATOR_REFUSAL, readContainment,
  readFrontendDeploy, readLatestRelease, readReleaseCached, runDeployStatus,
  type DeployStatusReaders, type ReleaseRun,
} from './deployStatusToolCatalog';
import { API_VERSION } from '../../version';
import type { BuiltinCtx } from './builtinToolContext';

const SHA = 'abc1234def5678900000000000000000000000ff';
const OLD = '1111111222222233333334444444555555566666';

const RELEASE: ReleaseRun = {
  workflow: 'Release', status: 'completed', conclusion: 'success',
  headSha: SHA, url: 'https://github.com/o/r/actions/runs/1', createdAt: '2026-11-21T00:00:00Z',
};

let tenantSeq = 100;
function ctxWith(env: Record<string, unknown> | undefined, tenantId = 7): BuiltinCtx {
  return { tenantId, db: {}, env } as unknown as BuiltinCtx;
}

function readers(over: Partial<DeployStatusReaders> = {}): DeployStatusReaders {
  return {
    frontend: vi.fn(async () => ({ commit: SHA, url: 'https://app.test/health' })),
    release: vi.fn(async () => RELEASE),
    contains: vi.fn(async () => null),
    isOperator: vi.fn(async () => true),
    ...over,
  };
}

beforeEach(() => { repoBySlug.mockReset(); repoAuth.mockReset(); latestRun.mockReset(); ghRequest.mockReset(); });

describe('deploy.status', () => {
  // regression: an agent polled CI several times and could not confirm the deployed API was its commit.
  it('reports API version + commit, frontend commit and the latest release in one call', async () => {
    const r = readers();
    const ctx = ctxWith({ GIT_SHA: SHA });
    const res = await runDeployStatus(ctx, {}, r);
    expect(r.frontend).toHaveBeenCalledWith(ctx);
    expect(r.release).toHaveBeenCalledWith(ctx);
    expect(res).toEqual({
      api: { version: API_VERSION, commit: SHA },
      frontend: { commit: SHA, url: 'https://app.test/health' },
      release: RELEASE,
      matches: { apiIsLatestRelease: true, frontendIsLatestRelease: true },
    });
  });

  it('refuses a workspace that is not the platform operator, before reading anything', async () => {
    const r = readers({ isOperator: vi.fn(async () => false) });
    await expect(runDeployStatus(ctxWith({ GIT_SHA: SHA }), {}, r)).rejects.toThrow(PLATFORM_OPERATOR_REFUSAL);
    expect(r.frontend).not.toHaveBeenCalled();
    expect(r.release).not.toHaveBeenCalled();
  });

  it('says false when a Worker serves an older commit than the latest release', async () => {
    const res = await runDeployStatus(ctxWith({ GIT_SHA: OLD }), {}, readers({
      frontend: async () => ({ commit: OLD, url: 'u' }),
    }));
    expect(res.matches).toEqual({ apiIsLatestRelease: false, frontendIsLatestRelease: false });
  });

  it('answers the API part when the frontend and GitHub reads fail, and never guesses a match', async () => {
    const res = await runDeployStatus(ctxWith(undefined), {}, readers({
      frontend: async () => ({ error: 'unreachable' }),
      release: async () => ({ error: 'this workspace has no GitHub connection to SeanHogg/Builderforce.ai' }),
    }));
    expect(res.api).toEqual({ version: API_VERSION, commit: null });
    expect(res.frontend).toEqual({ error: 'unreachable' });
    expect(res.release).toEqual({ error: 'this workspace has no GitHub connection to SeanHogg/Builderforce.ai' });
    expect(res.matches).toEqual({ apiIsLatestRelease: null, frontendIsLatestRelease: null });
    expect(res.deployed).toBeUndefined();
  });

  it('with commit, an exact sha prefix is live via "exact" and needs no compare', async () => {
    const r = readers();
    const res = await runDeployStatus(ctxWith({ GIT_SHA: SHA }), { commit: 'ABC1234' }, r);
    expect(res.deployed).toEqual({ commit: 'abc1234', api: true, frontend: true, via: { api: 'exact', frontend: 'exact' } });
    expect(r.contains).not.toHaveBeenCalled();
  });

  it('a commit contained in a newer deployed sha is live via "superseded"; one compare per distinct sha', async () => {
    const contains = vi.fn(async () => true);
    const res = await runDeployStatus(ctxWith({ GIT_SHA: SHA }), { commit: '1111111' }, readers({ contains }));
    expect(res.deployed).toEqual({ commit: '1111111', api: true, frontend: true, via: { api: 'superseded', frontend: 'superseded' } });
    expect(contains).toHaveBeenCalledTimes(1);
    expect(contains).toHaveBeenCalledWith(expect.anything(), '1111111', SHA);
  });

  it('a commit the deployed sha does not contain is false; an unreadable compare or unstamped Worker is null', async () => {
    const res = await runDeployStatus(ctxWith({ GIT_SHA: SHA }), { commit: '2222' }, readers({
      frontend: async () => ({ commit: OLD, url: 'u' }),
      contains: async (_c, _asked, deployed) => (deployed === SHA ? false : null),
    }));
    expect(res.deployed).toEqual({ commit: '2222', api: false, frontend: null, via: { api: null, frontend: null } });
    const unstamped = composeDeployStatus({ version: '1', commit: null }, { error: 'x' }, RELEASE, 'abc1');
    expect(unstamped.deployed).toEqual({ commit: 'abc1', api: null, frontend: null, via: { api: null, frontend: null } });
  });

  it('rejects a commit arg that is not a hex sha prefix', async () => {
    expect(() => parseCommitPrefix('main')).toThrow(/hex sha/);
    expect(() => parseCommitPrefix('abc')).toThrow(/hex sha/);
    expect(parseCommitPrefix(undefined)).toBeUndefined();
    await expect(runDeployStatus(ctxWith({}), { commit: 'HEAD' }, readers())).rejects.toThrow(/hex sha/);
  });

  it('is registered read-only and described as platform-internal', () => {
    const tool = DEPLOY_STATUS_TOOLS.find((t) => t.tool === 'deploy.status');
    expect(tool?.mutates).toBe(false);
    expect(tool?.description).toMatch(/PLATFORM-INTERNAL/);
  });
});

describe('readLatestRelease', () => {
  const env = { JWT_SECRET: 's' };
  const coords = { host: null, owner: 'SeanHogg', repo: 'Builderforce.ai' };

  it('reads the latest release.yml run on main through the tenant\'s connection to the platform repo', async () => {
    repoBySlug.mockResolvedValue({ repoId: 'r1' });
    const auth = { coords };
    repoAuth.mockResolvedValue({ ok: true, auth });
    latestRun.mockResolvedValue({ ok: true, data: { workflow_runs: [{
      name: 'Release', status: 'in_progress', conclusion: null, head_sha: SHA,
      html_url: 'https://github.com/x/runs/9', created_at: '2026-11-21T01:00:00Z', head_branch: 'main', updated_at: null,
    }] } });
    const res = await readLatestRelease(ctxWith(env));
    expect(repoBySlug).toHaveBeenCalledWith({}, 7, { provider: 'github', owner: 'SeanHogg', repo: 'Builderforce.ai' });
    expect(repoAuth).toHaveBeenCalledWith(env, {}, 's', 7, 'r1');
    expect(latestRun).toHaveBeenCalledWith({ auth }, coords, { workflow: 'release.yml', branch: 'main' });
    expect(res).toEqual({
      workflow: 'Release', status: 'in_progress', conclusion: null, headSha: SHA,
      url: 'https://github.com/x/runs/9', createdAt: '2026-11-21T01:00:00Z',
    });
  });

  it('returns { error }, never throws, without a GitHub connection, a credential or a readable run', async () => {
    repoBySlug.mockResolvedValue(null);
    expect(await readLatestRelease(ctxWith(env))).toEqual({ error: 'this workspace has no GitHub connection to SeanHogg/Builderforce.ai' });

    repoBySlug.mockResolvedValue({ repoId: 'r1' });
    repoAuth.mockResolvedValue({ ok: false, status: 400, error: 'no token' });
    expect(await readLatestRelease(ctxWith(env))).toEqual({ error: 'GitHub credential unavailable: no token' });

    repoAuth.mockResolvedValue({ ok: true, auth: { coords } });
    latestRun.mockResolvedValue({ ok: false, status: 404, code: 'not_found', reason: '404: Not Found' });
    expect(await readLatestRelease(ctxWith(env))).toEqual({ error: 'GitHub Actions read failed: 404: Not Found' });

    latestRun.mockResolvedValue({ ok: true, data: { workflow_runs: [] } });
    expect(await readLatestRelease(ctxWith(env))).toEqual({ error: 'no release.yml run on main' });

    repoBySlug.mockRejectedValue(new Error('db down'));
    expect(await readLatestRelease(ctxWith(env))).toEqual({ error: 'release read failed: db down' });

    expect(await readLatestRelease(ctxWith(undefined))).toEqual({ error: 'worker env unavailable in this context' });
  });

  it('readReleaseCached never caches a failure: the next call reads again and can succeed', async () => {
    const ctx = ctxWith(env, tenantSeq++);
    repoBySlug.mockResolvedValueOnce(null);
    expect(await readReleaseCached(ctx)).toEqual({ error: 'this workspace has no GitHub connection to SeanHogg/Builderforce.ai' });
    repoBySlug.mockResolvedValue({ repoId: 'r1' });
    repoAuth.mockResolvedValue({ ok: true, auth: { coords } });
    latestRun.mockResolvedValue({ ok: true, data: { workflow_runs: [{ name: 'Release', status: 'completed', conclusion: 'success', head_sha: SHA, html_url: 'u', created_at: 'c', head_branch: 'main', updated_at: null }] } });
    expect(await readReleaseCached(ctx)).toMatchObject({ headSha: SHA });
    expect(repoBySlug).toHaveBeenCalledTimes(2);
    // …and a success IS cached.
    expect(await readReleaseCached(ctx)).toMatchObject({ headSha: SHA });
    expect(repoBySlug).toHaveBeenCalledTimes(2);
  });
});

describe('readContainment (GitHub compare)', () => {
  const env = { JWT_SECRET: 's' };
  const coords = { host: null, owner: 'SeanHogg', repo: 'Builderforce.ai' };
  const connect = () => {
    repoBySlug.mockResolvedValue({ repoId: 'r1' });
    repoAuth.mockResolvedValue({ ok: true, auth: { coords } });
  };

  it('ahead or identical = contained; behind or diverged = not', async () => {
    connect();
    for (const [status, want] of [['ahead', true], ['identical', true], ['behind', false], ['diverged', false]] as const) {
      ghRequest.mockResolvedValueOnce({ ok: true, status: 200, data: { status }, headers: new Headers() });
      expect(await readContainment(ctxWith(env, tenantSeq++), '1111111', SHA), status).toBe(want);
    }
    expect(ghRequest).toHaveBeenLastCalledWith(expect.objectContaining({ path: `/repos/SeanHogg/Builderforce.ai/compare/1111111...${SHA}` }));
  });

  it('null when the compare cannot be read, and that failure is not cached', async () => {
    const ctx = ctxWith(env, tenantSeq++);
    repoBySlug.mockResolvedValueOnce(null);
    expect(await readContainment(ctx, '1111111', SHA)).toBeNull();
    connect();
    ghRequest.mockResolvedValueOnce({ ok: false, status: 404, code: 'not_found', reason: '404: No commit found' });
    expect(await readContainment(ctx, '1111111', SHA)).toBeNull();
    ghRequest.mockResolvedValueOnce({ ok: true, status: 200, data: { status: 'ahead' }, headers: new Headers() });
    expect(await readContainment(ctx, '1111111', SHA)).toBe(true);
  });
});

describe('readFrontendDeploy', () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reads commit from the configured app origin /health', async () => {
    const fetchFn = ok({ status: 'ok', commit: SHA });
    const res = await readFrontendDeploy({ APP_URL: 'https://app.test/, https://other.test' }, fetchFn);
    expect(res).toEqual({ commit: SHA, url: 'https://app.test/health' });
    expect((fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe('https://app.test/health');
  });

  it('commit is null when the frontend is unstamped', async () => {
    expect(await readFrontendDeploy({ APP_URL: 'https://app.test' }, ok({ status: 'ok', commit: null })))
      .toEqual({ commit: null, url: 'https://app.test/health' });
  });

  it('degrades to { error } on a non-2xx, a non-JSON body or a network failure', async () => {
    expect(await readFrontendDeploy({ APP_URL: 'https://app.test' }, ok({}, 503))).toEqual({ error: 'https://app.test/health returned 503' });
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await readFrontendDeploy({ APP_URL: 'https://app.test' }, notJson)).toHaveProperty('error');
    const down = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await readFrontendDeploy({ APP_URL: 'https://app.test' }, down)).toEqual({ error: 'https://app.test/health probe failed: ECONNRESET' });
  });
});
