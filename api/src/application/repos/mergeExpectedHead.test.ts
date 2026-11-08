import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMergeRequest, mergePullRequest } from './mergePullRequest';
import { mergeBranchToBase } from './mergeBranchToBase';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const MOVED = 'ffffffffffffffffffffffffffffffffffffffff';
const base = { host: null, owner: 'acme', repo: 'api', token: 't', number: 7, expectedHeadSha: SHA };

afterEach(() => vi.unstubAllGlobals());

/** Stub global fetch with a scripted list of responses, recording each request. */
function scripted(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
  return calls;
}

describe('merge with expectedHeadSha - the provider refuses a moved head', () => {
  it('GitHub and GitLab carry the verified commit natively as `sha`', () => {
    expect(buildMergeRequest({ ...base, provider: 'github' }).body.sha).toBe(SHA);
    expect(buildMergeRequest({ ...base, provider: 'gitlab' }).body.sha).toBe(SHA);
    expect(buildMergeRequest({ ...base, provider: 'github', expectedHeadSha: undefined }).body).not.toHaveProperty('sha');
  });

  it('GitHub 409 "Head branch was modified" is head_moved, not a conflict', async () => {
    scripted({ status: 409, body: { message: 'Head branch was modified. Review and try the merge again.' } });
    expect(await mergePullRequest({ ...base, provider: 'github' })).toMatchObject({ ok: false, code: 'head_moved' });
  });

  it('GitLab 409 "SHA does not match HEAD of source branch" is head_moved', async () => {
    scripted({ status: 409, body: { message: 'SHA does not match HEAD of source branch' } });
    expect(await mergePullRequest({ ...base, provider: 'gitlab' })).toMatchObject({ ok: false, code: 'head_moved' });
  });

  it('a real conflict is still a conflict', async () => {
    scripted({ status: 409, body: { message: 'merge conflict' } });
    expect(await mergePullRequest({ ...base, provider: 'github' })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('Bitbucket has no native parameter: it re-reads the head first and does NOT call merge if it moved', async () => {
    const calls = scripted({ body: { source: { commit: { hash: MOVED } } } });
    const out = await mergePullRequest({ ...base, provider: 'bitbucket' });
    expect(out).toMatchObject({ ok: false, code: 'head_moved' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/pullrequests\/7$/);
  });

  it('Bitbucket merges when the head is unchanged', async () => {
    const calls = scripted({ body: { source: { commit: { hash: SHA } } } }, { body: { state: 'MERGED', merge_commit: { hash: 'm1' } } });
    expect(await mergePullRequest({ ...base, provider: 'bitbucket' })).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });
});

describe('mergeBranchToBase with expectedHeadSha', () => {
  const input = { provider: 'github', host: null, owner: 'acme', repo: 'api', token: 't', base: 'main', head: 'builderforce/task-7', expectedHeadSha: SHA };

  it('refuses (head_moved) without merging when the branch moved', async () => {
    const calls = scripted({ body: MOVED }); // the commit lookup answers with the raw sha
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url: String(url) });
      return new Response(MOVED, { status: 200 });
    }));
    const out = await mergeBranchToBase(input);
    expect(out).toMatchObject({ ok: false, code: 'head_moved' });
    expect(calls.some((c) => c.url.endsWith('/merges'))).toBe(false);
  });

  it('merges exactly the verified commit, by sha rather than by branch name', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/merges')) { bodies.push(String(init?.body)); return new Response(JSON.stringify({ sha: 'm1' }), { status: 201 }); }
      return new Response(SHA, { status: 200 });
    }));
    expect(await mergeBranchToBase(input)).toMatchObject({ ok: true, sha: 'm1' });
    expect(JSON.parse(bodies[0]!).head).toBe(SHA);
  });
});
