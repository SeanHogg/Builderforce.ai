import { describe, it, expect, vi, afterEach } from 'vitest';
import { readRepoFile, listRepoFiles } from './readRepoContents';

afterEach(() => vi.unstubAllGlobals());

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const ctx = { provider: 'gitlab', host: null, owner: 'o', repo: 'r', token: 't', ref: 'main' };

describe('readRepoFile — non-GitHub via RepoSource [1248]', () => {
  it('reads a GitLab file through the shared RepoSource', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/repository/files/')) return jsonResponse({ content: b64('hello world'), encoding: 'base64', size: 11 });
      return jsonResponse({}, 404);
    }));
    const r = await readRepoFile(ctx, 'src/x.ts');
    expect(r.ok).toBe(true);
    expect(r.ok && r.content).toBe('hello world');
  });

  it('returns a typed reason for an unknown provider (no throw)', async () => {
    const r = await readRepoFile({ ...ctx, provider: 'gitea' }, 'x');
    expect(r.ok).toBe(false);
  });
});

describe('listRepoFiles — non-GitHub via RepoSource [1248]', () => {
  it('lists GitLab files (blobs only, dirs excluded)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/repository/tree')) {
        return jsonResponse([
          { path: 'a.ts', type: 'blob' },
          { path: 'dir', type: 'tree' },
          { path: 'dir/b.ts', type: 'blob' },
        ], 200); // no x-next-page header → single page
      }
      return jsonResponse([], 200);
    }));
    const r = await listRepoFiles(ctx);
    expect(r.ok).toBe(true);
    expect(r.ok && [...r.paths].sort()).toEqual(['a.ts', 'dir/b.ts']);
  });
});
