/**
 * A PREVIEW of a hosted release, for the person deciding whether to publish it
 * (PRD 33 §5.1.4 / D13 "a person sees the preview before publishing it").
 *
 * The API grants a short-lived capability (`grantSitePreview`): a random 128-bit token
 * stored in KV for {@link SITE_PREVIEW_TTL_SECONDS}, naming exactly one tenant, project
 * and release. The SITES Worker honours it (`resolveSitePreview`): `?bf_preview=<token>`
 * on the site's own host serves that release's files to that visitor only — a cookie
 * carries the grant to the page's assets — and the response is never publicly cached,
 * never counted as traffic or as an A/B exposure, and never recorded by Insights.
 *
 * Dependency-light by design (KV + the site record only): it runs in the sites Worker,
 * whose import graph `check:sites-worker-graph` keeps small. No JWT secret is needed
 * on that Worker — the token is unguessable, expires on its own and can be revoked by
 * deleting one key.
 */
import type { Env } from '../../env';
import { readCookie } from '../../domain/replay/abSplit';
import type { SiteRecord } from './siteHosting';
import { randomHex } from '../../domain/shared/bytes';

export const SITE_PREVIEW_PARAM = 'bf_preview';
export const SITE_PREVIEW_COOKIE = 'bf_preview';
export const SITE_PREVIEW_TTL_SECONDS = 30 * 60;

const TOKEN = /^[0-9a-f]{32}$/;
export const sitePreviewKey = (token: string): string => `site-preview:${token}`;

export interface SitePreviewGrant {
  tenantId: number;
  projectId: number;
  versionToken: string;
  r2Prefix: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface SitePreviewDecision {
  token: string;
  /** The site with the previewed release in place of the live pointer. */
  served: SiteRecord;
  /** Arrived on the query string: set the cookie so the page's assets follow. */
  fromQuery: boolean;
  maxAgeSeconds: number;
}

function newToken(): string {
  return randomHex(16);
}

/** API side: grant a preview of one release. Null when KV is not bound. */
export async function grantSitePreview(
  env: Env,
  input: Omit<SitePreviewGrant, 'expiresAt'>,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date } | null> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return null;
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SITE_PREVIEW_TTL_SECONDS * 1000);
  const grant: SitePreviewGrant = { ...input, expiresAt: expiresAt.getTime() };
  await kv.put(sitePreviewKey(token), JSON.stringify(grant), { expirationTtl: SITE_PREVIEW_TTL_SECONDS });
  return { token, expiresAt };
}

/** The preview token a request carries (query first, then cookie), or null. */
export function previewTokenOf(request: Request): { token: string; fromQuery: boolean } | null {
  const query = new URL(request.url).searchParams.get(SITE_PREVIEW_PARAM);
  if (query && TOKEN.test(query)) return { token: query, fromQuery: true };
  const cookie = readCookie(request.headers.get('cookie'), SITE_PREVIEW_COOKIE);
  return cookie && TOKEN.test(cookie) ? { token: cookie, fromQuery: false } : null;
}

/**
 * Sites Worker side: the release to serve this request from, or null (no token, an
 * unknown or expired one, or a grant for another site → the live release as usual).
 * A request with no token costs no lookup.
 */
export async function resolveSitePreview(env: Env, site: SiteRecord, request: Request, now: number = Date.now()): Promise<SitePreviewDecision | null> {
  const carried = previewTokenOf(request);
  const kv = env.AUTH_CACHE_KV;
  if (!carried || !kv) return null;
  try {
    const raw = await kv.get(sitePreviewKey(carried.token));
    if (!raw) return null;
    const grant = JSON.parse(raw) as Partial<SitePreviewGrant>;
    if (grant.tenantId !== site.tenantId || grant.projectId !== site.projectId) return null;
    if (typeof grant.r2Prefix !== 'string' || typeof grant.versionToken !== 'string' || typeof grant.expiresAt !== 'number') return null;
    const maxAgeSeconds = Math.floor((grant.expiresAt - now) / 1000);
    if (maxAgeSeconds <= 0) return null;
    return {
      token: carried.token,
      served: { ...site, r2Prefix: grant.r2Prefix, versionToken: grant.versionToken },
      fromQuery: carried.fromQuery,
      maxAgeSeconds,
    };
  } catch {
    return null;
  }
}

/** A preview response: private, never cached, never indexed; the cookie on the first hit. */
export function withPreviewHeaders(response: Response, decision: SitePreviewDecision): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.append('Vary', 'Cookie');
  if (decision.fromQuery) {
    headers.append('Set-Cookie', `${SITE_PREVIEW_COOKIE}=${decision.token}; Path=/; Max-Age=${decision.maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
