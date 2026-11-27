/**
 * r2WorkspaceFs - the IDE workspace (R2, `workspaceStore`) as the shared `WorkspaceFs`, so the cloud
 * agent's `list_files` / `read_file` / `search_code` / `write_file` / `edit_file` / `delete_file`
 * run on the ONE coding provider (`@builderforce/agent-tools/workspace`) instead of a host copy.
 *
 * R2 lists by key prefix, not by directory, so the whole prefix is paged ONCE per adapter (one
 * adapter per run) and every one-level `list()` is served from that snapshot. A listing the page
 * budget cut short is remembered (`listingIncomplete`) so an empty glob is never reported as
 * absence. Writes and deletes go through `applyTaskWorkspaceChanges` (path + content contract,
 * scaffold rule, R2 history, task file-change record), handed in by the host as `applyChanges`.
 */
import type { RepoReadCapability, RepoWriteCapability } from '@builderforce/agent-tools';
import { scanFiles } from '@builderforce/agent-tools/text-scan';
import {
  createRepoCapabilities, WorkspaceError,
  type RepoCapabilityOptions, type SearchMatch, type WorkspaceEntry, type WorkspaceFs, type WorkspaceRead,
} from '@builderforce/agent-tools/workspace';
import { indexByDir, withListingSignal } from '../workspaceFs/flatListing';
import { readWorkspaceFile, WORKSPACE_BRANCH, workspacePrefix } from './workspaceStore';
import type { WorkspaceApplyResult, WorkspaceChangeSet } from './taskWorkspaceTarget';

/** R2 pages read for one snapshot (1,000 keys each). A listing past this is reported incomplete. */
const MAX_LIST_PAGES = 200;
/** Files an UNSCOPED agent search reads: one R2 page of keys, the bound the search always had (each read is a GET, and a Worker has a subrequest budget). */
const AGENT_SEARCH_MAX_FILES = 1_000;
/** Parallel GETs per scan. */
export const R2_READ_CONCURRENCY = 8;

export interface R2WorkspaceFsOptions {
  /** How a write or delete lands (validation, history, change records). Absent: the adapter is read-only. */
  applyChanges?: (changes: WorkspaceChangeSet) => Promise<WorkspaceApplyResult>;
  /** R2 list pages the snapshot may read (default {@link MAX_LIST_PAGES}). A caller that wants one page of keys (the file panel's search) passes 1; a listing the bound cut short is reported incomplete. */
  maxPages?: number;
}

export interface R2WorkspaceFs extends WorkspaceFs {
  /** True when the snapshot stopped before R2 said the listing was complete (a repeated cursor or the page budget). */
  listingIncomplete(): boolean;
}

/** The workspace of `projectId` in `bucket` as a `WorkspaceFs`. */
export function r2WorkspaceFs(bucket: R2Bucket, projectId: number, opts: R2WorkspaceFsOptions = {}): R2WorkspaceFs {
  const prefix = workspacePrefix(projectId);
  const maxPages = Math.max(1, opts.maxPages ?? MAX_LIST_PAGES);
  let snapshot: Promise<Map<string, number>> | null = null;
  let loaded: Map<string, number> | null = null;
  let index: Map<string, Map<string, WorkspaceEntry>> | null = null;
  let incomplete = false;

  const pageAll = async (): Promise<Map<string, number>> => {
    const files = new Map<string, number>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let finished = false;
    for (let pageNo = 0; pageNo < maxPages; pageNo++) {
      if (cursor) {
        if (seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
      }
      const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
      for (const obj of page.objects ?? []) {
        if (!obj.key?.startsWith(prefix)) continue;
        const rel = obj.key.slice(prefix.length);
        if (!rel || rel.endsWith('/')) continue;
        files.set(rel, obj.size);
      }
      if (!page.truncated || !page.cursor) { finished = true; break; }
      cursor = page.cursor;
    }
    incomplete = !finished;
    return files;
  };

  const files = (): Promise<Map<string, number>> => (snapshot ??= pageAll().then((all) => (loaded = all)));
  const dirIndex = async (): Promise<Map<string, Map<string, WorkspaceEntry>>> => (index ??= indexByDir(await files()));
  /** Is `path` a directory? Cheap (one key) until the snapshot exists: a missing file must not page the whole prefix. */
  const isDir = async (path: string): Promise<boolean> => {
    if (path === '') return true;
    if (loaded) return (await dirIndex()).has(path);
    const probe = await bucket.list({ prefix: `${prefix}${path}/`, limit: 1 });
    return (probe.objects?.length ?? 0) > 0;
  };
  /** Keep a loaded snapshot true after a write or delete (never loads one). */
  const settle = (path: string, size: number | null): void => {
    if (!loaded) return;
    if (size === null) loaded.delete(path); else loaded.set(path, size);
    index = null;
  };
  const apply = (changes: WorkspaceChangeSet): Promise<WorkspaceApplyResult> => {
    if (!opts.applyChanges) throw new WorkspaceError('unsupported', 'this workspace is read-only');
    return opts.applyChanges(changes);
  };

  const fs: R2WorkspaceFs = {
    listingIncomplete: () => incomplete,

    async *list(dir) {
      // R2 has no directories: one that holds no key is simply empty.
      for (const entry of (await dirIndex()).get(dir)?.values() ?? []) yield entry;
    },

    async read(path, { maxBytes }): Promise<WorkspaceRead> {
      const content = await readWorkspaceFile(bucket, projectId, path);
      if (content === null) return (await isDir(path)) ? { status: 'is_directory' } : { status: 'not_found' };
      // Characters stand in for bytes: workspace files are text, and a prefix is all a cap needs.
      return content.length > maxBytes ? { status: 'ok', content: content.slice(0, maxBytes), truncated: true } : { status: 'ok', content, truncated: false };
    },

    async write(path, content) {
      const applied = await apply({ writes: [{ path, content }] });
      if (applied.rejected.length) throw new WorkspaceError('io', applied.rejected[0]!.reason);
      settle(path, content.length);
    },

    async remove(path) {
      if ((await readWorkspaceFile(bucket, projectId, path)) === null) return 'missing';
      const applied = await apply({ deletes: [path] });
      if (applied.rejected.length) throw new WorkspaceError('io', applied.rejected[0]!.reason);
      settle(path, null);
      return 'deleted';
    },

    /**
     * The shared neutral scan with R2's budget: bounded parallel GETs, and an UNSCOPED search reads at most one
     * page of keys' worth of files (a scoped one may read the whole scope). A listing the page bound cut short is truncated too.
     */
    async search(query, scope, { signal }) {
      const found = await scanFiles(fs, query, scope, {
        concurrency: R2_READ_CONCURRENCY,
        ...(scope ? {} : { maxFiles: AGENT_SEARCH_MAX_FILES }),
        ...(signal ? { signal } : {}),
      });
      if (!found.ok) throw new WorkspaceError(found.code ?? 'io', found.error ?? 'search failed');
      return { matches: (found.matches ?? []) as SearchMatch[], truncated: found.truncated === true || incomplete };
    },
  };
  return fs;
}

/** `note` joined to what an IDE-workspace result adds to it. */
const withNote = (existing: string | undefined, added: string): string => (existing ? `${added}. ${existing}` : added);

/**
 * The shared coding capabilities over `fs`, plus the one thing R2 adds: its listing can be cut
 * short by the page budget, so a truncated listing says so (the tool then words an empty glob
 * as "incomplete", never "absent").
 */
export function r2Capabilities(fs: R2WorkspaceFs, opts: Pick<RepoCapabilityOptions, 'onWrite'> & { projectName?: string } = {}): { repoRead: RepoReadCapability; repoWrite: RepoWriteCapability } {
  const { projectName, ...shared } = opts;
  const { repoRead, repoWrite } = createRepoCapabilities(fs, shared);
  const where = projectName ? `IDE workspace ${projectName}` : 'the IDE workspace';
  // A workspace write reports the "workspace" branch and says where it landed (the tool result surfaces `branch` to the model); the shared provider stays host-neutral.
  return {
    repoRead: withListingSignal(repoRead, { incomplete: fs.listingIncomplete, ref: () => WORKSPACE_BRANCH }),
    repoWrite: {
      async writeFile(path, content, summary) {
        const r = await repoWrite.writeFile(path, content, summary);
        return r.ok ? { ...r, branch: WORKSPACE_BRANCH, note: withNote(r.note, `wrote to ${where}`) } : r;
      },
      async editFile(path, oldString, newString, replaceAll) {
        const r = await repoWrite.editFile(path, oldString, newString, replaceAll);
        return r.ok ? { ...r, branch: WORKSPACE_BRANCH, note: withNote(r.note, `wrote to ${where}`) } : r;
      },
      async deleteFile(path, reason) {
        const r = await repoWrite.deleteFile(path, reason);
        return r.ok && r.deleted ? { ...r, branch: WORKSPACE_BRANCH, note: withNote(r.note, `deleted from ${where}`) } : r;
      },
    },
  };
}
