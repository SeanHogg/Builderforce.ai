/**
 * Repo import client — reading a connected repo's files into the IDE workspace, and
 * recording what was saved as that repo's workspace baseline. The token stays on the
 * server: `contents` returns a manifest the caller persists through `saveFile`.
 */
import { request } from './builderforceApi';

export interface ImportedRepoFile {
  path: string;
  content: string;
  truncated: boolean;
}

/** Why the server left a path out of an import manifest (mirrors the API's ImportSkipReason). */
export type ImportSkipReason = 'binary' | 'noise' | 'cap' | 'unreadable' | 'too-large' | 'incomplete';

export interface ImportRepoManifest {
  ok: boolean;
  ref: string;
  /** Whole files only: a file read only in part is never in here — it is in `skipped`. */
  files: ImportedRepoFile[];
  discovered: number;
  skipped: Array<{ path: string; reason: ImportSkipReason }>;
  truncated: boolean;
}

export const repoImportApi = {
  /** Read a connected repo's files (server-side, token-scoped) for importing into the IDE workspace. */
  contents: (id: string, ref?: string): Promise<ImportRepoManifest> =>
    request<ImportRepoManifest>(
      `/api/repos/repositories/${id}/contents${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    ),

  /** After saving an imported manifest: record the paths actually SAVED, so a later push
   *  deletes only what was imported and then removed — never a skipped or unsaved file. */
  recordImportBaseline: (id: string, paths: string[]): Promise<{ ok: boolean; recorded: number }> =>
    request(`/api/repos/repositories/${id}/import-baseline`, { method: 'POST', body: JSON.stringify({ paths }) }),
};
