/**
 * The webcontainer VFS as a `DirectorySource` (PRD 38 §4.7, web row): `list`/`readFile`/
 * `watch` of the page's in-browser runtime (`browserRuntime/previewRuntime.ts`). The VFS is
 * in memory, so every listed file is hashed by content; `watch` feeds the Live lens.
 */

import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { byteLength, contentHash, isSkippedPath, normalizePath, textDocument } from '@builderforce/knowledge-browser';

/** The slice of `VirtualFileSystem` this adapter reads (structural, so tests need no runtime). */
export interface VfsLike {
  list(): string[];
  readText(path: string): string | undefined;
  watch(listener: (change: { type: string; path: string }) => void, options?: { under?: string }): () => void;
}

export interface VfsDirectorySourceOptions {
  fs: VfsLike;
  rootId: string;
  title: string;
  /** Review only this folder of the VFS (root-relative). Default: the whole VFS. */
  under?: string;
}

export function createVfsDirectorySource({ fs, rootId, title, under = '' }: VfsDirectorySourceOptions): DirectorySource {
  const base = normalizePath(under).replace(/\/?$/, under ? '/' : '');
  /** root-relative → the VFS's own spelling of the path. */
  const real = new Map<string, string>();
  const relative = (vfsPath: string): string | undefined => {
    const rel = normalizePath(vfsPath);
    if (base && !rel.startsWith(base)) return undefined;
    return rel.slice(base.length);
  };

  return {
    rootId,
    title,
    async *list() {
      for (const vfsPath of fs.list()) {
        const path = relative(vfsPath);
        if (!path || isSkippedPath(path)) continue;
        const text = fs.readText(vfsPath);
        if (text === undefined) continue;
        real.set(path, vfsPath);
        yield { path, hash: contentHash(text), size: byteLength(text) };
      }
    },
    async read(path) {
      const text = fs.readText(real.get(path) ?? `/${base}${path}`) ?? fs.readText(`${base}${path}`) ?? '';
      return textDocument(rootId, path, text);
    },
    watch(cb) {
      return fs.watch((change) => {
        const path = relative(change.path);
        if (path && !isSkippedPath(path)) cb([path]);
      }, base ? { under: `/${base}` } : undefined);
    },
  };
}
