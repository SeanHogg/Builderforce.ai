/**
 * Subdomain hosting for IDE (Designer) projects — shared logic for the publish
 * endpoint and the public sites server.
 *
 * Built assets live in R2 under `sites/<subdomain>/...` and are served at
 * `<subdomain>.builderforce.ai` (or, until the wildcard route is wired, via the
 * path fallback `/api/sites/<subdomain>/...`). We host on the SINGLE-LABEL apex
 * wildcard `*.builderforce.ai` (not `*.apps.builderforce.ai`) because Cloudflare's
 * free Universal SSL cert covers `*.builderforce.ai` but NOT a second-level
 * wildcard — so the apex is shared with platform hostnames (api/www/…), which is
 * why `subdomainFromHost` MUST refuse reserved labels. The subdomain→site lookup is
 * the hot path (every asset request resolves it), so it's served through the
 * canonical read-through cache and invalidated on publish via `version_token`.
 */
import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { projectSites } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

/** R2 key prefix all hosted sites live under. */
export const SITES_PREFIX = 'sites/';

/**
 * Apex the wildcard hosting domain hangs off. `<sub>.builderforce.ai`.
 * Single-label so the free Universal SSL `*.builderforce.ai` cert applies; the
 * apex is therefore shared with platform hostnames and protected by
 * `RESERVED_SUBDOMAINS` on both the publish (claim) and serve (route) sides.
 */
export const HOSTING_APEX = 'builderforce.ai';

/**
 * Labels that can never be a user site — they collide with platform hostnames
 * or are confusing/abusable. Enforced in the route (not the schema) so it can
 * grow without a migration.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'api', 'app', 'apps', 'www', 'admin', 'docs', 'mail', 'smtp', 'imap', 'ftp',
  'ns', 'ns1', 'ns2', 'dns', 'cdn', 'assets', 'static', 'media', 'img', 'images',
  'status', 'health', 'dashboard', 'portal', 'auth', 'login', 'account', 'billing',
  'support', 'help', 'blog', 'dev', 'staging', 'test', 'preview', 'internal',
  'builderforce', 'gateway', 'llm', 'brain', 'ide', 'studio', 'workforce',
  // `worker.builderforce.ai` is the builderforce-worker Custom Domain. It was
  // NOT reserved, so a user could claim `worker` as a published-site subdomain
  // and shadow a platform hostname — the wildcard route delivers that Host here,
  // and an unreserved label is served straight from R2.
  'worker',
]);

/**
 * Reserved labels that another Worker owns but the greedy `*.builderforce.ai/*`
 * route still delivers to THIS one.
 *
 * A Workers Custom Domain does not reliably beat a wildcard zone route: with both
 * configured, `www.builderforce.ai` arrived at the API worker, returned null from
 * `subdomainFromHost` (correctly — it is reserved), fell through to API routing and
 * answered `{"error":"Not found"}` as JSON. The "fall through to normal routing"
 * the comment below describes can only reach THIS worker's routers; it cannot hand
 * the request back to builderforce-frontend.
 *
 * Redirecting to the canonical apex is both the fix and the behaviour `www` should
 * always have had.
 */
const CANONICAL_APEX_ALIASES: ReadonlySet<string> = new Set(['www']);

/**
 * A 301/308 to the canonical apex when the request arrived on a host this worker
 * does not serve, or null to continue normal routing.
 *
 * GET/HEAD get 301 (cacheable, the conventional canonical-host redirect); anything
 * else gets 308 so the method and body survive — a 301 would silently turn a POST
 * into a GET.
 */
export function canonicalApexRedirect(request: Request): Response | null {
  const host = (request.headers.get('host') ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (!host.endsWith(`.${HOSTING_APEX}`)) return null;
  const label = host.slice(0, host.length - HOSTING_APEX.length - 1);
  if (!CANONICAL_APEX_ALIASES.has(label)) return null;

  const url = new URL(request.url);
  url.hostname = HOSTING_APEX;
  url.port = '';
  const status = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
  return new Response(null, { status, headers: { Location: url.toString() } });
}

/** DNS label rule: 1–63 chars, lowercase alnum + hyphen, no leading/trailing hyphen. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalize a raw subdomain candidate to a valid DNS label, or null when it
 * can't be made into one / is reserved. Lowercases, swaps spaces+underscores for
 * hyphens, strips other chars, and collapses repeats.
 */
export function normalizeSubdomain(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (!slug || !LABEL_RE.test(slug) || RESERVED_SUBDOMAINS.has(slug)) return null;
  return slug;
}

/**
 * Derive a hosting subdomain from a request Host header, or null when the host
 * isn't a single-label `<sub>.builderforce.ai` site host. Returns null for the
 * apex itself, for multi-label hosts, and — crucially — for RESERVED labels:
 * since the apex is shared with platform hostnames (`api.builderforce.ai` is THIS
 * worker, plus www/app/etc.), a reserved label must fall through to normal
 * routing rather than be looked up (and 404'd) as a user site.
 */
export function subdomainFromHost(host: string | undefined): string | null {
  if (!host) return null;
  const h = (host.split(':')[0] ?? '').toLowerCase();
  if (!h.endsWith(`.${HOSTING_APEX}`)) return null;
  const label = h.slice(0, h.length - HOSTING_APEX.length - 1);
  if (!label || label.includes('.') || RESERVED_SUBDOMAINS.has(label)) return null;
  return label;
}

/** The resolved, cacheable shape the asset server needs. JSON-serializable. */
export interface SiteRecord {
  /** The site row id — the join key for traffic counting and collections. */
  siteId: number;
  projectId: number;
  tenantId: number;
  r2Prefix: string;
  status: string;
  versionToken: string;
  indexDocument: string;
  /**
   * The `website` canvas object this site's landing page was rendered from, or null
   * when the creator has not authored one.
   *
   * Carried on the CACHED record rather than read per request: the serving fork asks
   * "is there a shop window here?" on every root document, and a nullable column that
   * changes only on publish is exactly the kind of slow-changing fact that must not
   * cost a round trip on the hot path. The publish invalidates this key, so the answer
   * cannot outlive the release that changed it.
   */
  landingObjectId: string | null;
}

function siteCacheKey(subdomain: string): string {
  return `site-lookup:${subdomain}`;
}

/** Cache key for the custom-hostname index. Separate keyspace from the label
 *  index so releasing a domain cannot evict an unrelated subdomain. */
function customDomainCacheKey(hostname: string): string {
  return `site-domain:${hostname.toLowerCase()}`;
}

/** The columns every lookup path selects — one definition so the two indexes
 *  (subdomain and custom hostname) can never return different shapes. */
const SITE_LOOKUP_COLUMNS = {
  siteId: projectSites.id,
  projectId: projectSites.projectId,
  tenantId: projectSites.tenantId,
  r2Prefix: projectSites.r2Prefix,
  status: projectSites.status,
  versionToken: projectSites.versionToken,
  indexDocument: projectSites.indexDocument,
  landingObjectId: projectSites.landingObjectId,
} as const;

/**
 * Resolve a subdomain to its site record, cached read-through. Returns null when
 * no active site owns the subdomain.
 */
export async function lookupSite(env: Env, subdomain: string): Promise<SiteRecord | null> {
  return getOrSetCached<SiteRecord | null>(
    env,
    siteCacheKey(subdomain),
    async () => {
      const [row] = await buildDatabase(env)
        .select(SITE_LOOKUP_COLUMNS)
        .from(projectSites)
        .where(eq(projectSites.subdomain, subdomain))
        .limit(1);
      if (!row || row.status === 'disabled') return null;
      return row;
    },
    { kvTtlSeconds: 600 },
  );
}

/**
 * Resolve a tenant's OWN hostname to its site record. Only an `active` custom
 * domain resolves: a domain that is merely claimed (`pending_dns`) must NOT
 * serve, or claiming a hostname you don't control would hijack it the moment
 * someone pointed DNS at us.
 */
export async function lookupSiteByCustomDomain(env: Env, hostname: string): Promise<SiteRecord | null> {
  const host = hostname.toLowerCase();
  return getOrSetCached<SiteRecord | null>(
    env,
    customDomainCacheKey(host),
    async () => {
      const [row] = await buildDatabase(env)
        .select(SITE_LOOKUP_COLUMNS)
        .from(projectSites)
        .where(and(eq(projectSites.customDomain, host), eq(projectSites.customDomainStatus, 'active')))
        .limit(1);
      if (!row || row.status === 'disabled') return null;
      return row;
    },
    { kvTtlSeconds: 600 },
  );
}

/** Drop the cached lookup for a subdomain (call after a publish / status change). */
export async function invalidateSite(env: Env, subdomain: string): Promise<void> {
  await invalidateCached(env, siteCacheKey(subdomain));
}

/** Why a candidate address cannot be used. `ok` means it is free right now. */
export type SubdomainAvailabilityReason = 'ok' | 'invalid' | 'reserved' | 'taken';

export interface SubdomainAvailability {
  /** The normalised DNS label, or null when the input cannot become one. */
  label: string | null;
  available: boolean;
  reason: SubdomainAvailabilityReason;
  /** The full host the site would answer on, when the label is usable. */
  host: string | null;
}

/**
 * IS THIS ADDRESS FREE?
 *
 * ── WHY THIS EXISTS AS A PRIMITIVE ──────────────────────────────────────────
 * `publishStaticSite` has always been able to answer this — it normalises the
 * requested label, checks global ownership and returns a 409 — but only at the
 * moment of publishing. So a creator found out what their app was called by
 * shipping it, and there was no way to ask beforehand or to change it after.
 *
 * Extracted rather than duplicated: the conversion path (claiming an address for
 * a brand-new app), the availability endpoint the creator types into, and the
 * publish path all have to answer this question identically. Three copies of a
 * uniqueness rule is how one of them starts accepting a reserved label.
 *
 * ── DELIBERATELY NOT CACHED ─────────────────────────────────────────────────
 * This is a live uniqueness check typed a character at a time, and the answer it
 * gives is acted on immediately. A cached "available" that survives somebody
 * else claiming the name is worse than no check at all — the creator is told
 * they have it and the publish then fails. Same reasoning as the licence gate in
 * `listingCommerce`: a cache in front of an authorising read is a stale answer
 * with consequences. The query itself is one indexed lookup on a unique column.
 *
 * `forProjectId` excludes the caller's own site, so re-checking the address you
 * already hold reports `ok` rather than `taken`.
 */
export async function checkSubdomainAvailability(
  db: { select: ReturnType<typeof buildDatabase>['select'] },
  raw: string,
  forProjectId?: number | null,
): Promise<SubdomainAvailability> {
  const trimmed = (raw ?? '').trim();
  const label = normalizeSubdomain(trimmed);
  if (!label) {
    // `normalizeSubdomain` folds "unusable" and "reserved" into one null, but the
    // creator needs to know which: "pick different characters" and "that name
    // belongs to the platform" are different instructions.
    const bare = trimmed.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
    const reason: SubdomainAvailabilityReason = RESERVED_SUBDOMAINS.has(bare) ? 'reserved' : 'invalid';
    return { label: null, available: false, reason, host: null };
  }

  // DELIBERATELY cross-tenant: a subdomain is unique across the whole hosting
  // apex, so scoping this to the asker's tenant would report a label as available
  // while another tenant is already serving on it.
  const [owner] = await db
    .select({ projectId: projectSites.projectId })
    .from(projectSites)
    .where(acrossTenants(projectSites, 'global_uniqueness', eq(projectSites.subdomain, label)))
    .limit(1);

  const takenByAnother = owner != null && Number(owner.projectId) !== Number(forProjectId ?? -1);
  return {
    label,
    available: !takenByAnother,
    reason: takenByAnother ? 'taken' : 'ok',
    host: takenByAnother ? null : `${label}.${HOSTING_APEX}`,
  };
}

/** Drop the cached custom-hostname lookup (call on claim / verify / release). */
export async function invalidateCustomDomain(env: Env, hostname: string): Promise<void> {
  await invalidateCached(env, customDomainCacheKey(hostname));
}

/**
 * Resolve ANY inbound Host header to a site, or null when the host is not a
 * published site. This is THE routing entry point — the middleware, the site
 * data API and the traffic counter all go through it, so a custom domain and a
 * platform subdomain can never diverge in what they serve.
 *
 * Order matters: the platform-label check runs first and is cheap/synchronous,
 * so normal `<sub>.builderforce.ai` traffic never pays for a second lookup.
 */
export async function resolveSiteForHost(env: Env, host: string | undefined): Promise<SiteRecord | null> {
  if (!host) return null;
  const subdomain = subdomainFromHost(host);
  if (subdomain) return lookupSite(env, subdomain);
  const bare = (host.split(':')[0] ?? '').toLowerCase();
  // Anything on our own apex that wasn't a valid site label (reserved, or the
  // apex itself) is platform traffic — never look it up as a customer domain.
  if (!bare || bare === HOSTING_APEX || bare.endsWith(`.${HOSTING_APEX}`)) return null;
  return lookupSiteByCustomDomain(env, bare);
}

/** A short, URL-safe cache-bust token. */
export function newVersionToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/** Minimal extension→content-type map for static hosting. */
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  wasm: 'application/wasm',
  webmanifest: 'application/manifest+json',
};

export function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** True when the path looks like a build-hashed immutable asset (e.g. app.4f3a.js). */
export function isImmutableAsset(path: string): boolean {
  return /\.[a-f0-9]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg)$/i.test(path);
}
