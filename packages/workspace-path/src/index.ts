/**
 * Workspace path validation for R2 keys — ONE contract for both edges.
 *
 * `api/src/application/ide/workspaceStore.ts` and `worker/src/lib/workspacePath.ts`
 * each held this function under a "keep them in sync" comment, which is the
 * comment a drift hides behind. One implementation, aliased at source into both.
 *
 * Rejects anything that could escape the project prefix or produce a key that
 * can never round-trip: empty, absolute (`/x`), backslashes, `.`/`..` segments,
 * empty segments (`a//b`), trailing slash (directory, not a file), control
 * characters, and overlong paths.
 */

export type PathValidation = { ok: true } | { ok: false; reason: string };

/** Longest path accepted — far above anything legitimate, below R2's key cap. */
export const MAX_PATH_LENGTH = 512;

export function validateWorkspacePath(path: string): PathValidation {
  if (typeof path !== 'string' || path.length === 0) return { ok: false, reason: 'Path is required' };
  if (path.length > MAX_PATH_LENGTH) return { ok: false, reason: `Path exceeds ${MAX_PATH_LENGTH} characters` };
  if (path.startsWith('/')) return { ok: false, reason: 'Path must be workspace-relative (no leading /)' };
  if (path.endsWith('/')) return { ok: false, reason: 'Path must name a file, not a directory' };
  if (path.includes('\\')) return { ok: false, reason: 'Use forward slashes in paths' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return { ok: false, reason: 'Path contains control characters' };
  for (const segment of path.split('/')) {
    if (segment === '') return { ok: false, reason: 'Path contains an empty segment' };
    if (segment === '.' || segment === '..') return { ok: false, reason: 'Path traversal segments (./..) are not allowed' };
  }
  return { ok: true };
}
