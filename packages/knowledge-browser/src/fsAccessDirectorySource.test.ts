import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_FILE_BYTES } from '@seanhogg/builderforce-memory/knowledge';
import {
  canPickDirectory, createFsAccessDirectorySource, fsAccessDirectoryProvider, pickDirectoryHandle,
  type FsDirectoryHandleLike, type FsFileHandleLike,
} from './fsAccessDirectorySource';
import { contentHash, metadataHash, subtleContentHash } from './directorySourceKit';

type Tree = { [name: string]: string | { bytes: number } | Tree };

/** A fake `FileSystemDirectoryHandle` tree; counts every `getFile()` per path. */
function fakeTree(name: string, tree: Tree, reads = new Map<string, number>(), prefix = ''): FsDirectoryHandleLike {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const [child, value] of Object.entries(tree)) {
        const path = `${prefix}${child}`;
        if (typeof value === 'string' || 'bytes' in value) {
          const text = typeof value === 'string' ? value : '';
          const size = typeof value === 'string' ? new TextEncoder().encode(value).length : (value as { bytes: number }).bytes;
          const file: FsFileHandleLike = {
            kind: 'file',
            name: child,
            async getFile() {
              reads.set(path, (reads.get(path) ?? 0) + 1);
              return { size, lastModified: 42, text: async () => text };
            },
          };
          yield file;
        } else {
          yield fakeTree(child, value as Tree, reads, `${path}/`);
        }
      }
    },
  };
}

async function listAll(source: ReturnType<typeof createFsAccessDirectorySource>) {
  const out: Array<{ path: string; hash: string; size: number }> = [];
  for await (const entry of source.list()) out.push(entry);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('File System Access directory source', () => {
  const tree: Tree = {
    'README.md': '# Lease\nNotice is 30 days.',
    docs: { 'b.md': 'second', 'a.md': 'first — ünïcode' },
    node_modules: { pkg: { 'index.js': 'skipped' } },
    '.git': { HEAD: 'ref: main' },
    dist: { 'out.js': 'built' },
    assets: { 'logo.png': { bytes: 2048 } },
  };

  it('roots at the picked folder under the host prefix', () => {
    const source = createFsAccessDirectorySource(fakeTree('contracts', tree), 'rovr');
    expect(source.rootId).toBe('rovr:folder:contracts');
    expect(source.title).toBe('contracts');
  });

  it('lists every file root-relative and sorted, skipping installs and build output without descending', async () => {
    const reads = new Map<string, number>();
    const source = createFsAccessDirectorySource(fakeTree('contracts', tree, reads), 'rovr');
    const listed = await listAll(source);
    expect(listed.map((e) => e.path)).toEqual(['README.md', 'assets/logo.png', 'docs/a.md', 'docs/b.md']);
    expect([...reads.keys()].some((p) => /node_modules|\.git|dist/.test(p))).toBe(false);
  });

  it('hashes text by content through SubtleCrypto — equal to every other host\'s content hash', async () => {
    const source = createFsAccessDirectorySource(fakeTree('contracts', tree), 'rovr');
    const listed = await listAll(source);
    const a = listed.find((e) => e.path === 'docs/a.md')!;
    expect(a.hash).toBe(contentHash('first — ünïcode'));
    expect(a.hash).toBe(await subtleContentHash('first — ünïcode'));
    expect(a.size).toBe(new TextEncoder().encode('first — ünïcode').length);
  });

  it('hashes a file the plan skips (binary, over the cap) from its metadata, never reading it', async () => {
    const big = 'x'.repeat(DEFAULT_MAX_FILE_BYTES + 1);
    const texts = vi.fn();
    const handle: FsDirectoryHandleLike = {
      kind: 'directory',
      name: 'r',
      async *values() {
        yield { kind: 'file', name: 'logo.png', getFile: async () => ({ size: 10, lastModified: 7, text: async () => { texts(); return ''; } }) };
        yield { kind: 'file', name: 'huge.md', getFile: async () => ({ size: big.length, lastModified: 8, text: async () => { texts(); return big; } }) };
      },
    };
    const listed = await listAll(createFsAccessDirectorySource(handle, 'rovr'));
    expect(listed).toEqual([
      { path: 'huge.md', hash: metadataHash('huge.md', big.length, 8), size: big.length },
      { path: 'logo.png', hash: metadataHash('logo.png', 10, 7), size: 10 },
    ]);
    expect(texts).not.toHaveBeenCalled();
  });

  it('reads a listed file as a text document, and an unknown path as empty', async () => {
    const source = createFsAccessDirectorySource(fakeTree('contracts', tree), 'rovr');
    const doc = await source.read('docs/b.md');
    expect(doc.id).toBe('docs/b.md');
    expect(doc.tenantId).toBe('rovr:folder:contracts');
    expect(doc.content).toMatchObject({ kind: 'text', text: 'second' });
    expect((await source.read('nope.md')).content).toMatchObject({ kind: 'text', text: '' });
  });

  it('walks once per source, and stops at the file and depth limits', async () => {
    let walks = 0;
    const counting: FsDirectoryHandleLike = { kind: 'directory', name: 'r', values: () => { walks++; return fakeTree('r', tree).values(); } };
    const source = createFsAccessDirectorySource(counting, 'rovr');
    await listAll(source);
    await source.read('README.md');
    expect(walks).toBe(1);

    const capped = await listAll(createFsAccessDirectorySource(fakeTree('r', tree), 'rovr', { maxFiles: 2, maxDepth: 16 }));
    expect(capped).toHaveLength(2);
    const shallow = await listAll(createFsAccessDirectorySource(fakeTree('r', tree), 'rovr', { maxFiles: 100, maxDepth: 1 }));
    expect(shallow.map((e) => e.path)).toEqual(['README.md']);
  });

  it('picks through showDirectoryPicker, read-only; a cancel is null; the provider builds the source', async () => {
    expect(canPickDirectory()).toBe(false);
    expect(await pickDirectoryHandle()).toBeNull();

    const showDirectoryPicker = vi.fn(async () => fakeTree('picked', { 'a.md': 'a' }));
    vi.stubGlobal('window', { showDirectoryPicker });
    expect(canPickDirectory()).toBe(true);
    const dir = await fsAccessDirectoryProvider('rovr').open();
    expect(dir?.rootId).toBe('rovr:folder:picked');
    expect(showDirectoryPicker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'read' }));

    showDirectoryPicker.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    expect(await fsAccessDirectoryProvider('rovr').open()).toBeNull();
    showDirectoryPicker.mockRejectedValueOnce(new Error('denied'));
    await expect(pickDirectoryHandle()).rejects.toThrow('denied');
  });
});
