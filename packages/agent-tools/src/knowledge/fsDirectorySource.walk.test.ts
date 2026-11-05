import { describe, expect, it } from 'vitest';
import { createFsDirectorySource, isSkippedPath } from './fsDirectorySource.js';
import { memoryKnowledgeFs, type MemoryFile } from './memoryKnowledgeFs.test-util.js';

async function walk(files: Record<string, MemoryFile>) {
  const source = createFsDirectorySource({ fs: memoryKnowledgeFs(files), rootPath: '/r', rootId: 'r', title: 'r' });
  const out: string[] = [];
  for await (const f of source.list()) out.push(f.path);
  return { paths: out.sort(), skipped: source.skippedFolders(), source };
}

describe('review walk exclusions', () => {
  it('skips nested git checkouts when the root is itself a git work tree, plus .worktrees/, *.local/ and _*_src/', async () => {
    const { paths, skipped } = await walk({
      '/r/.git/HEAD': 'ref',
      '/r/a.ts': 'a',
      '/r/ok/k.ts': 'k',
      '/r/vendor-clone/.git/HEAD': 'ref',
      '/r/vendor-clone/x.ts': 'x',
      '/r/vendor-clone/deep/y.ts': 'y',
      '/r/.worktrees/w/z.ts': 'z',
      '/r/data.local/q.ts': 'q',
      '/r/_cubecl_src/m.rs': 'm',
    });
    expect(paths).toEqual(['a.ts', 'ok/k.ts']);
    expect(skipped.sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual([
      { path: '.worktrees', reason: 'worktrees' },
      { path: '_cubecl_src', reason: 'vendored-src' },
      { path: 'data.local', reason: 'local-state' },
      { path: 'vendor-clone', reason: 'nested-checkout' },
    ]);
  });

  it('keeps every child repository when the root is a folder of repositories (it has no .git itself)', async () => {
    const { paths, skipped } = await walk({
      '/r/repo-a/.git/HEAD': 'ref',
      '/r/repo-a/a.ts': 'a',
      '/r/repo-b/.git/HEAD': 'ref',
      '/r/repo-b/b.ts': 'b',
    });
    expect(paths).toEqual(['repo-a/a.ts', 'repo-b/b.ts']);
    expect(skipped).toEqual([]);
  });

  it('keeps a submodule or worktree link: a `.git` FILE inside the root\'s repository is not a nested checkout', async () => {
    const { paths, skipped } = await walk({
      '/r/.git/HEAD': 'ref',
      '/r/sub/.git': 'gitdir: ../.git/modules/sub',
      '/r/sub/s.ts': 's',
      '/r/a.ts': 'a',
    });
    expect(paths).toEqual(['a.ts', 'sub/s.ts']);
    expect(skipped).toEqual([]);
  });

  it('applies the same rule to a path test and to the watcher: files under a found nested checkout are skipped', async () => {
    const { source } = await walk({ '/r/.git/HEAD': 'ref', '/r/vendor-clone/.git/HEAD': 'ref', '/r/vendor-clone/x.ts': 'x', '/r/a.ts': 'a' });
    const nested = new Set(source.skippedFolders().filter((s) => s.reason === 'nested-checkout').map((s) => s.path));
    expect(isSkippedPath('vendor-clone/x.ts', undefined, nested)).toBe(true);
    expect(isSkippedPath('vendor-clone/deep/x.ts', undefined, nested)).toBe(true);
    expect(isSkippedPath('other/x.ts', undefined, nested)).toBe(false);
    expect(isSkippedPath('vendor-clone/x.ts')).toBe(false);
  });

  it('tests paths by the same name rules', () => {
    expect(isSkippedPath('x/.worktrees/a.ts')).toBe(true);
    expect(isSkippedPath('app.local/b.ts')).toBe(true);
    expect(isSkippedPath('a/_cubecl_src/b.rs')).toBe(true);
    expect(isSkippedPath('src/local/a.ts')).toBe(false);
    expect(isSkippedPath('src/_private/a.ts')).toBe(false);
  });
});
