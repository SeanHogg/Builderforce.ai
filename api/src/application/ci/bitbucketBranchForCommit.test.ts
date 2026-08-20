/**
 * bitbucketBranchForCommit — the refs-API lookup that restores PRE-merge correlation
 * for a commit status posted without `refname`. Only the cached fetch half is
 * exercised here; the DB half is a straight `resolveRepoCredential` lookup.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBitbucketBranchForCommit } from './bitbucketBranchForCommit';

afterEach(() => vi.unstubAllGlobals());

// No KV binding → getOrSetCached falls straight through to the loader.
const env = {} as unknown as import('../../env').Env;
const base = { host: 'bitbucket.org', owner: 'ws', repo: 'app', token: 'tok' };

const branchPage = (branches: Array<[string, string]>) =>
  new Response(JSON.stringify({ values: branches.map(([name, hash]) => ({ name, target: { hash } })) }), { status: 200 });

describe('fetchBitbucketBranchForCommit', () => {
  it('resolves the branch from the server-side hash filter in one request', async () => {
    const fetchSpy = vi.fn(async (_url: string) => branchPage([['builderforce/task-12', 'cafe1']]));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchBitbucketBranchForCommit(env, { ...base, sha: 'cafe1' })).toBe('builderforce/task-12');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/repositories/ws/app/refs/branches');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('target.hash');
  });

  it('falls back to scanning recent branches when the filter is ignored', async () => {
    // The filtered call comes back with everything (filter ignored / no match), so
    // the second, most-recently-updated page is what actually decides.
    const fetchSpy = vi.fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(branchPage([]))
      .mockResolvedValueOnce(branchPage([['main', 'aaa'], ['builderforce/task-31', 'cafe2']]));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchBitbucketBranchForCommit(env, { ...base, sha: 'cafe2' })).toBe('builderforce/task-31');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('sort=-target.date');
  });

  it('matches a shortened status hash against the full branch head', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => branchPage([['builderforce/task-9', 'abcdef1234567890']])));
    expect(await fetchBitbucketBranchForCommit(env, { ...base, sha: 'abcdef1' })).toBe('builderforce/task-9');
  });

  it('returns null when no branch heads the commit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => branchPage([['main', 'aaa']])));
    expect(await fetchBitbucketBranchForCommit(env, { ...base, sha: 'nope1' })).toBeNull();
  });

  it('resolves on Bitbucket Server from its own branches API, in ONE request', async () => {
    // Server has no hash filter at all, so there is no first "filtered" call to make:
    // one `details=true` scan is the whole lookup. `latestCommit`/`displayId` is the
    // Server envelope; the caller still just gets a branch name.
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({
      values: [
        { displayId: 'main', latestCommit: 'aaa' },
        { displayId: 'builderforce/task-77', latestCommit: 'beef1234' },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchBitbucketBranchForCommit(env, { ...base, host: 'bb.internal.acme.com', sha: 'beef1234' }))
      .toBe('builderforce/task-77');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain('/rest/api/1.0/projects/ws/repos/app/branches');
    // Without details=true every entry's latestCommit is absent and the scan matches
    // nothing — the flag is load-bearing, not decoration.
    expect(url).toContain('details=true');
  });

  it('returns null on Server when no branch heads the commit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ values: [{ displayId: 'main', latestCommit: 'aaa' }] }), { status: 200 })));
    expect(await fetchBitbucketBranchForCommit(env, { ...base, host: 'bb.internal.acme.com', sha: 'zzz9' })).toBeNull();
  });

  it('degrades to null when the refs API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    expect(await fetchBitbucketBranchForCommit(env, { ...base, sha: 'x2' })).toBeNull();
  });
});
