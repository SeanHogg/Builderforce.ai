/**
 * Audience-scoped tenant tokens (SEC-SYN-001).
 *
 * A scoped token is a short-lived copy of the caller's tenant JWT carrying `aud`. It lets a
 * sibling extension (Spawn) act for the signed-in user on a fixed list of routes WITHOUT ever
 * holding the full tenant token. This file is the ONE place the audiences and the paths each
 * may reach are written down: the minting route validates against {@link SCOPED_TOKEN_AUDIENCES}
 * and `authMiddleware` enforces {@link audienceAllowsPath}.
 */

export interface AudienceRoute {
  readonly method: string;
  readonly path: string;
}

/**
 * audience -> the exact (method, path) pairs a token of that audience may call. Every
 * OTHER verifier refuses any `aud` token (deny by default, `verifyClaims`); only
 * `authMiddleware` opts in and then applies {@link audienceAllowsPath}.
 */
export const SCOPED_TOKEN_AUDIENCES = {
  spawn: [
    { method: 'GET', path: '/api/spawn/account' },
    { method: 'POST', path: '/api/spawn/build' },
  ],
} as const satisfies Record<string, readonly AudienceRoute[]>;

export type ScopedTokenAudience = keyof typeof SCOPED_TOKEN_AUDIENCES;

/** How long a scoped token lives (seconds). The client re-mints before it lapses. */
export const SCOPED_TOKEN_TTL_SECONDS = 15 * 60;

export function isScopedTokenAudience(value: unknown): value is ScopedTokenAudience {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCOPED_TOKEN_AUDIENCES, value);
}

/** Exact-match: may a token bound to `aud` call `method` `path`? An unknown audience reaches nothing. */
export function audienceAllowsPath(aud: string, method: string, path: string): boolean {
  if (!isScopedTokenAudience(aud)) return false;
  const allowed: readonly AudienceRoute[] = SCOPED_TOKEN_AUDIENCES[aud];
  const normalised = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const verb = method.toUpperCase();
  return allowed.some((route) => route.method === verb && route.path === normalised);
}
