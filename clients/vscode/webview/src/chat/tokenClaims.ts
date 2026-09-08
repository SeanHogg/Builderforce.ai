/**
 * Reading the tenant JWT's claims for the diagnostics dump.
 */

/**
 * Best-effort decode of the tenant JWT's claims for the diagnostics dump — the api
 * mints `{ tid: tenantId, sub: userId }` (see `authMiddleware`). Pure client-side
 * base64url decode (no verification — this is display-only); returns {} on any malformed
 * token so "Copy diagnostics" never throws over identity it couldn't read.
 */
export function decodeTokenClaims(token: string | null): { tid?: number | string; sub?: string } {
  if (!token) return {};
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { tid?: number | string; sub?: string };
    return { tid: claims.tid, sub: claims.sub };
  } catch {
    return {};
  }
}
