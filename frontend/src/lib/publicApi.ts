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
 *  - **The read is CACHED.** Next's data cache holds the response for
 *    `revalidateSeconds`, so a build that renders four hundred marketplace pages
 *    makes one request per endpoint rather than four hundred. A public catalog
 *    that changes on deploy does not need a shorter window than this.
 *
 * Failure is always `null` / a caller-supplied fallback: a marketing page whose
 * API is briefly unreachable must still render, because the alternative is a 500
 * on the page a buyer is reading.
 */

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

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
