/**
 * A folder from this device as a `DirectorySource` — the `<input webkitdirectory>`
 * FileList (PRD 38 §4.7). Works in every browser, so it is every host's fallback when
 * the File System Access picker is not there. `pickFolder` must be called INSIDE the
 * user's gesture: it opens the browser's folder dialog synchronously and resolves with
 * the files (or null when the person cancels).
 */

import {
  byPath, contentHash, hashesByBytes, hashesByContent, hostRootId, isSkippedPath, metadataHash, normalizePath, subtleBytesHash, textDocument, type ByteReadableSource, type ContentHashedSource,
} from './directorySourceKit';
import type { DirectoryProvider } from './knowledgeSource';

export function pickFolder(): Promise<File[] | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  const picked = new Promise<File[] | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files && input.files.length > 0 ? [...input.files] : null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
  });
  input.click();
  return picked;
}

/** `my-folder/docs/a.md` → `docs/a.md`; the folder name is the root's title. */
function splitRoot(file: File): { folder: string; path: string } {
  const full = normalizePath(file.webkitRelativePath || file.name);
  const at = full.indexOf('/');
  return at < 0 ? { folder: '', path: full } : { folder: full.slice(0, at), path: full.slice(at + 1) };
}

/** `host` prefixes the root id (`web:upload:<folder>`, `rovr:upload:<folder>`). */
export function createUploadDirectorySource(files: readonly File[], host: string): ContentHashedSource & ByteReadableSource {
  const picked = new Map<string, File>();
  let folder = '';
  for (const file of files) {
    const split = splitRoot(file);
    folder ||= split.folder;
    if (split.path && !isSkippedPath(split.path)) picked.set(split.path, file);
  }
  const title = folder || 'folder';
  const rootId = hostRootId(host, 'upload', title);

  const source: ContentHashedSource & ByteReadableSource = {
    rootId,
    title,
    // list() hashes a text file with contentHash(file.text()); the review re-hashes the text read() returns.
    hashKind: 'content',
    hashOf: contentHash,
    async *list() {
      for (const [path, file] of byPath(picked)) {
        const hash = hashesByBytes(path, file.size)
          ? await subtleBytesHash(new Uint8Array(await file.arrayBuffer()))
          : hashesByContent(path, file.size)
            ? contentHash(await file.text())
            : metadataHash(path, file.size, file.lastModified);
        yield { path, hash, size: file.size };
      }
    },
    async read(path) {
      const file = picked.get(path);
      return textDocument(rootId, path, file ? await file.text() : '');
    },
    // A pdf/office file's text is extracted by the review (in its worker) from these bytes, never here.
    async readBytes(path) {
      const file = picked.get(path);
      return file ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    },
  };
  return source;
}

/** The folder-upload review target. An upload cannot be re-read without a new pick. */
export function uploadDirectoryProvider(host: string): DirectoryProvider {
  return {
    id: 'upload',
    kind: 'upload',
    open: () => pickFolder().then((files) => (files ? createUploadDirectorySource(files, host) : null)),
  };
}
