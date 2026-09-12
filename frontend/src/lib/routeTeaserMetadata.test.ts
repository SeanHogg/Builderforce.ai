import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import { getRouteMarketing, indexableTeaserRoutes, noindexTeaserRoutes } from './routeMarketing';
import { routeTeaserMetadata, routeTeaserSchema } from './routeTeaserMetadata';
import { classifyShell } from './shellRouting';

/**
 * `getTranslations` backed by the English catalog. An unresolved key comes
 * back as its dotted path — what next-intl renders — so a head built from a
 * missing key is visible to the assertions below rather than silently "set".
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => {
    let node: unknown = (en as Record<string, unknown>)[namespace];
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === 'string' ? node : `${namespace}.${key}`;
  },
}));

const APP_DIR = resolve(__dirname, '../app');

/** The route directory that serves `pathname`, matching `[param]` segments. */
function routeDir(pathname: string): string | null {
  let dir = APP_DIR;
  for (const segment of pathname.split('/').filter(Boolean)) {
    const exact = resolve(dir, segment);
    if (existsSync(exact)) { dir = exact; continue; }
    const dynamic = readdirSync(dir, { withFileTypes: true }).find((e) => e.isDirectory() && /^\[[^.\]]+\]$/.test(e.name));
    if (!dynamic) return null;
    dir = resolve(dir, dynamic.name);
  }
  return dir;
}

function routeSources(pathname: string): { page: string; head: string } {
  const dir = routeDir(pathname);
  const read = (name: string) => (dir && existsSync(resolve(dir, name)) ? readFileSync(resolve(dir, name), 'utf8') : '');
  const page = read('page.tsx');
  return { page, head: `${page}\n${read('layout.tsx')}` };
}

/** A route that answers with a server redirect serves no HTML, so it has no head to carry. */
const isServerRedirect = (page: string) => /\b(?:redirect|retiredRoute)\(/.test(page) && !/generateMetadata/.test(page);

describe('routeTeaserMetadata', () => {
  it('resolves every route the sitemap submits to a non-empty, indexable head', async () => {
    const routes = indexableTeaserRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const meta = await routeTeaserMetadata(route);
      const title = (meta.title as { absolute: string }).absolute;
      expect(title, route).toMatch(/\S — Builderforce\.ai$/);
      expect(title, route).not.toMatch(/^(?:nav|routeMarketing)\./);
      expect(meta.description, route).toBeTruthy();
      expect(meta.description, route).not.toMatch(/^(?:nav|routeMarketing)\./);
      expect(meta.alternates?.canonical, route).toBe(route);
      expect(meta.robots, route).toBeUndefined();
    }
  });

  it('opts out of the root title template, whose brand the title already carries', async () => {
    const meta = await routeTeaserMetadata('/inbox');
    expect(meta.title).toEqual({ absolute: expect.stringMatching(/ — Builderforce\.ai$/) });
  });

  it('keeps operator tooling out of the index', async () => {
    expect((await routeTeaserMetadata('/admin')).robots).toEqual({ index: false, follow: true });
  });

  it('emits the teaser FAQ JSON-LD for a route with a FAQ, and nothing for one without', () => {
    const graph = (routeTeaserSchema('/workforce')?.['@graph'] ?? []) as { '@type': string }[];
    expect(graph.map((node) => node['@type'])).toContain('FAQPage');
    expect(getRouteMarketing('/inbox')?.faq).toBeUndefined();
    expect(routeTeaserSchema('/inbox')).toBeNull();
  });
});

/**
 * THE RATCHET. After guest preview a signed-out visitor gets the real page on
 * every app route, so the teaser's head no longer renders at the URLs the
 * sitemap submits. Each one must declare a head of its own, and one whose
 * registry row carries a FAQ must emit its JSON-LD — or a new marketed route
 * ships to the sitemap with the root layout's generic title.
 */
describe('every indexable app route serves its own head', () => {
  const appRoutes = indexableTeaserRoutes().filter((route) => classifyShell(route) === 'app');

  it('finds a route entry for each', () => {
    expect(appRoutes.filter((route) => !routeSources(route).page)).toEqual([]);
  });

  it('declares metadata on the server', () => {
    const missing = appRoutes.filter((route) => {
      const { head } = routeSources(route);
      return !/routeTeaserMetadata\(|export\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b)/.test(head);
    });
    expect(missing).toEqual([]);
  });

  it('renders the FAQ JSON-LD where the registry carries one', () => {
    const missing = appRoutes.filter((route) => {
      const { head } = routeSources(route);
      if (!routeTeaserSchema(route)) return false;
      return !/<(?:RouteTeaserJsonLd|JsonLd)\b/.test(head);
    });
    expect(missing).toEqual([]);
  });
});

/**
 * A retired route answers with a redirect, so it belongs in NEITHER list. The sitemap
 * submitting one files a soft error on every crawl and spends crawl budget on a URL
 * that is not the page; robots.txt disallowing one is worse — a crawler told not to
 * fetch the old URL never follows it to the page that replaced it. The two tests
 * above used to EXEMPT redirects, which is exactly how three retired routes stayed
 * in the sitemap: the rule a registry row has to meet was switched off for the rows
 * that could not meet it.
 */
describe('no teaser route answers with a redirect', () => {
  it.each([
    ['sitemap', indexableTeaserRoutes],
    ['robots disallow', noindexTeaserRoutes],
  ] as const)('%s lists none', (_list, routes) => {
    expect(routes().filter((route) => isServerRedirect(routeSources(route).page))).toEqual([]);
  });
});
