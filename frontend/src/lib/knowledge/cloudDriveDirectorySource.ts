/**
 * A connected Cloud Drive folder as a `DirectorySource` (PRD 38 §4.7), over the existing
 * `/api/drive` client (`lib/driveApi.ts`) — walked one folder per request, never fetched
 * whole, and bounded.
 *
 * A drive listing carries no content hash, so a file's listing hash is taken from its id,
 * modification time and size: a changed file gets a new hash, an unchanged one is never
 * downloaded again. (The extracted cache is still keyed by this hash; it is simply not
 * shared with another host's copy of the same file.)
 */

import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { driveApi, type DriveConnection, type DriveItem } from '@/lib/driveApi';
import { byPath, metadataHash, normalizePath, textDocument } from '@builderforce/knowledge-browser';
import { webRootId } from './webHost';

/** Files walked at most, and how deep — a drive is arbitrarily large. */
export const DRIVE_WALK_LIMITS = { maxFiles: 2000, maxDepth: 8 };

export interface DriveFolderRef {
  id: string;
  name: string;
}

export function createDriveDirectorySource(
  connection: Pick<DriveConnection, 'id' | 'displayName' | 'accountEmail'>,
  folder: DriveFolderRef | null = null,
  limits = DRIVE_WALK_LIMITS,
): DirectorySource {
  const rootId = webRootId('drive', connection.id, folder?.id ?? 'root');
  const title = folder?.name ?? (connection.displayName || connection.accountEmail);
  const items = new Map<string, DriveItem>();
  let walked: Promise<void> | null = null;

  const walk = (): Promise<void> => {
    walked ??= (async () => {
      const queue: Array<{ id: string | null; prefix: string; depth: number }> = [{ id: folder?.id ?? null, prefix: '', depth: 0 }];
      while (queue.length > 0 && items.size < limits.maxFiles) {
        const dir = queue.shift()!;
        let cursor: string | undefined;
        do {
          const page = await driveApi.list(connection.id, dir.id, cursor);
          for (const item of page.items) {
            const path = normalizePath(`${dir.prefix}${item.name}`);
            if (item.kind === 'folder') {
              if (dir.depth + 1 < limits.maxDepth) queue.push({ id: item.id, prefix: `${path}/`, depth: dir.depth + 1 });
            } else if (items.size < limits.maxFiles) {
              items.set(path, item);
            }
          }
          cursor = page.nextCursor;
        } while (cursor && items.size < limits.maxFiles);
      }
    })();
    return walked;
  };

  return {
    rootId,
    title,
    async *list() {
      await walk();
      for (const [path, item] of byPath(items)) {
        yield { path, hash: metadataHash(item.id, item.modifiedAt, item.sizeBytes), size: item.sizeBytes ?? 0 };
      }
    },
    async read(path) {
      await walk();
      const item = items.get(path);
      if (!item) return textDocument(rootId, path, '');
      const file = await driveApi.fetchFile(connection.id, item);
      return textDocument(rootId, path, await file.text());
    },
  };
}
