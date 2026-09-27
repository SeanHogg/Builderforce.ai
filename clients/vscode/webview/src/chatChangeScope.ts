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
 * `null` (no chat, or the list could not be loaded) and an empty list (the chat has
 * recorded no changes yet) both keep every change: the pill never hides work it
 * cannot attribute.
 */
export interface ScopableChange {
  /** Absolute path. */
  id?: string;
  /** Repo-relative path. */
  path: string;
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

export function scopeChangesToChat<T extends ScopableChange>(changes: readonly T[], chatFiles: readonly string[] | null): T[] {
  if (!chatFiles || chatFiles.length === 0) return [...changes];
  const files = chatFiles.map(norm).filter(Boolean);
  return changes.filter((change) => {
    const rel = norm(change.path);
    const abs = change.id ? norm(change.id) : '';
    // A single-segment name (`a.ts`) only ever matches a repo-relative path exactly;
    // the absolute-suffix form needs a recorded path with a directory in it.
    return files.some((f) => f === rel || (abs !== '' && (f === abs || (f.includes('/') && abs.endsWith(`/${f}`)))));
  });
}
