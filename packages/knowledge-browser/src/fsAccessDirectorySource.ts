/**
 * A folder on this device through the File System Access API — `showDirectoryPicker`
 * (PRD 38 §4.7, Rovr row). Chrome offers it to extension pages (Rovr's side panel) as
 * well as to web pages; where it is missing, the host falls back to the folder upload.
 *
 * The folder is walked once per source, bounded, skipping installs and build output
 * (`isSkippedPath`) without descending into them. Every text file the plan would read is
 * hashed by CONTENT through SubtleCrypto (`subtleContentHash`, equal to every other
 * host's content hash, so the API's extracted cache is shared); a file the plan skips
 * anyway is hashed from its metadata and never read for it.
 *
 * The handle types are structural (`FsDirectoryHandleLike`), so a test drives the adapter
 * with a fake tree and no browser.
 */

import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import {
  byPath, hashesByContent, hostRootId, isSkippedPath, metadataHash, normalizePath, subtleContentHash, textDocument,
} from './directorySourceKit';
import type { DirectoryProvider } from './knowledgeSource';

/** The slice of `File` the adapter reads. */
export interface FsFileLike {
  size: number;
  lastModified: number;
  text(): Promise<string>;
}

export interface FsFileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<FsFileLike>;
}

export interface FsDirectoryHandleLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FsFileHandleLike | FsDirectoryHandleLike>;
}

/** Files walked at most, and how deep — a home folder is arbitrarily large. */
export const FS_WALK_LIMITS = { maxFiles: 5000, maxDepth: 16 };

type PickerWindow = { showDirectoryPicker?(opts?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FsDirectoryHandleLike> };

const picker = (): PickerWindow['showDirectoryPicker'] =>
  (typeof window === 'undefined' ? undefined : (window as unknown as PickerWindow).showDirectoryPicker);

/** Whether this browser context offers the File System Access folder picker. */
export function canPickDirectory(): boolean {
  return typeof picker() === 'function';
}

/**
 * Opens the folder picker — call INSIDE the user's gesture. Null when the person cancels
 * (the picker's `AbortError`) or the API is missing; any other failure is thrown.
 */
export async function pickDirectoryHandle(): Promise<FsDirectoryHandleLike | null> {
  const show = picker();
  if (!show) return null;
  try {
    return await show.call(window, { mode: 'read', id: 'builderforce-knowledge' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null;
    throw error;
  }
}

/** `host` prefixes the root id (`rovr:folder:<name>`). */
export function createFsAccessDirectorySource(
  handle: FsDirectoryHandleLike,
  host: string,
  limits = FS_WALK_LIMITS,
): DirectorySource {
  const rootId = hostRootId(host, 'folder', handle.name);
  const files = new Map<string, FsFileHandleLike>();
  let walked: Promise<void> | null = null;

  const walk = (): Promise<void> => {
    walked ??= (async () => {
      const queue: Array<{ dir: FsDirectoryHandleLike; prefix: string; depth: number }> = [{ dir: handle, prefix: '', depth: 0 }];
      while (queue.length > 0 && files.size < limits.maxFiles) {
        const { dir, prefix, depth } = queue.shift()!;
        for await (const entry of dir.values()) {
          const path = normalizePath(`${prefix}${entry.name}`);
          if (entry.kind === 'directory') {
            if (depth + 1 < limits.maxDepth && !isSkippedPath(`${path}/`)) queue.push({ dir: entry, prefix: `${path}/`, depth: depth + 1 });
          } else if (!isSkippedPath(path)) {
            if (files.size >= limits.maxFiles) break;
            files.set(path, entry);
          }
        }
      }
    })();
    return walked;
  };

  return {
    rootId,
    title: handle.name,
    async *list() {
      await walk();
      for (const [path, entry] of byPath(files)) {
        const file = await entry.getFile();
        const hash = hashesByContent(path, file.size)
          ? await subtleContentHash(await file.text())
          : metadataHash(path, file.size, file.lastModified);
        yield { path, hash, size: file.size };
      }
    },
    async read(path) {
      await walk();
      const entry = files.get(path);
      return textDocument(rootId, path, entry ? await (await entry.getFile()).text() : '');
    },
  };
}

/** The File System Access review target ("Review a folder" → the picker). Re-reviewing a
 *  folder from an earlier session picks it again: a handle is not kept across sessions. */
export function fsAccessDirectoryProvider(host: string): DirectoryProvider {
  return {
    id: 'folder',
    kind: 'folder',
    open: () => pickDirectoryHandle().then((handle) => (handle ? createFsAccessDirectorySource(handle, host) : null)),
  };
}
