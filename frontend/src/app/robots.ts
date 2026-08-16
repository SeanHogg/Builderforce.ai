import type { MetadataRoute } from 'next';
import { noindexTeaserRoutes } from '@/lib/routeMarketing';

/**
 * robots.txt, DERIVED from the registry that decides what a logged-out visitor
 * meets — the same source `sitemap.ts` and the teaser's own robots meta read.
 *
 * It replaces a hand-maintained `public/robots.txt` last touched in April, which
 * had drifted into contradicting both: it disallowed `/projects`, `/security`,
 * `/skills`, `/personas`, `/workforce`, `/brainstorm`, `/training`,
 * `/content-manager` and `/workflows` — nine routes the sitemap submits and the
 * pages themselves declare indexable, every one of them a real marketing page
 * with a hero, highlights and an FAQ. A `Disallow` beats a `<meta name=robots>`
 * because the crawler never fetches the page to read the meta, so the static
 * file silently won every disagreement and those pages could not rank at all.
 *
 * One list cannot disagree with itself: a route is excluded here because
 * `routeMarketing` says it is operator tooling or a personal console, and adding
 * a destination of either kind excludes it from all three surfaces at once.
 */

/**
 * Paths with nothing to crawl in the first place — an API, a device-activation
 * link, framed webview hosts, the debug surface. A hosting fact rather than a
 * marketing judgement, so it is listed rather than derived.
 *
 * `/embed/` keeps its trailing slash on purpose. robots.txt matches a bare
 * PREFIX, so `/embed` would also disallow `/embedded` — the Embedded
 * Capabilities destination, a real marketing page — which is the exact
 * swallow-the-neighbour bug `underPrefix()` exists to prevent in `shellRouting`.
 */
const NON_PUBLIC_PATHS = ['/api/', '/auth/', '/activate', '/webcontainer', '/embed/', '/embed$', '/debug'];

/**
 * The AI search crawlers this site names explicitly.
 *
 * Naming them is a grant of PERMISSION to use the public site, not a wider grant
 * than a search engine gets: they take the same disallow list, so "explicitly
 * allowed" and "allowed everything, including the admin console" stop being the
 * same sentence.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
  'Bingbot',
  'DuckDuckBot',
  'Amazonbot',
  'meta-externalagent',
  'CCBot',
];

export default function robots(): MetadataRoute.Robots {
  const disallow = [...NON_PUBLIC_PATHS, ...noindexTeaserRoutes()];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      { userAgent: AI_CRAWLERS, allow: '/', disallow },
    ],
    sitemap: 'https://builderforce.ai/sitemap.xml',
    host: 'https://builderforce.ai',
  };
}
