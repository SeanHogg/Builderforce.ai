import type { Env } from '../../env';
import { tenantHasFeature } from '../tenant/featureEntitlements';

/**
 * "Made with Builderforce.ai" on free-tier published sites.
 *
 * Every HTML document a free tenant's site serves carries a small badge linking
 * back to builderforce.ai. Paying (`removeBranding`, Pro and up) removes it. This is
 * the Framer/Webflow model: the free tier's contribution is a link on a live,
 * public page that real visitors see.
 *
 * It is a plain anchor, not a script, on purpose:
 *   • a site's Content-Security-Policy may forbid inline scripts; markup always renders;
 *   • crawlers read it, so each free site is a genuine backlink;
 *   • it works with JavaScript off.
 * The styles are inline and `!important`, so a site's own `a { … }` rules cannot
 * restyle or hide it. A dark pill with light text reads on both light and dark pages,
 * since inline styles can't follow `prefers-color-scheme`.
 *
 * The badge is the platform's brand, not the tenant's content, so it stays in
 * English the way other "Made with …" badges do.
 */

export const SITE_BADGE_URL = 'https://builderforce.ai/?utm_source=published-site&utm_medium=badge&utm_campaign=made-with';
export const SITE_BADGE_LABEL = 'Made with Builderforce.ai';
const BADGE_ID = 'bf-made-with';

const BADGE_STYLE = [
  'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
  'display:inline-block', 'padding:6px 12px', 'border-radius:999px',
  'background:#111827', 'color:#f9fafb', 'border:1px solid rgba(255,255,255,.18)',
  'box-shadow:0 2px 8px rgba(0,0,0,.25)', 'text-decoration:none',
  'font:500 12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
  'letter-spacing:0', 'opacity:1', 'visibility:visible', 'transform:none',
].map((rule) => `${rule} !important`).join(';');

export function siteBadgeHtml(): string {
  return `<a id="${BADGE_ID}" href="${SITE_BADGE_URL}" target="_blank" rel="noopener" style="${BADGE_STYLE}">${SITE_BADGE_LABEL}</a>`;
}

/** Insert the badge before the LAST `</body>` (or append to a fragment). Idempotent. */
export function injectSiteBadge(html: string): string {
  if (html.includes(`id="${BADGE_ID}"`)) return html;
  const badge = siteBadgeHtml();
  const close = html.toLowerCase().lastIndexOf('</body>');
  return close < 0 ? html + badge : html.slice(0, close) + badge + html.slice(close);
}

/**
 * Add the badge to an HTML document served for `tenantId`'s site, unless the tenant
 * is entitled to remove it. Anything that is not an HTML document passes through
 * untouched, WITHOUT the plan read, so assets cost nothing extra. The plan read
 * itself is the cached `resolveTenantPlan`, invalidated on every plan change, so an
 * upgrade takes the badge down without waiting out a TTL.
 */
export async function withSiteBadge(env: Env, tenantId: number, response: Response): Promise<Response> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('text/html') || !response.body) return response;
  if (await tenantHasFeature(env, tenantId, undefined, 'removeBranding')) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(injectSiteBadge(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
