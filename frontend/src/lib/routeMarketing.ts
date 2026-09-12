import { faqEntryKeys, type FaqItem } from './content/faq';
import { PRODUCT_SECTIONS, productSurfaceKey } from './content/product';
import { FOR_HIRE_NAV_GROUPS, NAV_GROUPS, SALES_NAV_GROUPS, findActiveGroup, type NavGroup } from './navGroups';
import { classifyShell, isOperatorOnlyRoute } from './shellRouting';

/**
 * Marketing copy shown to logged-out visitors who land on an authenticated
 * route — so a deep link to /dashboard, /create, /brainstorm, etc. renders a rich
 * feature page (hero + how-it-works + FAQ + related articles + JSON-LD) instead
 * of a blank gate, redirect, or one-line teaser.
 *
 * The base hero (icon/title/description) is derived from PRODUCT_SECTIONS
 * (single source of truth for the product surfaces); `extra` covers authed
 * routes that aren't a marketed surface. The per-route `DETAILS` overlay adds
 * the marketing body, FAQ, SEO description, and the RELATED_ARTICLES surface key
 * used to attach associated blog content. Lookup is longest-prefix so /create/123
 * and /settings/members resolve.
 *
 * ── THE THREE TIERS ─────────────────────────────────────────────────────────
 * There are 86 authenticated routes and this file hand-writes copy for 25 of
 * them, so "what does the OTHER route show" is the question that decides what a
 * visitor actually meets. It used to be one generic sentence — "This is part of
 * Builderforce.ai" — served identically at /inbox, /insights, /incidents and
 * every seat, which is the closest thing to a 404 a working page can be.
 *
 *   1. REGISTRY   — a hand-authored surface (below). Full hero, highlights, FAQ.
 *   2. DESTINATION — no entry here, but the route belongs to a NAV_GROUPS row.
 *                    The hero is the destination's own localized name, icon and
 *                    one-line pitch, and the "what's inside" band is its tabs.
 *                    Nothing is retyped: `nav.group.*` already names every row
 *                    in five languages, so a new destination is a marketing page
 *                    the day it is a menu row, in every locale, or it fails the
 *                    catalog ratchet in `routeMarketing.test.ts`.
 *   3. GENERIC    — neither. The method itself (Read → Prove → Build) rather
 *                  than a lock icon, and `noindex`, because a page with the same
 *                  body at forty URLs is duplicate content by definition.
 *
 * NO TIER CARRIES ENGLISH IN THIS FILE. Tier 1 used to — ~160 literals of hero,
 * highlight, FAQ and SEO copy, served in English to every locale and into every
 * localized `<head>` — under a standing decision that marketing copy stayed
 * English. The operator reversed it on 2026-09-12 ("translate all marketing
 * strings"), so the registry now holds STRUCTURE and catalog keys
 * (`routeMarketing.route.<slug>.*`), and {@link getRouteMarketing} resolves them
 * through the caller's translator. The product-surface rows and the Projects FAQ
 * resolve the same way, through the keys `content/product.ts` and
 * `content/faq.ts` publish — no row carries text any more.
 */
export interface RouteHighlight {
  title: string;
  desc: string;
}

/** A ground-visual figure (SVG in /public) rendered on the marketing teaser to
 *  make the case visually. The shared RouteMarketing component self-gates on
 *  presence, so adding figures to a route is a one-line data edit. */
export interface RouteFigure {
  src: string;
  alt: string;
  caption: string;
}

/** A route's teaser copy, RESOLVED — every field already in the visitor's language. */
export interface RouteMarketing {
  icon: string;
  title: string;
  description: string;
  /** "How it works" / benefit points rendered under the hero. */
  highlights?: RouteHighlight[];
  /** Ground-visual figures rendered under the highlights to make the case. */
  figures?: RouteFigure[];
  /** FAQ rendered on the teaser AND emitted as FAQPage JSON-LD for SEO/GEO. */
  faq?: FaqItem[];
  /** RELATED_ARTICLES surface key → associated blog posts shown on the teaser. */
  relatedSurface?: string;
  /** Longer description used for the document title's meta + JSON-LD app entity. */
  seoDescription?: string;
}

/**
 * Copy as the registry holds it: a catalog KEY (resolved in the visitor's locale),
 * or text another module has already localized. Never English typed into this file.
 */
type Copy = { key: string } | string;

/**
 * The translator {@link getRouteMarketing} resolves keys through — a FULL catalog
 * key in, a string out. The narrowest slice of next-intl's `t` this module uses,
 * so a client component (`useTranslations()`), a server head (`getTranslations()`)
 * and a test (`createTranslator`) can all hand one in.
 */
export type RouteMarketingTranslate = (key: string) => string;

interface RouteMarketingSource {
  icon: string;
  title: Copy;
  description: Copy;
  highlights?: { title: Copy; desc: Copy }[];
  figures?: RouteFigure[];
  faq?: { question: Copy; answer: Copy }[];
  relatedSurface?: string;
  seoDescription?: Copy;
}

type DetailSource = Omit<RouteMarketingSource, 'icon' | 'title' | 'description'>;

/** Where this file's own copy lives in the catalogs. */
const ROUTE_NS = 'routeMarketing.route';
const routeKey = (slug: string, field: string): Copy => ({ key: `${ROUTE_NS}.${slug}.${field}` });

/**
 * The marketed surfaces, keyed by PATH.
 *
 * Two corrections over the naive `fromSurfaces[s.href] = …`, both of which were
 * silently wrong. A surface's `href` is a LINK, so it may carry a query
 * (`/projects?tab=portfolio`) or point off-site (the VS Code extension) — and a
 * key with a `?` in it can never equal a pathname, so those rows registered
 * nothing while the extension row registered a marketplace.visualstudio.com key.
 * Stripping the query makes them match, and FIRST-WINS keeps the destination's
 * own row: four surfaces link into `/projects`, and last-wins had `/projects`
 * titled "Workforce Kanban & Templates".
 */
const fromSurfaces: Record<string, RouteMarketingSource> = {};
PRODUCT_SECTIONS.forEach((section, si) => {
  section.surfaces.forEach((s, fi) => {
    if (!s.href.startsWith('/')) return;
    const path = s.href.split('?')[0];
    if (fromSurfaces[path]) return;
    fromSurfaces[path] = {
      icon: s.icon,
      title: { key: productSurfaceKey(si, fi, 'title') },
      description: { key: productSurfaceKey(si, fi, 'desc') },
    };
  });
});

/** An authed route that is not a marketed surface: its own title and pitch, keyed. */
const ownRow = (slug: string, icon: string): RouteMarketingSource => ({
  icon,
  title: routeKey(slug, 'title'),
  description: routeKey(slug, 'description'),
});

const extra: Record<string, RouteMarketingSource> = {
  // `/brainstorm` and `/training` carried a full DETAILS body (highlights, FAQ,
  // SEO copy) and no base, so the overlay landed on the generic default: a page
  // headed "This is part of Builderforce.ai" with three Brain Storm highlights
  // under it. A DETAILS key without a base row is now a test failure.
  '/brainstorm': ownRow('brainstorm', '🧠'),
  '/workflows': ownRow('workflows', '🔀'),
  '/settings': ownRow('settings', '⚙'),
  '/tenants': ownRow('tenants', '🏢'),
  '/admin': ownRow('admin', '⚙'),
  '/agent-worker': ownRow('agent-worker', '🤖'),
};

/**
 * A route's marketing body, as STRUCTURE: how many highlights and FAQ entries it
 * carries, each one a catalog entry under `routeMarketing.route.<slug>` —
 * `seoDescription`, `highlight.h<n>.{title,desc}`, `faq.q<n>.{question,answer}`.
 * The related-article surface is the slug, which every overlay already shared.
 */
function detail(slug: string, counts: { highlights?: number; faq?: number } = {}): DetailSource {
  const range = (n = 0) => Array.from({ length: n }, (_, i) => i + 1);
  return {
    relatedSurface: slug,
    seoDescription: routeKey(slug, 'seoDescription'),
    ...(counts.highlights ? { highlights: range(counts.highlights).map((n) => ({ title: routeKey(slug, `highlight.h${n}.title`), desc: routeKey(slug, `highlight.h${n}.desc`) })) } : {}),
    ...(counts.faq ? { faq: range(counts.faq).map((n) => ({ question: routeKey(slug, `faq.q${n}.question`), answer: routeKey(slug, `faq.q${n}.answer`) })) } : {}),
  };
}

/**
 * Per-route marketing body, FAQ, SEO copy, and related-article surface. This is
 * the content that turns a thin "sign in" gate into a real feature page for
 * logged-out visitors and crawlers. Keyed by route path (longest-prefix match).
 */
const DETAILS: Record<string, DetailSource> = {
  '/brainstorm': detail('brainstorm', { highlights: 3, faq: 3 }),
  '/workflows': detail('workflows', { highlights: 3, faq: 3 }),
  // The Projects FAQ is shared with the Projects JSON-LD (`projectsTasksSchema`),
  // so it is the one set at `marketing.content.faq.projectsTasks` rather than a
  // copy under this slug.
  '/projects': { ...detail('projects'), faq: faqEntryKeys('projectsTasks').map(({ question, answer }) => ({ question: { key: question }, answer: { key: answer } })) },
  '/workforce': detail('workforce', { highlights: 3, faq: 3 }),
  '/skills': detail('skills', { highlights: 3, faq: 3 }),
  '/personas': detail('personas', { highlights: 3, faq: 3 }),
  '/content-manager': detail('content-manager', { highlights: 3, faq: 2 }),
  '/security': detail('security', { highlights: 3, faq: 3 }),
  '/dashboard': detail('dashboard', { highlights: 3, faq: 2 }),
};

const REGISTRY: Record<string, RouteMarketingSource> = { ...fromSurfaces, ...extra };

/**
 * Every registry a signed-out visitor's path could belong to.
 *
 * `NAV_GROUPS` alone is the builder's menu, and the three restricted account
 * types navigate their own — so resolving `/freelancer/profile` or `/sales`
 * against the builder list returns nothing and those routes fall to the generic
 * page. `FREELANCER_NAV_GROUPS` is deliberately absent: it is `FOR_HIRE_NAV_GROUPS`
 * plus a Settings row that is already here.
 */
const TEASER_NAV_GROUPS: NavGroup[] = [...NAV_GROUPS, ...FOR_HIRE_NAV_GROUPS, ...SALES_NAV_GROUPS];

/**
 * The destination that owns this route, if any — tier 2 above.
 *
 * This is the SAME resolver the authenticated rail uses to decide which row is
 * lit (`findActiveGroup`), which is the point: a signed-out visitor and a
 * signed-in one are told they are in the same place, because one function
 * answers "where is this" for both.
 */
export function destinationForRoute(pathname: string): NavGroup | undefined {
  return findActiveGroup(pathname, TEASER_NAV_GROUPS);
}

/**
 * Destination teasers that must NOT be indexed: operator tooling and PERSONAL
 * consoles. Same reasoning as {@link isNoindexRegistryRoute} — the page stays for
 * anyone holding the link, it just has nothing to rank for. Superadmin-only rows
 * are DERIVED rather than listed, so a new one is excluded by existing.
 */
const NOINDEX_DESTINATION_IDS = new Set([
  'settings',
  'sales',
  'freelancer-dashboard',
  'freelancer-profile',
  'freelancer-workspace',
  'freelancer-timecard',
  'freelancer-gigs',
]);

function isNoindexDestination(group: NavGroup): boolean {
  return group.superadminOnly === true || NOINDEX_DESTINATION_IDS.has(group.id);
}

/**
 * Destination rows that render a teaser of their own — a nav row whose href is a
 * plain path on an app route that no registry entry already covers.
 *
 * Filtered by `classifyShell` rather than by a second list: `/marketplace` and
 * `/knowledge` are nav rows AND public pages, and a public page does not need a
 * teaser (nor a second sitemap row pointing at the same URL).
 */
function destinationTeaserRoutes(): { route: string; group: NavGroup }[] {
  const seen = new Set<string>();
  const rows: { route: string; group: NavGroup }[] = [];
  for (const group of TEASER_NAV_GROUPS) {
    const route = group.href;
    if (route.includes('?') || seen.has(route)) continue;
    if (REGISTRY[route] || classifyShell(route) !== 'app') continue;
    seen.add(route);
    rows.push({ route, group });
  }
  return rows;
}

/**
 * Which routes must NOT be indexed — DERIVED from `isOperatorOnlyRoute`, not
 * retyped.
 *
 * The rule is now one sentence: a route keeps its `RouteMarketing` teaser
 * exactly when a signed-out visitor may not preview it, and a teaser that is the
 * only thing at a URL for operator tooling must not be indexed. A "Platform
 * Admin" page in the index invites exactly the traffic it should never receive,
 * and a workspace switcher has nothing to rank for.
 *
 * It was a hand-typed set of four here while the shell decided the same question
 * from its own list, and the two had drifted: `/security`, `/billing`, `/debug`,
 * `/logs` and `/monitoring` were being submitted to the sitemap as marketing
 * landing pages for operator surfaces. One declaration cannot disagree with
 * itself.
 */
function isNoindexRegistryRoute(route: string): boolean {
  return isOperatorOnlyRoute(route);
}

/**
 * The teaser routes that belong in the sitemap, derived from the registry.
 *
 * Derived rather than hand-listed on purpose: the previous sitemap named twelve
 * of these by hand and silently omitted the rest, so adding a surface to the
 * registry left it unindexed and nobody found out. Now the two cannot drift —
 * a new marketed surface is indexed by existing, and a new internal one is
 * excluded by being named above.
 */
export function indexableTeaserRoutes(): string[] {
  const marketed = Object.keys(REGISTRY).filter((route) => !isNoindexRegistryRoute(route));
  const destinations = destinationTeaserRoutes()
    .filter(({ group }) => !isNoindexDestination(group))
    .map(({ route }) => route);
  return [...new Set([...marketed, ...destinations])].sort();
}

/**
 * The teaser routes that must stay OUT of the index, as paths.
 *
 * The third consumer of the same decision, and the reason it is derived: a
 * static `public/robots.txt` disallowed `/projects`, `/security`, `/skills`,
 * `/personas`, `/workforce`, `/brainstorm` and `/training` while `sitemap.ts`
 * submitted every one of them and the page's own robots meta said `index`. Three
 * files, three answers, and the sitemap's answer was the one nobody could act on
 * — a crawler that is told not to fetch a URL never reads the meta tag that
 * would have let it in.
 */
export function noindexTeaserRoutes(): string[] {
  const destinations = destinationTeaserRoutes()
    .filter(({ group }) => isNoindexDestination(group))
    .map(({ route }) => route);
  const marketed = Object.keys(REGISTRY).filter(isNoindexRegistryRoute);
  return [...new Set([...marketed, ...destinations])].sort();
}

/**
 * Should this route tell crawlers to stay away? Consumed by robots metadata.
 *
 * The generic tier is noindex BY DEFAULT, and that is the interesting half: its
 * body is identical at every route that reaches it, so indexing it would file
 * forty URLs of duplicate content under forty different names. A route earns its
 * place in the index by being a marketed surface or a named destination.
 */
export function isNoindexTeaserRoute(pathname: string): boolean {
  // Which surface's copy this route renders — its own, or the one it INHERITS by
  // prefix. The distinction decides the next two lines: `/admin/sales` renders
  // Platform Admin's copy without ever having been marketed, and an exact-match
  // test let it back into the index under a route whose parent is excluded.
  const marketed = REGISTRY[pathname] ? pathname : longestPrefixMatch(pathname, REGISTRY)?.key;
  if (marketed && isNoindexRegistryRoute(marketed)) return true;
  if (REGISTRY[pathname]) return false;
  const group = destinationForRoute(pathname);
  if (group) return isNoindexDestination(group);
  return !marketed;
}

/** Longest-prefix match of `pathname` against a `key → value` map. */
function longestPrefixMatch<T>(pathname: string, map: Record<string, T>): { key: string; val: T } | null {
  let best: { key: string; val: T } | null = null;
  for (const [key, val] of Object.entries(map)) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, val };
    }
  }
  return best;
}

/** One piece of registry copy, in the translator's locale. */
function resolve(copy: Copy, t: RouteMarketingTranslate): string {
  return typeof copy === 'string' ? copy : t(copy.key);
}

/**
 * The hand-authored copy for this route in the visitor's language, or `null` when
 * it has none.
 *
 * Null rather than a default: a default returned here is a default nobody can
 * see coming, and the caller is the only place that knows whether it can fall
 * back to a destination (tier 2) before it falls back to the method (tier 3).
 *
 * The translator is REQUIRED, not defaulted to English: an optional one is how a
 * server head ends up shipping the English title to a zh visitor because one
 * call site forgot to pass it.
 */
export function getRouteMarketing(pathname: string, t: RouteMarketingTranslate): RouteMarketing | null {
  const base = REGISTRY[pathname] ?? longestPrefixMatch(pathname, REGISTRY)?.val ?? null;
  if (!base) return null;
  const details = DETAILS[pathname] ?? longestPrefixMatch(pathname, DETAILS)?.val;
  const source: RouteMarketingSource = details ? { ...base, ...details } : base;
  return {
    icon: source.icon,
    title: resolve(source.title, t),
    description: resolve(source.description, t),
    ...(source.seoDescription ? { seoDescription: resolve(source.seoDescription, t) } : {}),
    ...(source.highlights ? { highlights: source.highlights.map((h) => ({ title: resolve(h.title, t), desc: resolve(h.desc, t) })) } : {}),
    ...(source.faq ? { faq: source.faq.map((f) => ({ question: resolve(f.question, t), answer: resolve(f.answer, t) })) } : {}),
    ...(source.figures ? { figures: source.figures } : {}),
    ...(source.relatedSurface ? { relatedSurface: source.relatedSurface } : {}),
  };
}

/**
 * Every catalog key the registry resolves — the ratchet's input. A key that is
 * absent from a locale renders its dotted path as a hero title or FAQ answer,
 * which is why `messages.test.ts` checks this list in all five catalogs.
 */
export function routeMarketingCatalogKeys(): string[] {
  const keys = new Set<string>();
  const add = (copy: Copy | undefined) => { if (copy && typeof copy !== 'string') keys.add(copy.key); };
  const sources: Partial<RouteMarketingSource>[] = [...Object.values(REGISTRY), ...Object.values(DETAILS)];
  for (const source of sources) {
    add(source.title);
    add(source.description);
    add(source.seoDescription);
    for (const h of source.highlights ?? []) { add(h.title); add(h.desc); }
    for (const f of source.faq ?? []) { add(f.question); add(f.answer); }
  }
  return [...keys].sort();
}

/** i18n key for a destination's one-line marketing pitch, under `routeMarketing`. */
export function destinationPitchKey(groupId: string): string {
  return `destination.${groupId}.description`;
}

/** Every destination id that needs a pitch — the ratchet's input, and the reason
 *  a new nav row cannot ship as an unnamed page in four languages. */
export function teaserDestinationIds(): string[] {
  return [...new Set(TEASER_NAV_GROUPS.map((group) => group.id))].sort();
}

let teaserDestinations: ReadonlySet<string> | null = null;

/**
 * The pitch key for a destination that HAS a teaser, or `null`.
 *
 * The same set the catalog ratchet reads (`teaserDestinationIds`) gates the lookup, so
 * a group id the ratchet never checked — a rail row outside `TEASER_NAV_GROUPS`, a
 * caller resolving an id by hand — cannot render its dotted key as a pitch. The teaser
 * and its head both resolve the pitch through this, so they cannot disagree about
 * which destinations have one.
 */
export function teaserDestinationPitchKey(groupId: string): string | null {
  teaserDestinations ??= new Set(teaserDestinationIds());
  return teaserDestinations.has(groupId) ? destinationPitchKey(groupId) : null;
}

/** The routes carrying a DETAILS overlay. Exported for the ratchet that asserts
 *  each one has a base row — an overlay without a base used to render its
 *  highlights under the GENERIC hero, which is how /brainstorm and /training
 *  spent months titled "This is part of Builderforce.ai". */
export function detailRoutes(): string[] {
  return Object.keys(DETAILS);
}

/** Routes with hand-authored copy. Exported for the same ratchet. */
export function marketedRoutes(): string[] {
  return Object.keys(REGISTRY);
}
