/**
 * Where a workspace's files live — the ONE port the editor, the run pipeline, point & edit,
 * project search and the Brain's build tools all read and write through.
 *
 * ── WHY A PORT ───────────────────────────────────────────────────────────────────
 * A workspace used to mean "a storage project on the server": every hook imported
 * `saveFile` / `fetchFileContent` from `lib/api` and addressed files by a numeric project
 * id. The canvas App surface also runs a workspace for a person who has no account yet,
 * whose files live in this browser until "Keep your work" makes them durable. Rather than
 * a second editor and a second run pipeline for that case, both are the SAME hooks over a
 * different store: {@link serverFileStore} here, `localFileStore` beside it.
 *
 * ── WHAT IS NOT ON THE PORT ──────────────────────────────────────────────────────
 * History, restore and the database are capabilities of a durable project, not of file
 * storage. They stay keyed by the storage project id, and a store says whether it has one
 * through `kind`, so a surface hides those panels rather than offering a door that fails.
 */
import {
  deleteFile,
  fetchFileContent,
  fetchFileHistory,
  fetchFiles,
  restoreFileVersion,
  saveFile,
  searchProjectFiles,
  type ProjectSearchMatch,
} from '@/lib/api';
import type { FileEntry } from '@/lib/types';
import type { WorkspaceId } from './workspaceId';

/** One stored version of a file, newest first (durable workspaces only). */
export interface WorkspaceFileVersion {
  path: string;
  at: number;
  size: number;
}

export interface WorkspaceSearchResult {
  matches: ProjectSearchMatch[];
  truncated: boolean;
}

export interface WorkspaceFileStore {
  readonly id: WorkspaceId;
  /** `server` = a durable storage project (history, database, publish, collaboration). */
  readonly kind: 'server' | 'local';
  /** Every file, with its content. */
  list(): Promise<FileEntry[]>;
  /** One file's content. Rejects when the file does not exist. */
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  search(query: string): Promise<WorkspaceSearchResult>;
  /** Earlier versions. Absent on a store that keeps none. */
  history?(path?: string): Promise<WorkspaceFileVersion[]>;
  /** Put an earlier version back. Absent on a store that keeps none. */
  restore?(path: string, at: number): Promise<void>;
}

/** Search cap shared by every store, so a local and a server search truncate alike. */
export const WORKSPACE_SEARCH_LIMIT = 200;

/** The durable workspace behind a storage project. */
export function serverFileStore(storageProjectId: number): WorkspaceFileStore {
  return {
    id: storageProjectId,
    kind: 'server',
    list: () => fetchFiles(storageProjectId),
    read: (path) => fetchFileContent(storageProjectId, path),
    write: (path, content) => saveFile(storageProjectId, path, content),
    remove: (path) => deleteFile(storageProjectId, path),
    search: (query) => searchProjectFiles(storageProjectId, query),
    history: (path) => fetchFileHistory(storageProjectId, path),
    restore: async (path, at) => { await restoreFileVersion(storageProjectId, path, at); },
  };
}

/**
 * The plain-substring search a store without a server index runs over its own files —
 * the same contract the server search answers (1-based line and column, trimmed preview).
 */
export function searchEntries(entries: ReadonlyArray<{ path: string; content: string }>, query: string): WorkspaceSearchResult {
  const needle = query.toLowerCase();
  const matches: ProjectSearchMatch[] = [];
  if (!needle) return { matches, truncated: false };
  for (const entry of entries) {
    const lines = entry.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const column = lines[index].toLowerCase().indexOf(needle);
      if (column < 0) continue;
      matches.push({ path: entry.path, line: index + 1, column: column + 1, preview: lines[index].trim().slice(0, 300) });
      if (matches.length >= WORKSPACE_SEARCH_LIMIT) return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}
