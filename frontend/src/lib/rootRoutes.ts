/**
 * THE ROOT ROUTE MATRIX — every first path segment this app can legitimately
 * serve.
 *
 * `app/[burnrateDomain]/page.tsx` is a catch-all over the ENTIRE root level, so
 * it is the route every mistyped URL on the site lands on. It answered those
 * with `notFound()`, which renders the branded 404 body but cannot set the
 * status on a streamed edge response — a soft 404, and search engines index it
 * as a live page. The status has to be decided BEFORE rendering starts, which
 * means before the route runs, which means middleware.
 *
 * Middleware has no access to Next's route table, so the table is declared here
 * and `rootRoutes.test.ts` asserts it against the two sources of truth it
 * mirrors — the directories under `src/app` and the single-segment public
 * destinations `[burnrateDomain]` itself serves. Adding a route directory
 * without declaring it here fails the suite rather than 404ing in production.
 *
 * Kept free of imports on purpose: middleware ships in the Cloudflare Worker
 * bundle, and pulling `publicDestinations` (and through it the whole nav graph)
 * in for a string comparison would put the nav graph in front of every request.
 */

/** Directories under `src/app`. Asserted exhaustive by `rootRoutes.test.ts`. */
export const APP_ROUTE_SEGMENTS: readonly string[] = [
  'about', 'activate', 'admin', 'agent-ops', 'agent-worker', 'agents', 'alerts', 'auth',
  'billing', 'blog', 'book', 'book-demo', 'brainstorm', 'ceremonies', 'challenges',
  'career', 'cofounder', 'compare', 'compile', 'content-manager', 'contributors', 'create',
  'creation-canvas', 'crm', 'dashboard', 'dashboards', 'data-rooms', 'deal', 'debug',
  'demo', 'developers', 'diagnostics', 'disputes', 'docs', 'embed', 'embedded', 'evermind', 'f',
  'facts', 'features', 'finops', 'freelancer', 'growth', 'hires', 'hiring', 'import', 'inbox',
  'incidents', 'insights', 'integrations', 'invoice', 'kanban-templates', 'knowledge',
  'legal', 'legal-documents', 'login', 'logs', 'lti', 'marketplace', 'media', 'meetings',
  'models', 'monitoring', 'p', 'personas', 'pmo', 'pricing', 'product', 'projects', 'prompts',
  'quality', 'realize', 'references', 'register', 'resume', 'salary', 'sales', 'seat',
  'security', 'sell-builderforce', 'settings', 'sign', 'skills', 'soc2', 'surveys',
  'talent', 'tasks', 'templates', 'tenants', 'timeline', 'tools', 'training', 'tutorials',
  'webcontainer', 'workflows', 'workforce',
];

/**
 * The single-segment slugs `[burnrateDomain]` resolves through
 * `referenceBySlug`. These have no directory of their own — the catch-all IS
 * their route — so they must be declared alongside the directories or the
 * middleware check would 404 the very pages that route exists to serve.
 */
export const BURNRATE_DOMAIN_SEGMENTS: readonly string[] = [
  'business-intelligence', 'companies-contacts', 'customer-engagement',
  'governance-security', 'investor-intelligence', 'marketing-growth',
  'operational-cadence', 'product-management', 'sales-revenue',
  'survival-focused-agile',
];

const KNOWN = new Set<string>([...APP_ROUTE_SEGMENTS, ...BURNRATE_DOMAIN_SEGMENTS]);

/**
 * Is this pathname a root-level slug that resolves to NOTHING?
 *
 * Deliberately narrow — it answers `true` only for a single-segment path with
 * no dot in it that is absent from both tables. Multi-segment paths already get
 * a real 404 from Next's own router (`/foo/bar-unknown` measured 404), asset
 * requests carry an extension, and every declared route falls through
 * untouched, so the check can never swallow a legitimate URL.
 */
export function isUnknownRootSlug(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false;
  const slug = pathname.slice(1);
  if (slug === '') return false;              // the home page
  if (slug.includes('/')) return false;       // Next's router already 404s these
  if (slug.includes('.')) return false;       // favicon.ico, robots.txt, sitemap.xml…
  if (slug.startsWith('_')) return false;     // _next, _not-found and friends
  return !KNOWN.has(slug);
}

/**
 * Where an unknown root slug is rewritten to. Any path with two segments whose
 * first segment has no route directory matches nothing, so next-on-pages falls
 * through to its own not-found handling — which serves the SAME branded static
 * 404 body with a real 404 status. That is the already-verified good path
 * (`/foo/bar-unknown`), reused rather than re-implemented.
 */
export const NOT_FOUND_REWRITE_PATH = '/_bf-not-found/404';
