import { describe, it, expect, vi, afterEach } from 'vitest';
import { readRepoFile, listRepoFiles, searchRepoCode, listBranchDiff } from './readRepoContents';

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

describe('searchRepoCode — GitLab blob search', () => {
  it('groups GitLab blob hits by path into fragments', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/search?scope=blobs') || String(url).includes('scope=blobs')) {
        return jsonResponse([
          { path: 'src/a.ts', data: 'const x = needle();' },
          { path: 'src/a.ts', data: 'needle again' },
          { path: 'src/b.ts', data: 'found needle' },
        ]);
      }
      return jsonResponse([], 404);
    }));
    const r = await searchRepoCode(ctx, 'needle');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matches.map((m) => m.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
      expect(r.matches.find((m) => m.path === 'src/a.ts')?.fragments.length).toBe(2);
    }
  });

  it('Bitbucket search stays unsupported (deferred)', async () => {
    const r = await searchRepoCode({ ...ctx, provider: 'bitbucket' }, 'q');
    expect(r.ok).toBe(false);
  });
});

describe('listBranchDiff — GitLab compare', () => {
  it('maps GitLab diff flags to statuses; 404 = clean empty first run', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/repository/compare')) {
        return jsonResponse({ diffs: [
          { new_path: 'a.ts', new_file: true },
          { new_path: 'b.ts' },
          { old_path: 'c.ts', deleted_file: true },
        ] });
      }
      return jsonResponse({}, 404);
    }));
    const r = await listBranchDiff(ctx, 'main', 'feature');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files).toEqual([
        { path: 'a.ts', status: 'added' },
        { path: 'b.ts', status: 'modified' },
        { path: 'c.ts', status: 'removed' },
      ]);
    }
  });

  it('treats a missing branch (404) as an empty diff', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: '404' }, 404)));
    const r = await listBranchDiff(ctx, 'main', 'feature');
    expect(r).toEqual({ ok: true, files: [], truncated: false });
  });

  it('maps Bitbucket diffstat values to statuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/diffstat/')) {
        return jsonResponse({ values: [
          { status: 'added', new: { path: 'a.ts' }, old: null },
          { status: 'modified', new: { path: 'b.ts' }, old: { path: 'b.ts' } },
          { status: 'removed', new: null, old: { path: 'c.ts' } },
        ] });
      }
      return jsonResponse({}, 404);
    }));
    const r = await listBranchDiff({ ...ctx, provider: 'bitbucket' }, 'main', 'feature');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files).toEqual([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'removed' },
    ]);
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
