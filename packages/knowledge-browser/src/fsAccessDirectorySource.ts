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

import { isVcsMetadataName, type SkippedFolder } from '@builderforce/agent-tools/knowledge';
import {
  byPath, textContentHash, hashesByBytes, hashesByContent, hostRootId, isSkippedPath, metadataHash, normalizePath, subtleBytesHash, subtleContentHash, textDocument,
  type ByteReadableSource, type ContentHashedSource,
} from './directorySourceKit';
import type { DirectoryProvider } from './knowledgeSource';

/** The slice of `File` the adapter reads. */
export interface FsFileLike {
  size: number;
  lastModified: number;
  text(): Promise<string>;
  /** The file's bytes: a pdf/office file's text is extracted from them by the review. */
  arrayBuffer(): Promise<ArrayBuffer>;
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
): ContentHashedSource & ByteReadableSource & { skippedFolders(): SkippedFolder[] } {
  const rootId = hostRootId(host, 'folder', handle.name);
  const files = new Map<string, FsFileHandleLike>();
  const skipped: SkippedFolder[] = [];
  let walked: Promise<void> | null = null;

  const walk = (): Promise<void> => {
    walked ??= (async () => {
      const queue: Array<{ dir: FsDirectoryHandleLike; prefix: string; depth: number }> = [{ dir: handle, prefix: '', depth: 0 }];
      let rootIsRepo = false;
      while (queue.length > 0 && files.size < limits.maxFiles) {
        const { dir, prefix, depth } = queue.shift()!;
        const entries: Array<FsFileHandleLike | FsDirectoryHandleLike> = [];
        for await (const entry of dir.values()) entries.push(entry);
        // The rule agent-tools' walker applies: a root that is itself a git work tree skips a child folder
        // with its own `.git` DIRECTORY (a vendored clone). A `.git` FILE is a submodule / worktree link,
        // so it never triggers it; a root that is no work tree keeps every child.
        if (depth === 0) rootIsRepo = entries.some((e) => e.name === '.git');
        else if (rootIsRepo && entries.some((e) => e.name === '.git' && e.kind === 'directory')) {
          skipped.push({ path: prefix.replace(/\/$/, ''), reason: 'nested-checkout' });
          continue;
        }
        for (const entry of entries) {
          const path = normalizePath(`${prefix}${entry.name}`);
          if (entry.kind === 'directory') {
            if (depth + 1 < limits.maxDepth && !isSkippedPath(`${path}/`)) queue.push({ dir: entry, prefix: `${path}/`, depth: depth + 1 });
          } else if (!isVcsMetadataName(entry.name) && !isSkippedPath(path)) {
            // A file called `.git` is a link to a repository store, not a source (as in agent-tools' walker).
            if (files.size >= limits.maxFiles) break;
            files.set(path, entry);
          }
        }
      }
    })();
    return walked;
  };

  const source: ContentHashedSource & ByteReadableSource & { skippedFolders(): SkippedFolder[] } = {
    rootId,
    title: handle.name,
    skippedFolders: () => [...skipped],
    // list() hashes a text file with subtleContentHash(file.text()), equal to textContentHash of the same text.
    hashKind: 'content',
    hashOf: textContentHash,
    async *list() {
      await walk();
      for (const [path, entry] of byPath(files)) {
        const file = await entry.getFile();
        const hash = hashesByBytes(path, file.size)
          ? await subtleBytesHash(new Uint8Array(await file.arrayBuffer()))
          : hashesByContent(path, file.size)
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
    // A pdf/office file's text is extracted by the review (in its worker) from these bytes, never here.
    async readBytes(path) {
      await walk();
      const entry = files.get(path);
      return entry ? new Uint8Array(await (await entry.getFile()).arrayBuffer()) : new Uint8Array();
    },
  };
  return source;
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
