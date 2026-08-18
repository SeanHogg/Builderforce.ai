/**
 * `wildcardPath` for the worker package.
 *
 * A local replica of `api/src/presentation/routes/wildcardPath.ts` — the two
 * live in separate packages with no shared build, exactly like
 * {@link ./workspacePath.ts}. Keep them in sync with that source of truth.
 *
 * Why it exists: Hono does not expose a route's trailing `*` as a named param,
 * so `c.req.param('*')` is always `undefined`. Every single-file read/write here
 * resolved to the EMPTY path because of it — a write answered "Path is required"
 * and a read 404'd on a file the listing had just returned.
 *
 * Returns the path the wildcard matched, with no leading slash and each segment
 * decoded (the inverse of the client's per-segment encodeURIComponent). Empty
 * segments are preserved so `validateWorkspacePath` can still reject them.
 */
import type { Context } from 'hono';

export function wildcardPath(c: Context): string {
  const route = c.req.routePath ?? '';
  // Only a whole trailing segment is a path wildcard — `/wildcard-*/abc` is not.
  if (!route.endsWith('/*')) return '';
  const start = route.slice(0, -1).split('/').length - 1;
  const segments = c.req.path.split('/');
  if (segments.length <= start) return '';
  return segments.slice(start).map(decodeSegment).join('/');
}

/** Decode one path segment, leaving a malformed escape (`%zz`) as it came. */
function decodeSegment(segment: string): string {
  if (!segment.includes('%')) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
