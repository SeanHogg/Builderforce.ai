/**
 * Reading the claims off a BuilderForce JWT, without verifying it.
 *
 * The API mints `{ tid: tenantId, sub: userId }` on a tenant token (see the api's
 * `authMiddleware`). Three surfaces needed to read `tid` back — the API client
 * (to address an emulated request to the workspace the token actually names), the
 * editor's diagnostics dump, and any board that must know which workspace it is
 * acting in without an `AuthProvider` above it — and each had its own base64url
 * decode. One fact, one decoder.
 *
 * NOT verification, and never a gate: this only chooses a URL or labels a screen.
 * The server verifies the token it is sent, so a forged claim buys nothing. Any
 * malformed token reads as `{}` rather than throwing, because every caller is on a
 * path (a diagnostics copy, a first render) that must not fail over identity it
 * could not parse.
 */

export interface TokenClaims {
  /** The workspace the token acts in. */
  tid?: string | number;
  /** The user the token was minted for. */
  sub?: string;
}

export function decodeTokenClaims(token: string | null | undefined): TokenClaims {
  if (!token) return {};
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as TokenClaims;
  } catch {
    return {};
  }
}

/** The workspace a token names, as the string the `/api/tenants/:id/…` routes take. */
export function tenantIdFromToken(token: string | null | undefined): string | null {
  const { tid } = decodeTokenClaims(token);
  return tid == null || tid === '' ? null : String(tid);
}
