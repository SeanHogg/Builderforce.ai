import { describe, expect, it } from 'vitest';
import { createFsAccessDirectorySource, type FsDirectoryHandleLike, type FsFileHandleLike } from './fsAccessDirectorySource';

const file = (name: string): FsFileHandleLike => ({
  kind: 'file', name,
  getFile: async () => ({ size: 1, lastModified: 1, text: async () => name }),
});
const dir = (name: string, ...entries: Array<FsFileHandleLike | FsDirectoryHandleLike>): FsDirectoryHandleLike => ({
  kind: 'directory', name, values: async function* () { yield* entries; },
});

async function paths(handle: FsDirectoryHandleLike) {
  const source = createFsAccessDirectorySource(handle, 'rovr');
  const listed: string[] = [];
  for await (const entry of source.list()) listed.push(entry.path);
  return { listed, skipped: source.skippedFolders() };
}

describe('the File System Access walker - nested checkouts', () => {
  it('skips a child folder with its own .git directory when the root is a git work tree', async () => {
    const root = dir('app', dir('.git'), file('a.ts'), dir('vendored', dir('.git'), file('v.ts')), dir('pkg', file('p.ts')));
    expect(await paths(root)).toEqual({
      listed: ['a.ts', 'pkg/p.ts'],
      skipped: [{ path: 'vendored', reason: 'nested-checkout' }],
    });
  });

  it('keeps a child whose .git is a FILE (a submodule or worktree link)', async () => {
    const root = dir('app', dir('.git'), dir('sub', file('.git'), file('s.ts')));
    expect((await paths(root)).listed).toEqual(['sub/s.ts']);
  });

  it('keeps every child when the root is no work tree (a folder of several repositories)', async () => {
    const root = dir('workspace', dir('one', dir('.git'), file('1.ts')), dir('two', dir('.git'), file('2.ts')));
    expect(await paths(root)).toEqual({ listed: ['one/1.ts', 'two/2.ts'], skipped: [] });
  });
});
