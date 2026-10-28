/**
 * A folder from this device as a `DirectorySource` — the `<input webkitdirectory>`
 * FileList (PRD 38 §4.7). Works in every browser, so it is every host's fallback when
 * the File System Access picker is not there. `pickFolder` must be called INSIDE the
 * user's gesture: it opens the browser's folder dialog synchronously and resolves with
 * the files (or null when the person cancels).
 */

import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import {
  byPath, contentHash, hashesByContent, hostRootId, isSkippedPath, metadataHash, normalizePath, textDocument,
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
export function createUploadDirectorySource(files: readonly File[], host: string): DirectorySource {
  const picked = new Map<string, File>();
  let folder = '';
  for (const file of files) {
    const split = splitRoot(file);
    folder ||= split.folder;
    if (split.path && !isSkippedPath(split.path)) picked.set(split.path, file);
  }
  const title = folder || 'folder';
  const rootId = hostRootId(host, 'upload', title);

  return {
    rootId,
    title,
    async *list() {
      for (const [path, file] of byPath(picked)) {
        const hash = hashesByContent(path, file.size)
          ? contentHash(await file.text())
          : metadataHash(path, file.size, file.lastModified);
        yield { path, hash, size: file.size };
      }
    },
    async read(path) {
      const file = picked.get(path);
      return textDocument(rootId, path, file ? await file.text() : '');
    },
  };
}

/** The folder-upload review target. An upload cannot be re-read without a new pick. */
export function uploadDirectoryProvider(host: string): DirectoryProvider {
  return {
    id: 'upload',
    kind: 'upload',
    open: () => pickFolder().then((files) => (files ? createUploadDirectorySource(files, host) : null)),
  };
}
