import { describe, it, expect, vi, afterEach } from 'vitest';
import { mergePullRequest, normalizeMergeMethod } from './mergePullRequest';
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

describe('mergePullRequest', () => {
  const base = { host: null, owner: 'acme', repo: 'app', token: 'tok', number: 7 };

  it('returns unsupported for non-github providers without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await mergePullRequest({ ...base, provider: 'gitlab' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('blocked', { status: 405 })));
    const a = await mergePullRequest({ ...base, provider: 'github' });
    expect(a.ok ? '' : a.code).toBe('not_mergeable');

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
