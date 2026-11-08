/**
 * Scope the workspace's pending changes to the files ONE chat changed.
 *
 * The chat's files come from its work deltas (`GET /api/brain/chats/:id/files`) and
 * may be recorded repo-relative (`src/a.ts`) or absolute, with either separator. A
 * change matches on a whole path — its repo-relative path, its absolute path, or an
 * absolute path ending in `/<recorded dir/path>` — never on a bare suffix or a bare
 * file name, so `a.ts` claims neither `data.ts` nor `src/a.ts`. Case-insensitive, as
 * Windows paths are.
 *
 * `null` (no chat, the chat is only local, or the list could not be loaded) keeps
 * every change: the pill never hides work it cannot attribute. An EMPTY list means
 * the chat recorded no changes of its own — so it filters to nothing, and the pill
 * shows no count rather than claiming the workspace's pre-existing uncommitted work.
 */
export interface ScopableChange {
  /** Absolute path. */
  id?: string;
  /** Repo-relative path. */
  path: string;
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

export function scopeChangesToChat<T extends ScopableChange>(changes: readonly T[], chatFiles: readonly string[] | null): T[] {
  // `null` = unknown / local-only / failed to load — keep everything rather than
  // hide work we cannot attribute. An empty list = the chat recorded NO files of its
  // own, so it owns none of the pending changes — filter to nothing. Treating `[]`
  // like `null` here is what made a fresh chat inherit the workspace's pre-existing
  // uncommitted dirt (the "Changes (24)" a read-only turn never made).
  if (chatFiles === null) return [...changes];
  if (chatFiles.length === 0) return [];
  const files = chatFiles.map(norm).filter(Boolean);
  return changes.filter((change) => {
    const rel = norm(change.path);
    const abs = change.id ? norm(change.id) : '';
    // A single-segment name (`a.ts`) only ever matches a repo-relative path exactly;
    // the absolute-suffix form needs a recorded path with a directory in it.
    return files.some((f) => f === rel || (abs !== '' && (f === abs || (f.includes('/') && abs.endsWith(`/${f}`)))));
  });
}
