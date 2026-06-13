import { afterEach, describe, expect, it, vi } from 'vitest';
import * as repo from './readRepoContents';
import { importRepoContents } from './importRepoContents';

const ctx: repo.RepoReadContext = {
  provider: 'github', host: null, owner: 'a', repo: 'b', token: 't', ref: 'main',
};

afterEach(() => vi.restoreAllMocks());

describe('importRepoContents', () => {
  it('imports text files and skips binary/asset/noise paths', async () => {
    vi.spyOn(repo, 'listRepoFiles').mockResolvedValue({
      ok: true,
      truncated: false,
      paths: ['src/app.ts', 'README.md', 'logo.png', 'node_modules/x/index.js', 'dist/out.js'],
    });
    vi.spyOn(repo, 'readRepoFile').mockImplementation(async (_c, path) => ({
      ok: true, path, content: `// ${path}`, truncated: false,
    }));

    const r = await importRepoContents(ctx);
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.path).sort()).toEqual(['README.md', 'src/app.ts']);
    expect(r.skipped).toEqual(expect.arrayContaining(['logo.png', 'node_modules/x/index.js', 'dist/out.js']));
    expect(r.truncated).toBe(false);
  });

  it('propagates a tree-listing failure without throwing', async () => {
    vi.spyOn(repo, 'listRepoFiles').mockResolvedValue({ ok: false, reason: 'GitHub 404' });
    const r = await importRepoContents(ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('GitHub 404');
    expect(r.files).toEqual([]);
  });

  it('marks truncated when the tree listing was itself truncated', async () => {
    vi.spyOn(repo, 'listRepoFiles').mockResolvedValue({ ok: true, truncated: true, paths: ['a.ts'] });
    vi.spyOn(repo, 'readRepoFile').mockResolvedValue({ ok: true, path: 'a.ts', content: 'x', truncated: false });
    const r = await importRepoContents(ctx);
    expect(r.truncated).toBe(true);
    expect(r.files).toHaveLength(1);
  });

  it('drops unreadable files into skipped rather than failing the import', async () => {
    vi.spyOn(repo, 'listRepoFiles').mockResolvedValue({ ok: true, truncated: false, paths: ['ok.ts', 'gone.ts'] });
    vi.spyOn(repo, 'readRepoFile').mockImplementation(async (_c, path) =>
      path === 'gone.ts' ? { ok: false, reason: 'not found' } : { ok: true, path, content: 'ok', truncated: false },
    );
    const r = await importRepoContents(ctx);
    expect(r.files.map((f) => f.path)).toEqual(['ok.ts']);
    expect(r.skipped).toContain('gone.ts');
  });
});
