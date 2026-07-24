/**
 * Same-origin redirect guard (open-redirect fix — M5).
 *
 * A post-login redirect target is only safe when it is a RELATIVE path that
 * stays on THIS origin. This rejects:
 *   - absolute URLs            → `https://evil.com`
 *   - protocol-relative URLs   → `//evil.com` (the browser treats these as
 *                                 cross-origin)
 *   - scheme URLs              → `javascript:…`, `data:…`, `http://…`
 *   - backslash tricks         → `/\evil.com`, `\\evil.com` (browsers normalise
 *                                 `\` to `/`, so `/\evil.com` navigates off-site)
 * Anything unsafe falls back to `/dashboard`.
 *
 * This is the single source of truth imported by BOTH the OAuth callback page
 * and the login page (the DRY rule). It is mirrored — necessarily, across the
 * package boundary — by an identical `isSafeRelativePath` in the API's
 * `oauthRoutes.ts`, which validates the same value server-side before reflecting
 * it into a redirect.
 */
export function isSafeRelativePath(path: string | null | undefined): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('://') &&
    !path.includes('\\')
  );
}

/** Return `path` when it is a safe same-origin relative path, else `fallback`. */
export function safeRedirectPath(
  path: string | null | undefined,
  fallback = '/dashboard',
): string {
  return isSafeRelativePath(path) ? path : fallback;
}
