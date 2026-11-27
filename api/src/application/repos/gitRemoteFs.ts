/**
 * gitRemoteFs - a git remote (GitHub / GitLab / Bitbucket over their REST APIs) as the shared
 * `WorkspaceFs`, so the cloud agent's file tools run on the ONE coding provider
 * (`@builderforce/agent-tools/workspace`) instead of a host copy.
 *
 * - list: ONE tree listing per ref (`listRepoTree`), cached for this adapter and served one
 *   directory at a time; dropped when this adapter commits. A tree the provider cut short is
 *   remembered (`listingIncomplete`) so an empty glob is never reported as absence.
 * - read: `readRepoFile`, which keeps the source's 60k-character cap as a `truncated` prefix.
 *   A failed read names why: a missing file is `not_found` (a write probes with it), a file past
 *   the contents API size is `too_large`, a directory is `is_directory`, anything else `io`.
 * - write / remove: the existing commit functions; the commit each made is kept for the host
 *   (`takeCommit`) so its records can name the sha and the committed text.
 * - search: `searchRepoCode`, fragments as `{path, text}` with NO `line`. Provider code search
 *   cannot match an exact regex or a line; this is the documented weaker contract.
 */
import type { SearchMatch, WorkspaceEntry, WorkspaceFs, WorkspaceRead } from '@builderforce/agent-tools/workspace';
import { WorkspaceError } from '@builderforce/agent-tools/workspace';
import { indexByDir } from '../workspaceFs/flatListing';
import { commitAgentFile, deleteAgentFile, type TicketRepoContext } from './commitFileAsPendingChange';
import { listRepoTree, readRepoFile, searchRepoCode } from './readRepoContents';
import type { TruncationReason } from './sources/RepoSource';

/** Files one provider code search returns (GitHub allows 50 a page). */
const SEARCH_MAX_FILES = 30;

export interface GitRemoteFsOptions {
  /** The ref reads and listings come from (the base before a first commit, the ticket branch after). */
  readRef(): string;
  /** A repo whose ticket branch may not exist yet: a read that fails at `readRef()` is retried here. */
  fallbackRef?: string;
  /** The commit message of a write or delete. */
  message(op: 'write' | 'delete', path: string): string;
}

/** The commit a write or delete made. */
export interface GitCommit {
  commitSha: string | null;
  commitUrl: string | null;
  /** What was committed (absent for a delete). */
  content?: string;
}

export interface GitRemoteFs extends WorkspaceFs {
  /** True when the tree this adapter listed was cut short by the provider or its page limit. */
  listingIncomplete(): boolean;
  /** The commit the last write or delete of `path` made; read once, then gone. */
  takeCommit(path: string): GitCommit | undefined;
  /** Why the last read of `path` came back partial, if it did. */
  truncationReason(path: string): TruncationReason | undefined;
}

type TreeIndex = { dirs: Map<string, Map<string, WorkspaceEntry>>; truncated: boolean };

/** `repo` as a `WorkspaceFs`. */
export function gitRemoteFs(repo: TicketRepoContext, opts: GitRemoteFsOptions): GitRemoteFs {
  const trees = new Map<string, Promise<TreeIndex>>();
  const commits = new Map<string, GitCommit>();
  const reasons = new Map<string, TruncationReason | undefined>();
  let incomplete = false;

  const treeAt = (ref: string): Promise<TreeIndex> => {
    let tree = trees.get(ref);
    if (!tree) {
      tree = listRepoTree({ ...repo, ref }).then((listed) => {
        if (!listed.ok) throw new WorkspaceError('io', listed.reason);
        incomplete = listed.truncated;
        return { dirs: indexByDir(listed.paths.map((p) => [p, undefined] as const)), truncated: listed.truncated };
      });
      // A failed listing is not cached: the next call asks the provider again.
      tree.catch(() => trees.delete(ref));
      trees.set(ref, tree);
    }
    return tree;
  };

  const readAt = async (path: string, ref: string) => readRepoFile({ ...repo, ref }, path);

  return {
    listingIncomplete: () => incomplete,
    takeCommit(path) { const c = commits.get(path); commits.delete(path); return c; },
    truncationReason: (path) => reasons.get(path),

    async *list(dir) {
      for (const entry of (await treeAt(opts.readRef())).dirs.get(dir)?.values() ?? []) yield entry;
    },

    async read(path): Promise<WorkspaceRead> {
      let rf = await readAt(path, opts.readRef());
      if (!rf.ok && opts.fallbackRef) rf = await readAt(path, opts.fallbackRef);
      if (!rf.ok) {
        if (/^file not found/.test(rf.reason)) return { status: 'not_found' };
        if (/^not a readable file/.test(rf.reason)) return { status: 'is_directory' };
        throw new WorkspaceError(/too large/.test(rf.reason) ? 'too_large' : 'io', rf.reason);
      }
      reasons.set(path, rf.truncated ? rf.truncatedReason : undefined);
      return { status: 'ok', content: rf.content, truncated: rf.truncated };
    },

    async write(path, content) {
      const commit = await commitAgentFile(repo, path, content, opts.message('write', path));
      if (!commit.ok) throw new WorkspaceError('io', commit.reason);
      commits.set(path, { commitSha: commit.commitSha, commitUrl: commit.commitUrl, content });
      trees.clear();
    },

    async remove(path) {
      const del = await deleteAgentFile(repo, path, opts.message('delete', path));
      if (del.ok) {
        commits.set(path, { commitSha: del.commitSha, commitUrl: del.commitUrl });
        trees.clear();
        return 'deleted';
      }
      // Not on the branch: nothing to delete, which is not a failure.
      if (del.code === 'not_found') return 'missing';
      throw new WorkspaceError('io', del.reason);
    },

    async search(query, scope): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
      // The scope is applied INSIDE searchRepoCode (the provider's `path:` qualifier), not post-filtered.
      const sr = await searchRepoCode({ ...repo, ref: opts.readRef() }, query, { maxResults: SEARCH_MAX_FILES, ...(scope ? { path: scope } : {}) });
      if (!sr.ok) throw new WorkspaceError('io', sr.reason);
      const matches = sr.matches.flatMap((m) => (m.fragments.length > 0 ? m.fragments.map((text) => ({ path: m.path, text })) : [{ path: m.path, text: '' }]));
      return { matches, truncated: sr.truncated };
    },
  };
}
