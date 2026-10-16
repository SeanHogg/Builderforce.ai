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
 * build output never cost a request.
 */
export async function readStoreFiles(
  store: WorkspaceFileStore,
  include: (path: string) => boolean = () => true,
): Promise<StoreFilesRead> {
  const files: Record<string, string> = {};
  const unreadable: string[] = [];
  const entries = (await store.list()).filter((entry) => entry.type !== 'directory' && include(entry.path));
  await Promise.all(entries.map(async (entry) => {
    if (entry.content) {
      files[entry.path] = entry.content;
      return;
    }
    try {
      files[entry.path] = await store.read(entry.path);
    } catch {
      unreadable.push(entry.path);
    }
  }));
  return { files, unreadable: unreadable.sort() };
}
