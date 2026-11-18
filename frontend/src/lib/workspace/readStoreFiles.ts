import type { WorkspaceFileStore } from './workspaceFileStore';

export interface StoreFilesRead {
  /** Path → content for every file that could be read. */
  files: Record<string, string>;
  /** Files the listing named but whose read failed — reported, never silently dropped. */
  unreadable: string[];
}

/**
 * Every file in a store, with its content. A durable store's `list()` names files
 * without their bodies (`GET /projects/:id/files` is a path listing), so anything
 * listed empty is read; a file whose read fails lands in `unreadable` so the caller
 * can say so. `include` filters by path BEFORE anything is read, so dependencies and
 * build output never cost a request. At most `concurrency` reads (default
 * {@link READ_CONCURRENCY}) are in flight at once: a repo of a few thousand files must
 * not open thousands of requests, and a caller on a slow link may ask for fewer.
 */
export async function readStoreFiles(
  store: WorkspaceFileStore,
  include: (path: string) => boolean = () => true,
  options: { concurrency?: number } = {},
): Promise<StoreFilesRead> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? READ_CONCURRENCY));
  const files: Record<string, string> = {};
  const unreadable: string[] = [];
  const entries = (await store.list()).filter((entry) => entry.type !== 'directory' && include(entry.path));
  const pending = entries.filter((entry) => {
    if (!entry.content) return true;
    files[entry.path] = entry.content;
    return false;
  });
  let next = 0;
  const reader = async (): Promise<void> => {
    while (next < pending.length) {
      const entry = pending[next++]!;
      try {
        files[entry.path] = await store.read(entry.path);
      } catch {
        unreadable.push(entry.path);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, reader));
  return { files, unreadable: unreadable.sort() };
}

/** Reads in flight at once, by default. */
export const READ_CONCURRENCY = 24;
