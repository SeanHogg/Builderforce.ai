import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchRepoCode, type RepoReadContext } from './readRepoContents';

const ctx: RepoReadContext = {
  provider: 'github', host: null, owner: 'acme', repo: 'app', token: 'tok', ref: 'builderforce/task-1',
};

afterEach(() => vi.restoreAllMocks());

describe('searchRepoCode', () => {
  it('queries GitHub code search scoped to the repo and parses matches', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/search/code?q=');
      // literal term is quoted and the repo qualifier is present
      expect(decodeURIComponent(url)).toContain('"gemini-2.5-flash-lite" repo:acme/app');
      expect((init?.headers as Record<string, string>).Accept).toContain('text-match');
      return new Response(JSON.stringify({
        total_count: 2,
        items: [
          { path: 'src/a.ts', text_matches: [{ fragment: 'const m = "gemini-2.5-flash-lite"' }] },
          { path: 'src/b.ts', text_matches: [{ fragment: 'fallback: gemini-2.5-flash-lite' }] },
        ],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const r = await searchRepoCode(ctx, 'gemini-2.5-flash-lite');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe(2);
    expect(r.matches.map((m) => m.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(r.matches[0].fragments[0]).toContain('gemini-2.5-flash-lite');
    expect(r.truncated).toBe(false);
  });

  it('reports zero matches cleanly (the "nothing to remove" signal)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200 })) as unknown as typeof fetch);
    const r = await searchRepoCode(ctx, 'does-not-exist');
    expect(r).toEqual({ ok: true, matches: [], total: 0, truncated: false });
  });

  it('flags truncation when total exceeds returned items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      total_count: 99, items: [{ path: 'x.ts', text_matches: [] }],
    }), { status: 200 })) as unknown as typeof fetch);
    const r = await searchRepoCode(ctx, 'x', { maxResults: 1 });
    expect(r.ok && r.truncated).toBe(true);
  });

  it('returns a typed error on a GitHub failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })) as unknown as typeof fetch);
    const r = await searchRepoCode(ctx, 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('403');
  });

  it('rejects an empty query and a non-github provider without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    expect((await searchRepoCode(ctx, '   ')).ok).toBe(false);
    expect((await searchRepoCode({ ...ctx, provider: 'gitlab' }, 'x')).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
