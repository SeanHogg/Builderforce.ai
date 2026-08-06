import { describe, expect, it, vi, beforeEach } from 'vitest';
import { boardConnections, projectRepositories, pullRequests } from '../../infrastructure/database/schema';
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

const { buildProjectConnections } = await import('./projectConnectionStatus');

type TableRef = typeof projectRepositories | typeof boardConnections | typeof pullRequests;

/**
 * Minimal chainable fake Db keyed by the leading table of each select, mirroring
 * resolveDefaultRepo.test.ts. The composer issues exactly three selects (repos,
 * boards, recorded open-PR counts) — enough to exercise the whole shape.
 */
function makeFakeDb(rowsByTable: Map<TableRef, unknown[]>) {
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    const pass = () => c;
    c.from = pass; c.where = pass; c.orderBy = pass; c.limit = pass; c.groupBy = pass;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return c;
  }
  return {
    select() {
      return { from: (table: TableRef) => chain(rowsByTable.get(table) ?? []) };
    },
  } as never;
}

/** No KV binding → getOrSetCached falls straight through to the loader. */
const ENV = { JWT_SECRET: 'test-secret' } as unknown as Env;

const REPO = (over: Record<string, unknown> = {}) => ({
  id: 'repo-1', projectId: 1, provider: 'github', host: 'github.com',
  owner: 'acme', repo: 'site', isDefault: true, credentialId: 'cred-1',
  lastSyncedAt: null, ...over,
});

const githubAuth = (over: Record<string, unknown> = {}) => ({
  ok: true,
  auth: {
    coords: { host: 'github.com', owner: 'acme', repo: 'site' },
    token: 'tok',
    authKind: 'user_token',
    repo: { id: 'repo-1', provider: 'github', projectId: 1, defaultBranch: 'main', segmentId: null },
    ...over,
  },
});

/** GitHub `Link` header for a `per_page=1` listing with `total` results. */
const linkFor = (total: number) =>
  new Headers(
    total > 1
      ? { link: `<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=${total}>; rel="last"` }
      : {},
  );

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Each case uses its OWN tenant + repo id. The per-repo probe is read-through
 * cached by `t:<tenant>:r:<repo>`, and that L1 map outlives a single assertion —
 * so distinct keys are what keep these cases independent of each other and of
 * their own second call.
 */
let nextTenant = 100;
const freshTenant = () => nextTenant++;

describe('buildProjectConnections — the projects-widget status strip', () => {
  it('reports a healthy repo with its live open-PR count and latest build', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO()]],
      [boardConnections, []],
      [pullRequests, []],
    ]));
    mocks.resolveRepoAuth.mockResolvedValue(githubAuth());
    mocks.githubRequest
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{}], headers: linkFor(4) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        data: { workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'https://gh/run/9', head_branch: 'main', updated_at: '2026-08-06T10:00:00.000Z' }] },
      });

    const [summary] = await buildProjectConnections(ENV, db, freshTenant());
    expect(summary.projectId).toBe(1);
    expect(summary.connections).toHaveLength(1);
    expect(summary.connections[0]).toMatchObject({
      kind: 'source_control',
      label: 'acme/site',
      url: 'https://github.com/acme/site',
      health: 'ok',
      reason: null,
      isDefault: true,
      openPullRequests: 4,
      openPullRequestsRecordedOnly: false,
      buildStatus: 'success',
      buildUrl: 'https://gh/run/9',
      buildBranch: 'main',
    });
  });

  it('calls an unfinished run pending, and a red one failing', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-running' })]], [boardConnections, []], [pullRequests, []],
    ]));
    mocks.resolveRepoAuth.mockResolvedValue(githubAuth());
    mocks.githubRequest
      .mockResolvedValueOnce({ ok: true, status: 200, data: [], headers: linkFor(0) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        data: { workflow_runs: [{ status: 'in_progress', conclusion: null, html_url: null, head_branch: 'main', updated_at: null }] },
      });
    const [running] = await buildProjectConnections(ENV, db, freshTenant());
    expect(running.connections[0].buildStatus).toBe('pending');

    vi.clearAllMocks();
    const redDb = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-red' })]], [boardConnections, []], [pullRequests, []],
    ]));
    mocks.resolveRepoAuth.mockResolvedValue(githubAuth());
    mocks.githubRequest
      .mockResolvedValueOnce({ ok: true, status: 200, data: [], headers: linkFor(0) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        data: { workflow_runs: [{ status: 'completed', conclusion: 'timed_out', html_url: null, head_branch: 'main', updated_at: null }] },
      });
    const [failed] = await buildProjectConnections(ENV, redDb, freshTenant());
    expect(failed.connections[0].buildStatus).toBe('failure');
  });

  it('surfaces a denied credential as a broken connection, never a green tick', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-denied' })]], [boardConnections, []], [pullRequests, []],
    ]));
    mocks.resolveRepoAuth.mockResolvedValue(githubAuth());
    mocks.githubRequest.mockResolvedValue({ ok: false, status: 401, code: 'unauthorized', reason: '401: Bad credentials' });

    const [summary] = await buildProjectConnections(ENV, db, freshTenant());
    expect(summary.connections[0]).toMatchObject({ health: 'error', reason: 'unauthorized', buildStatus: null });
  });

  it('falls back to the recorded open-PR count when the repo cannot be probed', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      // A GitLab repo is a real connection with no probe path — it must still be
      // listed, with the Builderforce-recorded PR count and an honest 'unknown'.
      [projectRepositories, [REPO({ id: 'repo-gitlab', provider: 'gitlab', host: 'gitlab.com' })]],
      [boardConnections, []],
      [pullRequests, [{ repoId: 'repo-gitlab', open: 2 }]],
    ]));

    const [summary] = await buildProjectConnections(ENV, db, freshTenant());
    expect(mocks.githubRequest).not.toHaveBeenCalled();
    expect(summary.connections[0]).toMatchObject({
      provider: 'gitlab',
      url: 'https://gitlab.com/acme/site',
      health: 'unknown',
      reason: 'not_probed',
      openPullRequests: 2,
      openPullRequestsRecordedOnly: true,
    });
  });

  it('includes external boards and maps their sync state to the shared health vocabulary', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, []],
      [boardConnections, [
        { projectId: 2, provider: 'jira', externalBoardId: 'ENG', status: 'degraded', lastPolledAt: new Date('2026-08-06T09:00:00.000Z') },
        { projectId: 2, provider: 'rally', externalBoardId: null, status: 'disabled', lastPolledAt: null },
      ]],
      [pullRequests, []],
    ]));

    const [summary] = await buildProjectConnections(ENV, db, freshTenant());
    expect(summary.projectId).toBe(2);
    expect(summary.connections).toMatchObject([
      { kind: 'board', provider: 'jira', label: 'ENG', health: 'degraded', lastSyncedAt: '2026-08-06T09:00:00.000Z' },
      { kind: 'board', provider: 'rally', label: 'rally', health: 'error', reason: 'disabled' },
    ]);
  });

  it('returns nothing for a tenant with no connections at all', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, []], [boardConnections, []], [pullRequests, []],
    ]));
    expect(await buildProjectConnections(ENV, db, freshTenant())).toEqual([]);
  });
});
