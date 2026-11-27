import type { Context } from 'hono';
import type { DeviceClient } from '@builderforce/creation-canvas-contract';
import type { HonoEnv } from '../../env';

/** The request's client IP: Cloudflare's header, else the first `X-Forwarded-For` hop. */
export function getClientIp(c: Context<HonoEnv>): string | null {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp.trim();

  const xff = c.req.header('X-Forwarded-For');
  if (!xff) return null;

  return xff.split(',')[0]?.trim() ?? null;
}

/** The request's User-Agent, capped at `max` (default 1024; pass a table's own column width when narrower). */
export function getUserAgent(c: Context<HonoEnv>, max = 1024): string | null {
  const ua = c.req.header('User-Agent');
  return ua ? ua.slice(0, max) : null;
}

/**
 * The request-derived claims every tenant-session mint records: who the client is
 * (`userAgent`, `ipAddress`) and what the authenticated token says about its origin
 * (`clientSurface` = the server-signed device `src`, `keyId` = the editor key it derives
 * from). The ONE place a route turns a Hono context into mint claims; the surface / key id
 * are absent (undefined) on a public route with no authenticated token.
 */
export function claimsFromContext(c: Context<HonoEnv>): {
  userAgent: string | null;
  ipAddress: string | null;
  clientSurface: DeviceClient | undefined;
  keyId: string | undefined;
} {
  return {
    userAgent: getUserAgent(c),
    ipAddress: getClientIp(c),
    clientSurface: c.get('clientSurface'),
    keyId: c.get('apiKeyId'),
  };
}
