/**
 * The server-side read for PUBLIC, uncredentialed API data.
 *
 * `lib/apiClient` is the transport for everything else and must stay that way —
 * but it reads `localStorage` and `document.cookie` to attach the session, and
 * neither exists in a server component, `generateMetadata` or `sitemap.ts`. So
 * the surfaces that render before a session exists (marketplace SEO pages, the
 * sitemap, the integrations catalog) had to call `fetch` directly, and each one
 * that did grew its own base-URL constant, its own error swallowing and its own
 * caching decision. This is that one helper instead.
 *
 * Two properties it guarantees that a bare `fetch` did not:
 *
 *  - **No credential leaves.** These endpoints are public by definition; nothing
 *    here reads or attaches a token, so a call cannot accidentally carry one to
 *    a surface that is cached and shared.
 *  - **The read is CACHED by default.** Next's data cache holds the response for
 *    `revalidateSeconds` (one hour unless a caller passes its own), so a build that
 *    renders four hundred marketplace pages makes one request per endpoint rather
 *    than four hundred. A public catalog that changes on deploy does not need a
 *    shorter window than this. A caller whose source already versions its own cache
 *    (published website pages) passes `revalidateSeconds: 0` to add no second layer.
 *
 * Failure is always `null` / a caller-supplied fallback: a marketing page whose
 * API is briefly unreachable must still render, because the alternative is a 500
 * on the page a buyer is reading.
 */

import { API_ORIGIN } from './apiOrigin';

const API_BASE = API_ORIGIN;

/** One hour. Public catalogs change on deploy, not on the minute. */
const DEFAULT_REVALIDATE_SECONDS = 3600;

export interface PublicApiOptions {
  /** Seconds the response stays in Next's data cache. */
  revalidateSeconds?: number;
}

/**
 * GET a public endpoint, parsed as JSON. Returns `null` on any non-2xx, network
 * failure or unparseable body — the caller decides what an absent answer means.
 *
 * `path` is joined to the API base, so pass it rooted (`/marketplace/skills`).
 */
export async function publicApiGet<T>(path: string, options: PublicApiOptions = {}): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      next: { revalidate: options.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// ── Published website pages (`/api/public/web/:owner/p/*`) ───────────────────

/** A published tenant (or platform) website page — the shape `publicWebsitePage` returns. */
export interface PublicWebsitePage {
  id: number;
  path: string;
  title: string;
  bodyMarkdown: string;
  canonicalPath: string | null;
  shellKind: string;
}

/** `platform` names the platform's own pages; anything else is a workspace id. */
const WEB_OWNER = /^(platform|[1-9]\d{0,9})$/;

const webOwnerBase = (owner: string): string => `/api/public/web/${owner}`;

/**
 * The absolute API URL for one published page, or `null` when the owner is malformed.
 * The one construction of this URL: `fetchPublicWebsitePage` and the middleware gate
 * (which needs the HTTP status, not a collapsed `null`) both build it here.
 */
export function publicWebsitePageUrl(owner: string, path: string): string | null {
  if (!WEB_OWNER.test(owner)) return null;
  return `${API_BASE}${webOwnerBase(owner)}/p${path}`;
}

/**
 * One published website page, or `null` when the owner is malformed or nothing is
 * published at `path`. The API serves it from its own version-token cache, so this
 * read asks Next's data cache for NO retention (`revalidateSeconds: 0`): a second
 * layer would keep serving an edited page until its window ran out. Per-render
 * de-duplication (metadata + page) is the route's job: it wraps this in React
 * `cache()` itself, because this module is also loaded by middleware, where
 * `cache` does not exist.
 */
export function fetchPublicWebsitePage(owner: string, path: string): Promise<PublicWebsitePage | null> {
  if (!WEB_OWNER.test(owner)) return Promise.resolve(null);
  return publicApiGet<PublicWebsitePage>(`${webOwnerBase(owner)}/p${path}`, { revalidateSeconds: 0 });
}
