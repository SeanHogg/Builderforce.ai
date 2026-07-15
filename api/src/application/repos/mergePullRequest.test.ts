import { describe, it, expect, vi, afterEach } from 'vitest';
import { mergePullRequest, normalizeMergeMethod, buildMergeRequest } from './mergePullRequest';
import { cloudAutoMergeEnabled, cloudAutoMergeRequiresGreen } from './mergeBranchToBase';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('cloudAutoMergeEnabled', () => {
  it('defaults to false (approval-gated) when unset', () => {
    expect(cloudAutoMergeEnabled(undefined)).toBe(false);
    expect(cloudAutoMergeEnabled({})).toBe(false);
    expect(cloudAutoMergeEnabled({ CLOUD_AUTOMERGE_ENABLED: '' })).toBe(false);
  });
  it('is true only for explicit 1/true', () => {
    expect(cloudAutoMergeEnabled({ CLOUD_AUTOMERGE_ENABLED: '1' })).toBe(true);
    expect(cloudAutoMergeEnabled({ CLOUD_AUTOMERGE_ENABLED: 'true' })).toBe(true);
    expect(cloudAutoMergeEnabled({ CLOUD_AUTOMERGE_ENABLED: 'TRUE' })).toBe(true);
    expect(cloudAutoMergeEnabled({ CLOUD_AUTOMERGE_ENABLED: 'no' })).toBe(false);
  });
  it('is independent of the green-CI gate', () => {
    expect(cloudAutoMergeRequiresGreen({ CLOUD_AUTOMERGE_REQUIRE_GREEN: '1' })).toBe(true);
    expect(cloudAutoMergeEnabled({ CLOUD_AUTOMERGE_REQUIRE_GREEN: '1' })).toBe(false);
  });
});

describe('normalizeMergeMethod', () => {
  it('passes through valid methods', () => {
    expect(normalizeMergeMethod('squash')).toBe('squash');
    expect(normalizeMergeMethod('merge')).toBe('merge');
    expect(normalizeMergeMethod('rebase')).toBe('rebase');
  });
  it('defaults anything else to squash', () => {
    expect(normalizeMergeMethod(undefined)).toBe('squash');
    expect(normalizeMergeMethod('fast-forward')).toBe('squash');
    expect(normalizeMergeMethod(42)).toBe('squash');
  });
});

describe('buildMergeRequest — per-provider endpoints/method/body [1278]', () => {
  const b = { host: null, owner: 'acme', repo: 'app', token: 't', number: 42 } as const;

  it('GitHub: PUT pulls/:n/merge + merge_method', () => {
    const r = buildMergeRequest({ ...b, provider: 'github', method: 'merge' });
    expect(r).toMatchObject({ method: 'PUT', url: 'https://api.github.com/repos/acme/app/pulls/42/merge', body: { merge_method: 'merge' } });
  });
  it('GitHub Enterprise host → /api/v3', () => {
    expect(buildMergeRequest({ ...b, provider: 'github', host: 'ghe.acme.com' }).url)
      .toBe('https://ghe.acme.com/api/v3/repos/acme/app/pulls/42/merge');
  });
  it('GitLab: PUT merge_requests/:iid/merge with URL-encoded project + squash bool', () => {
    const r = buildMergeRequest({ ...b, provider: 'gitlab', method: 'squash' });
    expect(r).toMatchObject({ method: 'PUT', url: 'https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests/42/merge', body: { squash: true } });
    expect(buildMergeRequest({ ...b, provider: 'gitlab', method: 'merge' }).body).toMatchObject({ squash: false });
  });
  it('Bitbucket Cloud: POST pullrequests/:id/merge with merge_strategy mapping', () => {
    expect(buildMergeRequest({ ...b, provider: 'bitbucket', method: 'squash' })).toMatchObject({
      method: 'POST', url: 'https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/42/merge', body: { merge_strategy: 'squash' },
    });
    expect(buildMergeRequest({ ...b, provider: 'bitbucket', method: 'merge' }).body).toMatchObject({ merge_strategy: 'merge_commit' });
    expect(buildMergeRequest({ ...b, provider: 'bitbucket', method: 'rebase' }).body).toMatchObject({ merge_strategy: 'fast_forward' });
  });
  it('Bitbucket Server (custom host) throws → route maps to 501', () => {
    expect(() => buildMergeRequest({ ...b, provider: 'bitbucket', host: 'bb.acme.com' })).toThrow();
  });
});

describe('mergePullRequest', () => {
  const base = { host: null, owner: 'acme', repo: 'app', token: 'tok', number: 7 };

  it('returns unsupported for an unknown provider without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await mergePullRequest({ ...base, provider: 'gitea' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('merges a GitLab MR (PUT, state=merged → ok) [1278]', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ state: 'merged', merge_commit_sha: 'gl-sha' }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await mergePullRequest({ ...base, provider: 'gitlab', method: 'squash' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.sha).toBe('gl-sha');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests/7/merge');
    expect(init.method).toBe('PUT');
  });

  it('merges a Bitbucket PR (POST, state=MERGED → ok) [1278]', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ state: 'MERGED', merge_commit: { hash: 'bb-sha' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await mergePullRequest({ ...base, provider: 'bitbucket', method: 'merge' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.sha).toBe('bb-sha');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/7/merge');
    expect(init.method).toBe('POST');
  });

  it('merges via PUT /pulls/{n}/merge with the chosen method', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ merged: true, sha: 'abc123' }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await mergePullRequest({ ...base, provider: 'github', method: 'squash' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.sha).toBe('abc123');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/acme/app/pulls/7/merge');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toMatchObject({ merge_method: 'squash' });
  });

  it('maps 405 to not_mergeable and 409 to conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      message: 'Pull Request is not mergeable',
      documentation_url: 'https://docs.github.com/rest/pulls/pulls#merge-a-pull-request',
    }, 405)));
    const a = await mergePullRequest({ ...base, provider: 'github' });
    expect(a.ok ? '' : a.code).toBe('not_mergeable');
    expect(a.ok ? '' : a.reason).toContain('Pull Request is not mergeable');
    expect(a.ok ? '' : a.reason).toContain("whether 'squash' merges are enabled");
    expect(a.ok ? '' : a.reason).not.toContain('documentation_url');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('head moved', { status: 409 })));
    const b = await mergePullRequest({ ...base, provider: 'github' });
    expect(b.ok ? '' : b.code).toBe('conflict');
  });

  it('maps other non-OK statuses to provider_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const r = await mergePullRequest({ ...base, provider: 'github' });
    expect(r.ok ? '' : r.code).toBe('provider_error');
  });
});
