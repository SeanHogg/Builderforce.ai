/**
 * Multi-repo spanning (migration 0956).
 *
 * Three properties are load-bearing and are pinned here:
 *   1. a file write is routed to the repo whose pathGlobs claim it;
 *   2. a bound repo that received NO writes opens NO pull request;
 *   3. the single-repo case is unchanged — one repo resolved, `forPath` always
 *      that repo, and finalize opens exactly the one PR it always opened.
 *
 * The router and the PR-set opener are driven for real; only the two seams they
 * cannot own (the database and the git provider) are faked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { TicketRepoContext } from './commitFileAsPendingChange';

vi.mock('./commitFileAsPendingChange', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commitFileAsPendingChange')>();
  return { ...actual, resolveTicketRepoContext: vi.fn() };
});
vi.mock('./resolveRepoCredential', () => ({
  resolveRepoCredential: vi.fn(),
  isResolveError: (v: unknown) => !!v && typeof v === 'object' && 'error' in (v as object),
}));
vi.mock('./createPullRequest', () => ({ createPullRequest: vi.fn() }));
vi.mock('./recordPullRequestRow', () => ({ recordPullRequestRow: vi.fn(async () => ({ id: 'pr-row' })) }));

import { resolveTicketRepoContext } from './commitFileAsPendingChange';
import { resolveRepoCredential } from './resolveRepoCredential';
import { createPullRequest } from './createPullRequest';
import { resolveTaskRepoRouter, listSpanningRepoWrites } from './taskRepoSet';
import { openTaskRepoSetPullRequests } from './openTaskPullRequest';

const TENANT = 42;
const TASK = 7;

const ctx = (over: Partial<TicketRepoContext> = {}): TicketRepoContext => ({
  provider: 'github', host: null, owner: 'acme', repo: 'api', token: 't',
  branch: 'builderforce/task-7', base: 'main',
  repoId: 'repo-api', segmentId: null, projectId: 1,
  ...over,
});

/** Rows `listTaskRepoBindings` would return, as the joined select shape. */
interface BindingRow {
  id: string;
  repoId: string;
  overrideHints: string | null;
  branch: string | null;
  writesCount: number;
  prUrl: string | null;
  prNumber: number | null;
  prStatus: string | null;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  isDefault: boolean;
  repoHints: string | null;
}

function binding(over: Partial<BindingRow> = {}): BindingRow {
  return {
    id: `b-${over.repoId ?? 'x'}`,
    repoId: 'repo-api',
    overrideHints: null,
    branch: 'builderforce/task-7',
    writesCount: 0,
    prUrl: null,
    prNumber: null,
    prStatus: null,
    provider: 'github',
    owner: 'acme',
    repo: 'api',
    defaultBranch: 'main',
    isDefault: true,
    repoHints: null,
    ...over,
  };
}

/**
 * Fake Db serving exactly the one read shape this module uses:
 *   db.select({...}).from(t).innerJoin(t2, on).where(w).orderBy(o)  → rows
 */
function fakeDb(rows: BindingRow[]): Db {
  const result = {
    from: () => result,
    innerJoin: () => result,
    where: () => result,
    orderBy: async () => rows,
    limit: async () => rows,
  } as unknown as Record<string, unknown>;
  return { select: () => result } as unknown as Db;
}

const hints = (pathGlobs: string[]) => JSON.stringify({ pathGlobs });

beforeEach(() => vi.clearAllMocks());

describe('resolveTaskRepoRouter — the single-repo case is unchanged', () => {
  it('with no bindings, every path routes to the resolved primary', async () => {
    const primary = ctx();
    const router = await resolveTaskRepoRouter(fakeDb([]), 's', TENANT, TASK, { ctx: primary, reason: '' });

    expect(router.all).toEqual([primary]);
    expect(router.forPath('frontend/src/App.tsx')).toBe(primary);
    expect(router.forPath('api/src/x.ts')).toBe(primary);
    // No extra repo ⇒ no extra credential was decrypted.
    expect(resolveRepoCredential).not.toHaveBeenCalled();
  });

  it('bound only to the repo it already resolves to is still the single-repo case', async () => {
    const primary = ctx();
    const router = await resolveTaskRepoRouter(
      fakeDb([binding({ repoId: 'repo-api', writesCount: 3 })]),
      's', TENANT, TASK, { ctx: primary, reason: '' },
    );
    expect(router.all).toHaveLength(1);
    expect(router.forPath('anything.ts')).toBe(primary);
  });

  it('resolves the primary itself when the caller supplies none', async () => {
    vi.mocked(resolveTicketRepoContext).mockResolvedValue({ ok: false, reason: 'no repo bound to this task' });
    const router = await resolveTaskRepoRouter(fakeDb([]), 's', TENANT, TASK);
    expect(router.primary).toBeNull();
    expect(router.reason).toBe('no repo bound to this task');
    expect(router.forPath('a.ts')).toBeNull();
  });
});

describe('resolveTaskRepoRouter — spanning', () => {
  it('routes each write to the repo whose pathGlobs claim it', async () => {
    const primary = ctx({ repoId: 'repo-api' });
    vi.mocked(resolveRepoCredential).mockResolvedValue({
      repo: { id: 'repo-web', provider: 'github', host: null, owner: 'acme', repo: 'web', defaultBranch: 'main', projectId: 1, segmentId: null },
      token: 't2',
    });
    const router = await resolveTaskRepoRouter(
      fakeDb([
        binding({ repoId: 'repo-api', repoHints: hints(['api/**']) }),
        binding({ repoId: 'repo-web', repo: 'web', isDefault: false, repoHints: hints(['frontend/**']) }),
      ]),
      's', TENANT, TASK, { ctx: primary, reason: '' },
    );

    expect(router.all.map((c) => c.repoId)).toEqual(['repo-api', 'repo-web']);
    expect(router.forPath('api/src/routes/x.ts')?.repoId).toBe('repo-api');
    expect(router.forPath('frontend/src/App.tsx')?.repoId).toBe('repo-web');
    // Unclaimed paths still land somewhere — never dropped.
    expect(router.forPath('scripts/tool.sh')?.repoId).toBe('repo-api');
  });

  it('a per-task matchHints override beats the repo-wide hints', async () => {
    const primary = ctx({ repoId: 'repo-api' });
    vi.mocked(resolveRepoCredential).mockResolvedValue({
      repo: { id: 'repo-docs', provider: 'github', host: null, owner: 'acme', repo: 'docs', defaultBranch: 'main', projectId: 1, segmentId: null },
      token: 't2',
    });
    const router = await resolveTaskRepoRouter(
      fakeDb([
        binding({ repoId: 'repo-api' }),
        binding({ repoId: 'repo-docs', repo: 'docs', isDefault: false, repoHints: hints(['never/**']), overrideHints: hints(['docs/**']) }),
      ]),
      's', TENANT, TASK, { ctx: primary, reason: '' },
    );
    expect(router.forPath('docs/guide.md')?.repoId).toBe('repo-docs');
    expect(router.forPath('never/x.ts')?.repoId).toBe('repo-api');
  });

  it('an extra repo with no usable credential degrades to single-repo, never dropping writes', async () => {
    const primary = ctx({ repoId: 'repo-api' });
    vi.mocked(resolveRepoCredential).mockResolvedValue({ error: 'Repository has no linked credential', status: 400 });
    const router = await resolveTaskRepoRouter(
      fakeDb([
        binding({ repoId: 'repo-api' }),
        binding({ repoId: 'repo-web', repo: 'web', isDefault: false, repoHints: hints(['frontend/**']) }),
      ]),
      's', TENANT, TASK, { ctx: primary, reason: '' },
    );
    expect(router.all).toEqual([primary]);
    expect(router.forPath('frontend/src/App.tsx')).toBe(primary);
  });
});

describe('listSpanningRepoWrites', () => {
  it('returns only bound repos that received writes and are not the primary', async () => {
    const db = fakeDb([
      binding({ repoId: 'repo-api', writesCount: 4 }),                                   // primary
      binding({ repoId: 'repo-web', repo: 'web', isDefault: false, writesCount: 2 }),     // wrote
      binding({ repoId: 'repo-docs', repo: 'docs', isDefault: false, writesCount: 0 }),   // untouched
      binding({ repoId: 'repo-ops', repo: 'ops', isDefault: false, writesCount: 1, prUrl: 'https://x/1' }), // already has a PR
    ]);
    const pending = await listSpanningRepoWrites(db, TENANT, TASK, 'repo-api');
    expect(pending.map((p) => p.repoId)).toEqual(['repo-web']);
  });
});

describe('openTaskRepoSetPullRequests', () => {
  it('opens NO PR for a single-repo task', async () => {
    const opened = await openTaskRepoSetPullRequests(
      fakeDb([binding({ repoId: 'repo-api', writesCount: 9 })]),
      's', TENANT, TASK, 'repo-api', { title: 't', body: 'b' },
    );
    expect(opened).toEqual([]);
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it('opens one PR per repo that received writes, and skips the ones that did not', async () => {
    vi.mocked(resolveRepoCredential).mockResolvedValue({
      repo: { id: 'repo-web', provider: 'github', host: null, owner: 'acme', repo: 'web', defaultBranch: 'main', projectId: 1, segmentId: null },
      token: 't2',
    });
    vi.mocked(createPullRequest).mockResolvedValue({ ok: true, url: 'https://github.com/acme/web/pull/9', number: 9 });

    // The fake db serves the same rows to every read, including the binding
    // UPDATE's read-back, so only the write-count filter decides who gets a PR.
    const db = fakeDb([
      binding({ repoId: 'repo-api', writesCount: 5 }),
      binding({ repoId: 'repo-web', repo: 'web', isDefault: false, writesCount: 2 }),
      binding({ repoId: 'repo-docs', repo: 'docs', isDefault: false, writesCount: 0 }),
    ]);
    (db as unknown as { update: unknown }).update = () => ({
      set: () => ({ where: async () => undefined }),
    });

    const opened = await openTaskRepoSetPullRequests(db, 's', TENANT, TASK, 'repo-api', { title: 't', body: 'b' });

    expect(createPullRequest).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([
      { repoId: 'repo-web', slug: 'acme/web', branch: 'builderforce/task-7', url: 'https://github.com/acme/web/pull/9', number: 9 },
    ]);
  });

  it('reports a provider failure per repo instead of failing the run', async () => {
    vi.mocked(resolveRepoCredential).mockResolvedValue({
      repo: { id: 'repo-web', provider: 'github', host: null, owner: 'acme', repo: 'web', defaultBranch: 'main', projectId: 1, segmentId: null },
      token: 't2',
    });
    vi.mocked(createPullRequest).mockResolvedValue({ ok: false, code: 'provider_error', reason: 'no commits between' });

    const db = fakeDb([binding({ repoId: 'repo-web', repo: 'web', isDefault: false, writesCount: 1 })]);
    const opened = await openTaskRepoSetPullRequests(db, 's', TENANT, TASK, 'repo-api', { title: 't', body: 'b' });

    expect(opened).toEqual([
      { repoId: 'repo-web', slug: 'acme/web', branch: 'builderforce/task-7', error: 'no commits between' },
    ]);
  });
});
