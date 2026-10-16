import type { WorkspaceFileStore } from './workspaceFileStore';

/**
 * Every file in a store, with its content. A durable store's `list()` names files
 * without their bodies (`GET /projects/:id/files` is a path listing), so anything
 * listed empty is read; a file that cannot be read is left out. `include` filters by
 * path BEFORE anything is read, so dependencies and build output never cost a request.
 */
export async function readStoreFiles(
  store: WorkspaceFileStore,
  include: (path: string) => boolean = () => true,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = (await store.list()).filter((entry) => entry.type !== 'directory' && include(entry.path));
  await Promise.all(entries.map(async (entry) => {
    if (entry.content) {
      files[entry.path] = entry.content;
      return;
    }
    try {
      files[entry.path] = await store.read(entry.path);
    } catch {
      /* unreadable: left out */
    }
  }));
  return files;
}
