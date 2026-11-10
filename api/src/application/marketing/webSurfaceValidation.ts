/**
 * The web surface's input validators and its one error type (PRD 19 §9).
 *
 * A slug/path the URL layer can actually carry. Rejected rather than coerced:
 * silently rewriting a slug means the page the author saved is not the page at
 * the address they were shown. Shared by the authoring service (webSurface.ts) and
 * the public delivery reads (webSurfacePublicDelivery.ts), so both normalise a path
 * the same way — a cache key and a query that disagreed would serve the wrong page.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;

export class WebSurfaceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'WebSurfaceError';
  }
}

export const requireSlug = (slug: string): string => {
  const s = slug.trim().toLowerCase();
  if (!SLUG.test(s) || s.length > 200) {
    throw new WebSurfaceError('slug must be lowercase alphanumeric words separated by single hyphens');
  }
  return s;
};

export const requirePath = (path: string): string => {
  const p = path.trim();
  if (!PATH.test(p) || p.length > 500) {
    throw new WebSurfaceError('path must be an absolute URL path with no query or fragment');
  }
  // '/a/' and '/a' are the same page; storing both is how two rows end up
  // fighting over one canonical URL.
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
};

export const requireTitle = (title: string): string => {
  const t = title.trim();
  if (!t) throw new WebSurfaceError('title is required');
  return t.slice(0, 300);
};
