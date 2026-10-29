import { describe, expect, it, vi } from 'vitest';
import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { byteLength, contentHash } from '@builderforce/knowledge-browser';
import { createVfsDirectorySource, type VfsLike } from './vfsDirectorySource';

/** The slice of the webcontainer VFS the adapter reads, over a plain map. */
function fakeVfs(files: Record<string, string | undefined>) {
  let listener: ((change: { type: string; path: string }) => void) | null = null;
  const unsubscribe = vi.fn();
  const watch = vi.fn((cb: (change: { type: string; path: string }) => void, _options?: { under?: string }) => {
    listener = cb;
    return unsubscribe;
  });
  const fs: VfsLike = { list: () => Object.keys(files), readText: (path) => files[path], watch };
  return { fs, watch, unsubscribe, emit: (path: string, type = 'change') => listener?.({ type, path }) };
}

interface Listed { path: string; hash: string; size: number }

async function listed(source: DirectorySource): Promise<Listed[]> {
  const out: Listed[] = [];
  for await (const entry of source.list()) out.push(entry);
  return out;
}

describe('VFS directory source', () => {
  it('lists the files by CONTENT hash and byte size, root-relative, skipping vendored and VCS directories', async () => {
    const { fs } = fakeVfs({
      '/src/a.md': 'alpha',
      '/src/ünï.md': 'héllo',
      '/node_modules/x/index.js': 'skipped',
      '/.git/config': 'skipped',
      '/gone.md': undefined,
    });
    const source = createVfsDirectorySource({ fs, rootId: 'web:vfs:7', title: 'Workspace files' });
    expect(source.rootId).toBe('web:vfs:7');
    expect(source.title).toBe('Workspace files');
    const entries = await listed(source);
    expect(entries.map((e) => e.path)).toEqual(['src/a.md', 'src/ünï.md']);
    expect(entries[0]).toEqual({ path: 'src/a.md', hash: contentHash('alpha'), size: 5 });
    // Bytes, not characters: the size cap is in bytes.
    expect(entries[1]!.size).toBe(byteLength('héllo'));
    expect(entries[1]!.size).toBeGreaterThan('héllo'.length);
  });

  it('reads a listed file as the text document memory reads', async () => {
    const { fs } = fakeVfs({ '/docs/lease.md': '# Lease' });
    const source = createVfsDirectorySource({ fs, rootId: 'web:vfs:7', title: 't' });
    await listed(source);
    const doc = await source.read('docs/lease.md');
    expect(doc.id).toBe('docs/lease.md');
    expect(doc.tenantId).toBe('web:vfs:7');
    expect(doc.content).toMatchObject({ kind: 'text', text: '# Lease' });
  });

  it('reads an unlisted file by its path, and an absent one as empty text', async () => {
    const { fs } = fakeVfs({ '/late.md': 'late' });
    const source = createVfsDirectorySource({ fs, rootId: 'r', title: 't' });
    expect((await source.read('late.md')).content).toMatchObject({ text: 'late' });
    expect((await source.read('nope.md')).content).toMatchObject({ text: '' });
  });

  it('reviews only a folder of the VFS when asked, with paths relative to it', async () => {
    const { fs } = fakeVfs({ '/docs/a.md': 'a', '/docs/sub/b.md': 'b', '/other/c.md': 'c' });
    const source = createVfsDirectorySource({ fs, rootId: 'r', title: 't', under: 'docs' });
    expect((await listed(source)).map((e) => e.path)).toEqual(['a.md', 'sub/b.md']);
    expect((await source.read('sub/b.md')).content).toMatchObject({ text: 'b' });
  });

  it('feeds the Live lens: changed paths, root-relative, minus skipped ones, and unsubscribes', () => {
    const { fs, watch, emit, unsubscribe } = fakeVfs({});
    const source = createVfsDirectorySource({ fs, rootId: 'r', title: 't' });
    const seen: string[][] = [];
    const stop = source.watch!((paths) => seen.push(paths));
    expect(watch.mock.calls[0]![1]).toBeUndefined();
    emit('/src/a.md');
    emit('/node_modules/x/y.js');
    expect(seen).toEqual([['src/a.md']]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('watches only its folder when it reviews one', () => {
    const { fs, watch, emit } = fakeVfs({});
    const source = createVfsDirectorySource({ fs, rootId: 'r', title: 't', under: 'docs' });
    const seen: string[][] = [];
    source.watch!((paths) => seen.push(paths));
    expect(watch.mock.calls[0]![1]).toEqual({ under: '/docs/' });
    emit('/docs/a.md');
    emit('/other/b.md');
    expect(seen).toEqual([['a.md']]);
  });
});
