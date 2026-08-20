import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { destinationForRoute, destinationPitchKey, getRouteMarketing, isNoindexTeaserRoute } from '@/lib/routeMarketing';
import { BRAND } from '@/lib/content';

/**
 * THE SERVER HEAD for a route that shows a marketing teaser when signed out.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `RouteMarketing` set `document.title`, the description and (for operator
 * tooling) `robots: noindex` from a `useEffect`. That works for crawlers that
 * execute JS and for nobody else: the HTML a link preview, a social card
 * fetcher or a non-JS crawler receives carries the ROOT layout's generic title,
 * and — worse — the root layout declares `index, follow`, so an operator route
 * like `/admin` ships an indexable head and only stops being indexable once a
 * browser has run the effect.
 *
 * The head has to be decided before the response, which means the route entry,
 * which means a SERVER component. This is the shared body of that
 * `generateMetadata` so 16 route files do not each re-derive the same three
 * facts from the same two registries.
 *
 * A route entry that is still `'use client'` cannot export `generateMetadata`
 * at all, so it keeps the effect until it is converted — the same conversion
 * the RSC entry tracks. `RouteMarketing`'s effect is therefore a FALLBACK now,
 * not the mechanism.
 */
export async function routeTeaserMetadata(pathname: string): Promise<Metadata> {
  const marketing = getRouteMarketing(pathname);
  const group = destinationForRoute(pathname);
  const [t, tNav] = await Promise.all([
    getTranslations('routeMarketing'),
    getTranslations('nav'),
  ]);

  const surface = marketing?.title ?? (group ? tNav(group.labelKey) : t('generic.title'));
  const pitch = marketing?.description ?? (group ? t(destinationPitchKey(group.id)) : t('generic.description'));
  const description = marketing?.seoDescription ?? pitch;
  const title = `${surface} — ${BRAND.name}`;

  return {
    title,
    description,
    // The `noindex` half matters as much as the title: every authenticated
    // route renders this teaser to a logged-out visitor, which quietly turned
    // operator tooling into indexable pages. `follow`, not `nofollow` — the
    // links out of a teaser are ordinary marketing pages worth crawling.
    robots: isNoindexTeaserRoute(pathname) ? { index: false, follow: true } : undefined,
    alternates: { canonical: pathname },
    openGraph: { title, description, url: pathname, siteName: BRAND.name },
  };
}
