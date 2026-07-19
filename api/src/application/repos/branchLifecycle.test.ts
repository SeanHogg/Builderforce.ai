/**
 * Per-provider request construction + response mapping for the destructive repo
 * operations. Mirrors createPullRequest.test.ts / mergePullRequest.test.ts: the
 * pure builders are asserted against each provider's documented endpoint, and the
 * executors are asserted through a stubbed fetch so the error mapping (especially
 * "already merged" and "protected branch") is pinned down.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildDeleteBranchRequest, buildClosePrRequest, buildListBranchCommitsUrl, parseBranchCommits,
  deleteBranch, closePullRequest, listBranchCommits,
  MAX_BRANCH_COMMITS, MAX_TOTAL_BRANCH_COMMITS,
} from './branchLifecycle';

const target = { host: null, owner: 'acme', repo: 'app', token: 't0k' };
const BRANCH = 'builderforce/task-12';

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(res: { status: number; ok?: boolean; payload?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    json: async () => res.payload ?? null,
    text: async () => (typeof res.payload === 'string' ? res.payload : JSON.stringify(res.payload ?? '')),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('buildDeleteBranchRequest', () => {
  it('GitHub deletes the heads ref, preserving the branch slash', () => {
    const r = buildDeleteBranchRequest({ ...target, provider: 'github', branch: BRANCH });
    expect(r).toEqual({ url: 'https://api.github.com/repos/acme/app/git/refs/heads/builderforce/task-12', method: 'DELETE' });
  });

  it('GitLab encodes the branch as ONE path component', () => {
    const r = buildDeleteBranchRequest({ ...target, provider: 'gitlab', branch: BRANCH });
    expect(r.url).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/repository/branches/builderforce%2Ftask-12');
  });

  it('Bitbucket Cloud deletes via refs/branches', () => {
    const r = buildDeleteBranchRequest({ ...target, provider: 'bitbucket', branch: BRANCH });
    expect(r.url).toBe('https://api.bitbucket.org/2.0/repositories/acme/app/refs/branches/builderforce/task-12');
  });

  it('Bitbucket Server uses the branch-utils API and names the ref in the body', () => {
    const r = buildDeleteBranchRequest({ ...target, host: 'git.acme.internal', provider: 'bitbucket', branch: BRANCH });
    expect(r).toEqual({
      url: 'https://git.acme.internal/rest/branch-utils/1.0/projects/acme/repos/app/branches',
      method: 'DELETE',
      body: { name: 'refs/heads/builderforce/task-12', dryRun: false },
    });
  });
});

describe('buildClosePrRequest', () => {
  it('GitHub PATCHes state=closed', () => {
    expect(buildClosePrRequest({ ...target, provider: 'github', number: 7 })).toEqual({
      url: 'https://api.github.com/repos/acme/app/pulls/7', method: 'PATCH', body: { state: 'closed' },
    });
  });

  it('GitLab PUTs the close state_event', () => {
    expect(buildClosePrRequest({ ...target, provider: 'gitlab', number: 7 })).toEqual({
      url: 'https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests/7', method: 'PUT', body: { state_event: 'close' },
    });
  });

  it('Bitbucket Cloud POSTs to decline', () => {
    expect(buildClosePrRequest({ ...target, provider: 'bitbucket', number: 7 })).toEqual({
      url: 'https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/7/decline', method: 'POST', body: {},
    });
  });

  it('Bitbucket Server declines through the 1.0 project/repo path', () => {
    expect(buildClosePrRequest({ ...target, host: 'git.acme.internal', provider: 'bitbucket', number: 7 })).toEqual({
      url: 'https://git.acme.internal/rest/api/1.0/projects/acme/repos/app/pull-requests/7/decline?version=-1',
      method: 'POST',
      body: {},
    });
  });
});

describe('buildListBranchCommitsUrl', () => {
  const args = { ...target, base: 'main', branch: BRANCH };
  it('GitHub uses the three-dot compare range, paged', () => {
    expect(buildListBranchCommitsUrl({ ...args, provider: 'github' }))
      .toBe('https://api.github.com/repos/acme/app/compare/main...builderforce%2Ftask-12?per_page=100&page=1');
    expect(buildListBranchCommitsUrl({ ...args, provider: 'github' }, 3)).toContain('&page=3');
  });
  it('GitLab uses the PAGED commits endpoint with a base..branch range (compare cannot page)', () => {
    expect(buildListBranchCommitsUrl({ ...args, provider: 'gitlab' }, 2))
      .toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/repository/commits'
        + '?ref_name=main..builderforce%2Ftask-12&per_page=100&page=2');
  });
  it('Bitbucket Cloud uses include/exclude on /commits, paged', () => {
    expect(buildListBranchCommitsUrl({ ...args, provider: 'bitbucket' }, 4))
      .toContain('/commits?include=builderforce%2Ftask-12&exclude=main&pagelen=100&page=4');
  });
  it('Bitbucket Server uses since/until with an offset-based page', () => {
    expect(buildListBranchCommitsUrl({ ...args, host: 'git.acme.internal', provider: 'bitbucket' }, 3))
      .toBe('https://git.acme.internal/rest/api/1.0/projects/acme/repos/app/commits'
        + '?until=builderforce%2Ftask-12&since=main&limit=100&start=200');
  });
});

describe('parseBranchCommits', () => {
  it('normalises GitHub commits', () => {
    expect(parseBranchCommits('github', { commits: [{ sha: 'a1', commit: { message: 'm', author: { name: 'N' } } }] }))
      .toEqual([{ sha: 'a1', message: 'm', authorName: 'N' }]);
  });
  it('normalises GitLab commits', () => {
    expect(parseBranchCommits('gitlab', { commits: [{ id: 'b2', message: 'm', author_name: 'N' }] }))
      .toEqual([{ sha: 'b2', message: 'm', authorName: 'N' }]);
  });
  it('normalises GitLab commits from the bare-array commits endpoint', () => {
    expect(parseBranchCommits('gitlab', [{ id: 'b2', title: 't', author_name: 'N' }]))
      .toEqual([{ sha: 'b2', message: 't', authorName: 'N' }]);
  });
  it('normalises Bitbucket Cloud commits', () => {
    expect(parseBranchCommits('bitbucket', { values: [{ hash: 'c3', message: 'm', author: { raw: 'N <n@x>' } }] }))
      .toEqual([{ sha: 'c3', message: 'm', authorName: 'N <n@x>' }]);
  });
  it('normalises Bitbucket Server commits (id + author.displayName)', () => {
    expect(parseBranchCommits('bitbucket', { values: [{ id: 'd4', message: 'm', author: { displayName: 'N' } }] }))
      .toEqual([{ sha: 'd4', message: 'm', authorName: 'N' }]);
  });
});

describe('deleteBranch', () => {
  it('reports an unsupported provider rather than silently no-opping', async () => {
    const r = await deleteBranch({ ...target, provider: 'gitea', branch: BRANCH });
    expect(r).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('deletes on Bitbucket Server (self-hosted) instead of refusing as unsupported', async () => {
    const fn = stubFetch({ status: 204 });
    const r = await deleteBranch({ ...target, host: 'git.acme.internal', provider: 'bitbucket', branch: BRANCH });
    expect(r).toEqual({ ok: true, deleted: true });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/branch-utils/1.0/projects/acme/repos/app/branches');
    expect(JSON.parse(String(init.body))).toEqual({ name: `refs/heads/${BRANCH}`, dryRun: false });
  });

  it('refuses an empty branch name', async () => {
    const r = await deleteBranch({ ...target, provider: 'github', branch: '  ' });
    expect(r.ok).toBe(false);
  });

  it('treats a 404 as idempotently already-gone', async () => {
    stubFetch({ status: 404 });
    expect(await deleteBranch({ ...target, provider: 'github', branch: BRANCH })).toEqual({ ok: true, deleted: false });
  });

  it('maps a 403 to protected', async () => {
    stubFetch({ status: 403, payload: 'protected branch' });
    expect(await deleteBranch({ ...target, provider: 'github', branch: BRANCH })).toMatchObject({ ok: false, code: 'protected' });
  });

  it('maps a network failure to provider_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await deleteBranch({ ...target, provider: 'github', branch: BRANCH })).toMatchObject({ ok: false, code: 'provider_error' });
  });

  it('succeeds on 204', async () => {
    stubFetch({ status: 204 });
    expect(await deleteBranch({ ...target, provider: 'gitlab', branch: BRANCH })).toEqual({ ok: true, deleted: true });
  });
});

describe('closePullRequest', () => {
  it('reports an unsupported provider', async () => {
    expect(await closePullRequest({ ...target, provider: 'gitea', number: 7 })).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('detects an already-merged PR instead of reporting success', async () => {
    stubFetch({ status: 422, payload: '{"message":"Pull request is already merged"}' });
    expect(await closePullRequest({ ...target, provider: 'github', number: 7 }))
      .toMatchObject({ ok: false, code: 'already_merged' });
  });

  it('maps a 404 to not_found', async () => {
    stubFetch({ status: 404 });
    expect(await closePullRequest({ ...target, provider: 'github', number: 7 })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('closes on 200', async () => {
    stubFetch({ status: 200, payload: {} });
    expect(await closePullRequest({ ...target, provider: 'bitbucket', number: 7 })).toEqual({ ok: true, closed: true });
  });
});

describe('listBranchCommits', () => {
  it('returns an empty list when the branch does not exist (404)', async () => {
    stubFetch({ status: 404 });
    expect(await listBranchCommits({ ...target, provider: 'github', base: 'main', branch: BRANCH }))
      .toEqual({ ok: true, commits: [], truncated: false });
  });

  it('short-circuits when branch === base', async () => {
    const fn = stubFetch({ status: 200, payload: {} });
    expect(await listBranchCommits({ ...target, provider: 'github', base: 'main', branch: 'main' }))
      .toEqual({ ok: true, commits: [], truncated: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('surfaces a provider error rather than an empty (falsely safe) list', async () => {
    stubFetch({ status: 500, payload: 'boom' });
    expect(await listBranchCommits({ ...target, provider: 'github', base: 'main', branch: BRANCH }))
      .toMatchObject({ ok: false, code: 'provider_error' });
  });

  it('flags truncation past the cap so the decision can refuse', async () => {
    const commits = Array.from({ length: 101 }, (_, i) => ({ sha: `s${i}`, commit: { message: 'm', author: { name: 'n' } } }));
    stubFetch({ status: 200, payload: { commits } });
    const r = await listBranchCommits({ ...target, provider: 'github', base: 'main', branch: BRANCH });
    expect(r).toMatchObject({ ok: true, truncated: true });
    if (r.ok) expect(r.commits).toHaveLength(100);
  });
});
