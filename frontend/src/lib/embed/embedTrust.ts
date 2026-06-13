/**
 * Pure trust-boundary decision for the embed frame's inbound postMessage handler,
 * extracted so it can be unit-tested without jsdom/window plumbing.
 *
 * Rules:
 *   - allowlist set  → accept ONLY origins on the list (the configured contract).
 *   - allowlist empty + production → reject ALL origins (default-CLOSED). This
 *     mirrors the `/embed/*` `frame-ancestors 'self'` CSP, which already blocks
 *     foreign framing when the env is unset — so the two layers fail the same
 *     way instead of the frame trusting any origin while the CSP blocks it.
 *   - allowlist empty + non-production → accept (dev convenience: cross-origin
 *     framing from a local BurnRateOS without configuring the env).
 *
 * See gap [1462]: previously an empty allowlist accepted an `auth` postMessage
 * from ANY origin even in production (a foot-gun, though not exploitable while
 * the CSP blocks foreign framing).
 */
export function isTrustedHostOrigin(origin: string, allow: readonly string[], isProduction: boolean): boolean {
  if (allow.length > 0) return allow.includes(origin);
  return !isProduction;
}
