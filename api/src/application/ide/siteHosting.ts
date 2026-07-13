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
import { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';
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
]);

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
  projectId: number;
  r2Prefix: string;
  status: string;
  versionToken: string;
  indexDocument: string;
}

function siteCacheKey(subdomain: string): string {
  return `site-lookup:${subdomain}`;
}

/**
 * Resolve a subdomain to its site record, cached read-through. Returns null when
 * no active site owns the subdomain.
 */
export async function lookupSite(env: Env, subdomain: string): Promise<SiteRecord | null> {
  return getOrSetCached<SiteRecord | null>(
    env,
    siteCacheKey(subdomain),
    async () => {
      const rows = await neon(env.NEON_DATABASE_URL)`
        SELECT project_id, r2_prefix, status, version_token, index_document
        FROM project_sites WHERE subdomain = ${subdomain} LIMIT 1`;
      const row = rows[0] as {
        project_id: number; r2_prefix: string; status: string;
        version_token: string; index_document: string;
      } | undefined;
      if (!row || row.status === 'disabled') return null;
      return {
        projectId: row.project_id,
        r2Prefix: row.r2_prefix,
        status: row.status,
        versionToken: row.version_token,
        indexDocument: row.index_document,
      };
    },
    { kvTtlSeconds: 600 },
  );
}

/** Drop the cached lookup for a subdomain (call after a publish / status change). */
export async function invalidateSite(env: Env, subdomain: string): Promise<void> {
  await invalidateCached(env, siteCacheKey(subdomain));
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
