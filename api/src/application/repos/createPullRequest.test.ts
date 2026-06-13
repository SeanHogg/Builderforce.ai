import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPullRequest, buildCreatePrRequest, type OpenPrInput } from './createPullRequest';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const base: OpenPrInput = {
  provider: 'github', host: null, owner: 'acme', repo: 'app', token: 't',
  head: 'feature', base: 'main', title: 'My PR', body: 'desc',
};

describe('buildCreatePrRequest — per-provider create endpoints [1278]', () => {
  it('GitHub: POST /repos/:o/:r/pulls with head/base', () => {
    const r = buildCreatePrRequest({ ...base, provider: 'github' });
    expect(r.url).toBe('https://api.github.com/repos/acme/app/pulls');
    expect(r.body).toMatchObject({ head: 'feature', base: 'main', title: 'My PR' });
  });
  it('GitLab: POST /projects/:enc/merge_requests with source/target branch', () => {
    const r = buildCreatePrRequest({ ...base, provider: 'gitlab' });
    expect(r.url).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests');
    expect(r.body).toMatchObject({ source_branch: 'feature', target_branch: 'main', title: 'My PR' });
  });
  it('Bitbucket: POST /repositories/:o/:r/pullrequests with nested branch refs', () => {
    const r = buildCreatePrRequest({ ...base, provider: 'bitbucket' });
    expect(r.url).toBe('https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests');
    expect(r.body).toMatchObject({
      source: { branch: { name: 'feature' } }, destination: { branch: { name: 'main' } },
    });
  });
  it('Bitbucket Server (custom host) throws → unsupported', () => {
    expect(() => buildCreatePrRequest({ ...base, provider: 'bitbucket', host: 'bb.acme.com' })).toThrow();
  });
});

describe('createPullRequest', () => {
  it('parses a GitLab MR response (iid + web_url) [1278]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ iid: 12, web_url: 'https://gitlab.com/acme/app/-/merge_requests/12' })));
    const r = await createPullRequest({ ...base, provider: 'gitlab' });
    expect(r).toEqual({ ok: true, number: 12, url: 'https://gitlab.com/acme/app/-/merge_requests/12' });
  });

  it('parses a Bitbucket PR response (id + links.html.href) [1278]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 7, links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/7' } } })));
    const r = await createPullRequest({ ...base, provider: 'bitbucket' });
    expect(r).toEqual({ ok: true, number: 7, url: 'https://bitbucket.org/acme/app/pull-requests/7' });
  });

  it('returns unsupported for an unknown provider without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await createPullRequest({ ...base, provider: 'gitea' });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
