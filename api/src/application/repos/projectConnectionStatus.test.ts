import { describe, expect, it } from 'vitest';
import { boardConnections, projectRepositories, pullRequests, repoDeliveryStatus } from '../../infrastructure/database/schema';
import { buildProjectConnections } from './projectConnectionStatus';
import type { Env } from '../../env';

type TableRef = typeof projectRepositories | typeof boardConnections | typeof pullRequests | typeof repoDeliveryStatus;

/**
 * Minimal chainable fake Db keyed by the leading table of each select, mirroring
 * resolveDefaultRepo.test.ts. The composer issues exactly four selects (repos,
 * boards, recorded open-PR counts, persisted delivery verdicts) and — the point of
 * this suite since the sweep took over — NO provider call of any kind.
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

const ENV = { JWT_SECRET: 'test-secret' } as unknown as Env;

const REPO = (over: Record<string, unknown> = {}) => ({
  id: 'repo-1', projectId: 1, provider: 'github', host: 'github.com',
  owner: 'acme', repo: 'site', isDefault: true, credentialId: 'cred-1',
  lastSyncedAt: null, ...over,
});

/** A row as `repo_delivery_status` holds it — what the sweep wrote. */
const VERDICT = (over: Record<string, unknown> = {}) => ({
  repoId: 'repo-1', tenantId: 1, health: 'ok', reason: null,
  openPullRequests: 4, buildStatus: 'success', buildUrl: 'https://gh/run/9',
  buildBranch: 'main', buildAt: new Date('2026-08-06T10:00:00.000Z'),
  probedAt: new Date('2026-08-06T10:01:00.000Z'), ...over,
});

type Summary = Awaited<ReturnType<typeof buildProjectConnections>>[number];

function only(rows: Summary[]): Summary {
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function firstConnection(rows: Summary[]): Summary['connections'][number] {
  const [connection] = only(rows).connections;
  expect(connection).toBeDefined();
  return connection!;
}

describe('buildProjectConnections — the projects-widget status strip', () => {
  it('serves the swept verdict: open-PR count, build, and how old the answer is', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO()]],
      [boardConnections, []],
      [pullRequests, []],
      [repoDeliveryStatus, [VERDICT()]],
    ]));

    const summary = only(await buildProjectConnections(ENV, db, 1));
    expect(summary.projectId).toBe(1);
    expect(summary.connections[0]!).toMatchObject({
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
      buildAt: '2026-08-06T10:00:00.000Z',
      buildProbedAt: '2026-08-06T10:01:00.000Z',
    });
  });

  it('surfaces a denied credential as a broken connection, never a green tick', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-denied' })]], [boardConnections, []], [pullRequests, []],
      [repoDeliveryStatus, [VERDICT({
        repoId: 'repo-denied', health: 'error', reason: 'unauthorized',
        openPullRequests: null, buildStatus: null, buildUrl: null,
      })]],
    ]));

    expect(firstConnection(await buildProjectConnections(ENV, db, 1)))
      .toMatchObject({ health: 'error', reason: 'unauthorized', buildStatus: null });
  });

  it('reports a GitLab repo\'s build — the cohort that could only ever say `unknown`', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-gitlab', provider: 'gitlab', host: 'gitlab.com' })]],
      [boardConnections, []],
      [pullRequests, [{ repoId: 'repo-gitlab', open: 2 }]],
      [repoDeliveryStatus, [VERDICT({ repoId: 'repo-gitlab', openPullRequests: 7, buildStatus: 'failure', buildUrl: 'https://gitlab.com/acme/site/-/pipelines/3' })]],
    ]));

    expect(firstConnection(await buildProjectConnections(ENV, db, 1))).toMatchObject({
      provider: 'gitlab',
      url: 'https://gitlab.com/acme/site',
      health: 'ok',
      openPullRequests: 7,
      // The provider's own count, not the Builderforce-recorded 2.
      openPullRequestsRecordedOnly: false,
      buildStatus: 'failure',
    });
  });

  it('falls back to the recorded PR count for a repo the sweep has not reached yet', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-new' })]],
      [boardConnections, []],
      [pullRequests, [{ repoId: 'repo-new', open: 2 }]],
      [repoDeliveryStatus, []],
    ]));

    expect(firstConnection(await buildProjectConnections(ENV, db, 1))).toMatchObject({
      health: 'unknown',
      reason: 'not_probed',
      openPullRequests: 2,
      openPullRequestsRecordedOnly: true,
      buildStatus: null,
      buildProbedAt: null,
    });
  });

  it('says `no_credential` for an unprobeable repo rather than blaming the sweep', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, [REPO({ id: 'repo-nocred', credentialId: null })]],
      [boardConnections, []], [pullRequests, []], [repoDeliveryStatus, []],
    ]));

    expect(firstConnection(await buildProjectConnections(ENV, db, 1)))
      .toMatchObject({ health: 'unknown', reason: 'no_credential' });
  });

  it('includes external boards and maps their sync state to the shared health vocabulary', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, []],
      [boardConnections, [
        { projectId: 2, provider: 'jira', externalBoardId: 'ENG', status: 'degraded', lastPolledAt: new Date('2026-08-06T09:00:00.000Z') },
        { projectId: 2, provider: 'rally', externalBoardId: null, status: 'disabled', lastPolledAt: null },
      ]],
      [pullRequests, []],
      [repoDeliveryStatus, []],
    ]));

    const summary = only(await buildProjectConnections(ENV, db, 1));
    expect(summary.projectId).toBe(2);
    expect(summary.connections).toMatchObject([
      { kind: 'board', provider: 'jira', label: 'ENG', health: 'degraded', lastSyncedAt: '2026-08-06T09:00:00.000Z' },
      { kind: 'board', provider: 'rally', label: 'rally', health: 'error', reason: 'disabled' },
    ]);
  });

  it('returns nothing for a tenant with no connections at all', async () => {
    const db = makeFakeDb(new Map<TableRef, unknown[]>([
      [projectRepositories, []], [boardConnections, []], [pullRequests, []], [repoDeliveryStatus, []],
    ]));
    expect(await buildProjectConnections(ENV, db, 1)).toEqual([]);
  });
});
