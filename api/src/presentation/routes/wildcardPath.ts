import type { Context } from 'hono';

/**
 * wildcardPath — THE way to read what a route's trailing `*` matched.
 *
 * Hono does not expose the wildcard as a named param: `c.req.param('*')` is
 * always `undefined`. That is how every single-file read/write in the IDE
 * workspace became a request for the EMPTY path — `PUT /api/ide/projects/50/
 * files/src/App.jsx` answered `400 Path is required`, and a GET 404'd on a file
 * the listing had returned one call earlier.
 *
 * The hand-rolled alternatives are no safer. `c.req.path` carries the mount
 * prefix, so `c.req.path.replace('/uploads/', '')` on `/api/brain/uploads/x.png`
 * yields `/api/brainx.png`, and a greedy `replace(/^.*\/weights\//, '')` eats
 * everything up to the LAST occurrence of the literal — both mangle any key that
 * repeats the segment. So the remainder is derived from the matched route
 * itself: count the literal segments the pattern spends before its `*`, and
 * whatever follows them in the request path is what the wildcard matched.
 *
 * Contract:
 *   • Returns a path with no leading slash (`src/App.jsx`), '' when the route has
 *     no trailing `*` or the wildcard matched nothing.
 *   • Segments are decoded as Hono decodes params, so `a%20b.png` arrives as
 *     `a b.png` — the exact inverse of a client's per-segment encodeURIComponent.
 *   • Empty segments are PRESERVED (`a//b` stays `a//b`): validators reject them,
 *     and silently collapsing one would write to a different key than requested.
 */
export function wildcardPath(c: Context): string {
  const route = c.req.routePath ?? '';
  // Only a whole trailing segment is a path wildcard — `/wildcard-*/abc` is not.
  if (!route.endsWith('/*')) return '';
  // '/api/ide/projects/:projectId/files/' → 6 elements before the wildcard's own.
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
