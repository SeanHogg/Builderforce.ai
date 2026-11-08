/**
 * The one reading of a `/w/<owner>/<path…>` URL's page path. Shared by the route and
 * the middleware gate so both refuse the same inputs before any fetch.
 *
 * Each segment must match the API's own path alphabet (`PATH` in `webSurface.ts`), and
 * `.` / `..` are refused so a segment can never walk out of the page's own subtree.
 */
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * The canonical URL for a page: ALWAYS under `/w/<owner>`, never a tenant-supplied
 * first-party path. A tenant `canonicalPath` can only pick another of its OWN pages
 * (it is validated like any path segment list); anything else falls back to the
 * page's own path. The root page is `/w/<owner>` with no trailing slash.
 */
export function websiteCanonicalUrl(owner: string, pagePath: string, canonicalPath: string | null): string {
  const chosen = canonicalPath ? websitePagePath(canonicalPath.split('/').filter(Boolean)) : null;
  const path = chosen ?? pagePath;
  return `/w/${owner}${path === '/' ? '' : path}`;
}

/** The API-ready path (`/docs/pricing`, or `/` for none), or `null` when any segment is invalid. */
export function websitePagePath(segments: readonly string[] | undefined): string | null {
  if (!segments || segments.length === 0) return '/';
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') return null;
  }
  return `/${segments.map(encodeURIComponent).join('/')}`;
}
