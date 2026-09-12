import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { destinationForRoute, getRouteMarketing, isNoindexTeaserRoute, teaserDestinationPitchKey } from '@/lib/routeMarketing';
import { routeMarketingSchema } from '@/lib/structured-data';
import { BRAND } from '@/lib/content';

/**
 * THE SERVER HEAD for a route the teaser registry markets — ONE helper, called
 * as the whole body of the route's `generateMetadata`, so a route file carries
 * one line and never a copy of the copy.
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
 * ── WHY IT MATTERS MORE SINCE GUEST PREVIEW ─────────────────────────────────
 * A signed-out visitor now gets the REAL page on every app route but the
 * operator-only ones (`isGuestPreviewRoute`), so the teaser — and with it the
 * per-route title, description and FAQ JSON-LD — no longer renders at the URLs
 * `indexableTeaserRoutes()` still submits to the sitemap. Those URLs ranked on
 * the teaser's head; this helper is how the real page keeps it. The ratchet in
 * `routeTeaserMetadata.test.ts` fails when an indexable app route serves a head
 * without it.
 *
 * Localized the way every other `generateMetadata` in the tree is: through
 * `getTranslations`, which reads the locale cookie. The tier-1 copy in
 * `lib/routeMarketing.ts` is English by a standing decision about marketing
 * copy and is used as it is, exactly as the teaser used it; tiers 2 and 3 are
 * catalog keys and arrive in the visitor's locale.
 *
 * A route entry that is still `'use client'` cannot export `generateMetadata`,
 * so it is split: a server `page.tsx` that exports this and renders the client
 * island beside it (`app/dashboard/DashboardClient.tsx` and its siblings).
 */
export async function routeTeaserMetadata(pathname: string): Promise<Metadata> {
  const marketing = getRouteMarketing(pathname);
  const group = destinationForRoute(pathname);
  const [t, tNav] = await Promise.all([
    getTranslations('routeMarketing'),
    getTranslations('nav'),
  ]);

  const surface = marketing?.title ?? (group ? tNav(group.labelKey) : t('generic.title'));
  const pitchKey = group ? teaserDestinationPitchKey(group.id) : null;
  const pitch = marketing?.description ?? (pitchKey ? t(pitchKey) : t('generic.description'));
  const description = marketing?.seoDescription ?? pitch;
  const title = `${surface} — ${BRAND.name}`;

  return {
    // ABSOLUTE, because this string already carries the brand: through the root
    // layout's `'%s | Builderforce.ai'` template it shipped as "Inbox —
    // Builderforce.ai | Builderforce.ai". The teaser's `document.title` was
    // exactly this string, which is the title these URLs ranked under.
    title: { absolute: title },
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

/**
 * The teaser's JSON-LD for a route that carries a FAQ, or `null`.
 *
 * The same `routeMarketingSchema` graph the teaser rendered — the feature's
 * SoftwareApplication node, its FAQPage and a breadcrumb — derived from the same
 * registry row, so the real page emits what the teaser used to. FAQ routes only:
 * a route with no FAQ never rendered a FAQPage, and its application node alone
 * is not worth a second script tag on a product page. Rendered by
 * `<RouteTeaserJsonLd>` from the server route entry.
 */
export function routeTeaserSchema(pathname: string): Record<string, unknown> | null {
  const marketing = getRouteMarketing(pathname);
  if (!marketing?.faq?.length) return null;
  return routeMarketingSchema({
    path: pathname,
    title: marketing.title,
    description: marketing.seoDescription ?? marketing.description,
    faq: marketing.faq,
  });
}
