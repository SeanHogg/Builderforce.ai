import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_ROUTE_SEGMENTS,
  BURNRATE_DOMAIN_SEGMENTS,
  isUnknownRootSlug,
} from './rootRoutes';
import { REFERENCE_DESTINATIONS } from './publicDestinations';

/**
 * The route-matrix verification the soft-404 fix turns on: middleware answers a
 * real 404 for any root slug absent from these tables, so the tables must stay
 * exhaustive or a live route starts 404ing site-wide.
 */
describe('root route matrix', () => {
  const appDirs = readdirSync(join(__dirname, '..', 'app'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('['))
    .map((e) => e.name)
    .sort();

  it('declares every directory under src/app', () => {
    expect([...APP_ROUTE_SEGMENTS].sort()).toEqual(appDirs);
  });

  it('declares every single-segment slug the [burnrateDomain] catch-all serves', () => {
    const slugs = REFERENCE_DESTINATIONS
      .map((entry) => entry.marketingHref)
      .filter((href) => href.startsWith('/') && !href.slice(1).includes('/'))
      .map((href) => href.slice(1))
      .filter((slug) => !appDirs.includes(slug))
      .sort();
    expect([...BURNRATE_DOMAIN_SEGMENTS].sort()).toEqual(slugs);
  });

  it('never reports a declared route as unknown', () => {
    for (const segment of [...appDirs, ...BURNRATE_DOMAIN_SEGMENTS]) {
      expect(isUnknownRootSlug(`/${segment}`), segment).toBe(false);
    }
  });

  it('leaves the home page, assets, internals and nested paths alone', () => {
    for (const path of [
      '/', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/manifest.json',
      '/_next/static/chunk.js', '/_not-found', '/foo/bar-unknown', '/blog/some-post',
    ]) {
      expect(isUnknownRootSlug(path), path).toBe(false);
    }
  });

  it('reports a genuinely unknown root slug', () => {
    expect(isUnknownRootSlug('/does-not-exist-xyz')).toBe(true);
    expect(isUnknownRootSlug('/hired-video')).toBe(true);
  });
});
