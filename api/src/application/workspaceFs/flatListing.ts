/**
 * flatListing - what every FLAT-keyed remote store shares when it stands behind the one coding
 * provider (`@builderforce/agent-tools/workspace`). R2 and a git tree list by prefix, not by
 * directory: the adapter pages the whole listing ONCE, folds it into a directory index here, and
 * serves the provider's one-level `list()` from that. A listing the store cut short is carried to
 * the result so an empty glob is never reported as absence.
 */
import type { RepoReadCapability } from '@builderforce/agent-tools';
import type { WorkspaceEntry } from '@builderforce/agent-tools/workspace';

/** Every directory of `files` (path to size) mapped to its immediate children (files and dirs). */
export function indexByDir(files: Iterable<readonly [string, number | undefined]>): Map<string, Map<string, WorkspaceEntry>> {
  const dirs = new Map<string, Map<string, WorkspaceEntry>>();
  const child = (parent: string, entry: WorkspaceEntry): void => {
    const kids = dirs.get(parent) ?? new Map<string, WorkspaceEntry>();
    if (!kids.has(entry.path)) kids.set(entry.path, entry);
    dirs.set(parent, kids);
  };
  for (const [path, size] of files) {
    const segs = path.split('/');
    for (let i = 0; i < segs.length; i++) {
      const here = segs.slice(0, i + 1).join('/');
      const entry: WorkspaceEntry = i === segs.length - 1
        ? { path, kind: 'file', ...(size === undefined ? {} : { size }) }
        : { path: here, kind: 'dir' };
      child(segs.slice(0, i).join('/'), entry);
    }
  }
  return dirs;
}

/** `repoRead` whose listing also reports a cut-short store listing (`incomplete`) as `truncated`, and names the `ref` it read. */
export function withListingSignal(repoRead: RepoReadCapability, signal: { incomplete: () => boolean; ref: () => string }): RepoReadCapability {
  return {
    ...repoRead,
    async listFiles(subdir, glob, listOpts) {
      const r = await repoRead.listFiles(subdir, glob, listOpts);
      return r.ok ? { ...r, ref: signal.ref(), truncated: r.truncated === true || signal.incomplete() } : r;
    },
  };
}
