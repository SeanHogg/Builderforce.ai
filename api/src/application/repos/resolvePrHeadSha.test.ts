import { describe, expect, it } from 'vitest';
import { parsePrHeadSha, resolvePrHeadSha } from './resolvePrHeadSha';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('parsePrHeadSha - one mapping per provider', () => {
  it('GitHub: head.sha', () => {
    expect(parsePrHeadSha('github', { head: { sha: SHA } })).toBe(SHA);
  });
  it('GitLab: the merge request sha', () => {
    expect(parsePrHeadSha('gitlab', { sha: SHA })).toBe(SHA);
    expect(parsePrHeadSha('gitlab', { diff_refs: { head_sha: SHA } })).toBe(SHA);
  });
  it('Bitbucket Cloud: source.commit.hash', () => {
    expect(parsePrHeadSha('bitbucket-cloud', { source: { commit: { hash: SHA } } })).toBe(SHA);
  });
  it('Bitbucket Server: fromRef.latestCommit', () => {
    expect(parsePrHeadSha('bitbucket-server', { fromRef: { latestCommit: SHA } })).toBe(SHA);
  });
  it('reads the field of ITS provider only, and refuses anything that is not a commit id', () => {
    expect(parsePrHeadSha('gitlab', { head: { sha: SHA } })).toBeNull();
    expect(parsePrHeadSha('github', { sha: SHA })).toBeNull();
    expect(parsePrHeadSha('github', { head: { sha: 'not a sha' } })).toBeNull();
    expect(parsePrHeadSha('bitbucket-cloud', null)).toBeNull();
  });
});

describe('resolvePrHeadSha - the request', () => {
  const coords = { host: null, owner: 'acme', repo: 'api', token: 't', number: 7 };
  const answering = (body: unknown, status = 200) => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
    return { fetchFn, urls };
  };

  it('asks the dialect-correct PR endpoint and returns the head', async () => {
    const gh = answering({ head: { sha: SHA } });
    expect(await resolvePrHeadSha({ ...coords, provider: 'github' }, gh.fetchFn)).toEqual({ ok: true, sha: SHA });
    expect(gh.urls[0]).toMatch(/\/repos\/acme\/api\/pulls\/7$/);

    const gl = answering({ sha: SHA });
    expect(await resolvePrHeadSha({ ...coords, provider: 'gitlab' }, gl.fetchFn)).toEqual({ ok: true, sha: SHA });
    expect(gl.urls[0]).toMatch(/\/projects\/acme%2Fapi\/merge_requests\/7$/);

    const bb = answering({ source: { commit: { hash: SHA } } });
    expect(await resolvePrHeadSha({ ...coords, provider: 'bitbucket' }, bb.fetchFn)).toEqual({ ok: true, sha: SHA });
    expect(bb.urls[0]).toMatch(/\/repositories\/acme\/api\/pullrequests\/7$/);
  });

  it('a failed or empty answer is a refusal with a reason, never a guessed head', async () => {
    expect((await resolvePrHeadSha({ ...coords, provider: 'github' }, answering({}, 404).fetchFn)).ok).toBe(false);
    expect((await resolvePrHeadSha({ ...coords, provider: 'github' }, answering({ head: {} }).fetchFn)).ok).toBe(false);
    const down = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect(await resolvePrHeadSha({ ...coords, provider: 'github' }, down)).toMatchObject({ ok: false });
  });
});
