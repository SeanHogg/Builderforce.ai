/**
 * storeWorkspaceFs.ts - a `WorkspaceFs` over a canvas `WorkspaceFileStore` (the durable project or
 * the browser-held workspace), so the canvas write/edit tools run on the ONE coding provider
 * (`createRepoCapabilities`) instead of a copy of its edit logic.
 *
 * Only what the provider's write and edit paths use is real: `read`, `write`, `remove`. The stores
 * reject a missing file with a "File not found" error; that is the one `not_found`, and every other
 * failure keeps its own message as `io`.
 */

import { WorkspaceError, type WorkspaceEntry, type WorkspaceFs, type WorkspaceRead } from '@builderforce/agent-tools/workspace';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';

const isNotFound = (error: unknown): boolean => error instanceof Error && /^File not found\b/i.test(error.message);

export function storeWorkspaceFs(store: WorkspaceFileStore): WorkspaceFs {
  return {
    // eslint-disable-next-line require-yield
    async *list(dir): AsyncGenerator<WorkspaceEntry> {
      throw new WorkspaceError('unsupported', `listing "${dir}" is not served by the canvas file adapter`);
    },
    async read(path): Promise<WorkspaceRead> {
      try {
        return { status: 'ok', content: await store.read(path), truncated: false };
      } catch (error) {
        if (isNotFound(error)) return { status: 'not_found' };
        throw new WorkspaceError('io', error instanceof Error ? error.message : String(error));
      }
    },
    write: (path, content) => store.write(path, content),
    async remove(path) {
      try {
        await store.read(path);
      } catch (error) {
        if (isNotFound(error)) return 'missing';
        throw error;
      }
      await store.remove(path);
      return 'deleted';
    },
  };
}
