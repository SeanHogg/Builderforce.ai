/**
 * THE PUBLIC SURFACE (PRD 21 §11.4.5–7).
 *
 * Split out of `navGroups.ts` when that file crossed the 800-line ratchet, along
 * the seam it already had: the rail describes where a SIGNED-IN person can go,
 * and this describes which pages a SIGNED-OUT one can reach. Two sets, two
 * files, still exactly one declaration of each destination — which is the rule
 * `check-destinations.mjs` enforces, and it names both files.
 *
 * `navGroups.ts` re-exports everything here, so no consumer had to change and
 * nothing imports backwards: this module reads the rail, never the reverse.
 */

import type { NavGroup, Stage } from './navGroups';
import { NAV_GROUPS, groupsForStage } from './navGroups';
import type { SeatOrPlatform } from './seats';

/**
 * A PUBLIC destination — a place a signed-out visitor can go (PRD 21 §11.4.5).
 *
 * One array for the whole public surface, because the alternative is what was
 * actually here: `REFERENCE_DESTINATIONS` for the Product menu, `content.ts`'s
 * `RESOURCE_NAV_LINKS` for the Learn menu and `FOOTER_COLUMNS` for the footer —
 * three lists, so the storefront was "Talent / Workforce" in the bar, "Workforce
 * Registry" in the footer and "Marketplace" in the app, and the footer still
 * advertised an `/agents` destination the product had stopped having.
 *
 * Two facts place a row, exactly as they do for an app destination above:
 *
 *  - `placement` — which column it renders in. `idea` / `make` / `run` are the
 *    Product ▾ menu (the same arc as the left panel, so the public menu and the
 *    signed-in rail teach one vocabulary); `read` / `prove` / `buildWith` are
 *    Learn ▾; `bar` is a flat top-level link; `account` is footer-only.
 *  - `seat` — the owner, which tints the row in its seat's hue everywhere.
 *
 * `panel` is the §11.4.5 property: signed out the row is an ordinary page with
 * an ordinary URL and ordinary SEO; signed in the SAME route mounts inside
 * `ShellPanel` over a board that stays mounted. It is declared per row rather
 * than assumed, because `/blog` genuinely wants the whole screen and `/soc2`
 * genuinely does not.
 */
export const PRODUCT_COLUMNS = ['idea', 'make', 'run'] as const;
export const LEARN_COLUMNS = ['read', 'prove', 'buildWith'] as const;
export type MenuColumn = (typeof PRODUCT_COLUMNS)[number] | (typeof LEARN_COLUMNS)[number];
/** `bar` = a flat header link; `account` = footer only (sign in, demo, media). */
export type Placement = MenuColumn | 'bar' | 'account';

/** A named section INSIDE a reference page, offered as the panel's index rail. */
export interface ReferenceSection {
  /** The page's own anchor id. */
  id: string;
  /** i18n key under `referencePanel.section`. */
  labelKey: string;
}

export interface PublicDestination {
  id: string;
  /**
   * Marketing copy key under `burnrateMarketing.domains.<copyId>`. Absent for a
   * row whose copy lives under `marketingNav.dest.<id>` — see `destTitleKey`.
   */
  copyId?: string;
  seat: SeatOrPlatform;
  icon: string;
  /** The public URL. Unique across the registry; also the panel route. */
  marketingHref: string;
  /** The in-app destination this explainer is about. */
  appHref: string;
  /** A domain sells to a buyer; a foundation is substrate every domain needs;
   *  a link is neither — a page the public menus and footer point at. */
  kind: 'domain' | 'foundation' | 'link';
  placement: Placement;
  /** Signed in, this route opens as a panel over the board instead of replacing it. */
  panel: boolean;
  /**
   * The `NAV_GROUPS` row this page is the public FACE of, when it is one.
   *
   * Declared rather than inferred from `appHref`, because inference is ambiguous
   * exactly where it matters: `/product-management` and `/survival-focused-agile`
   * both hand off into `/projects`, and picking whichever matched first would
   * decide, silently and arbitrarily, which of them the Product menu links
   * "Projects" to. Two rows may not claim the same group — `check-destinations`
   * asserts it.
   */
  groupId?: string;
  /** The panel's index rail, when the page declares matching anchor ids. */
  sections?: ReferenceSection[];
}

/** Kept as an alias: a reference destination is a public one that explains a domain. */
export type ReferenceDestination = PublicDestination;



/**
 * The public explainer surfaces (§11.4.5) — the twelve rows that used to live in
 * `burnrateCatalog.ts` as a SECOND navigation list, plus the two standalone
 * reference pages.
 *
 * They are not left-panel rows. The marketing header's Product ▾ / Learn ▾ menus
 * and `/features` render them; signed in, opening one mounts it as a panel over
 * the board. `appHref` is where the explainer hands you when you are convinced —
 * and it deliberately points at a row above, so a marketing page can never
 * advertise a destination the product does not have.
 */
export const PUBLIC_DESTINATIONS: PublicDestination[] = [
  // ── Product ▾ · IDEA ─────────────────────────────────────────────────────
  // The canvas is the first row of the public menu for the same reason it is the
  // first row of the rail: it IS the product. `/create/new` is a guest app route
  // (`GUEST_APP_PATTERNS`), so this link opens a real, editable, local-first
  // board — which is why it is not a `panel` row. There is nothing to open it
  // over; it is the thing everything else opens over.
  { id: 'canvas', seat: 'Brain', icon: '✦', marketingHref: '/create/new', appHref: '/create', kind: 'link', placement: 'idea', panel: false, groupId: 'create' },
  { id: 'ref.aiCoach', copyId: 'aiCoach', seat: 'Brain', icon: '✨', marketingHref: '/features/ai-coach', appHref: '/create', kind: 'foundation', placement: 'idea', panel: true },
  // ── Product ▾ · MAKE ─────────────────────────────────────────────────────
  { id: 'ref.productManagement', copyId: 'productManagement', seat: 'CPO', icon: '📦', marketingHref: '/product-management', appHref: '/projects?tab=pm', kind: 'domain', placement: 'make', panel: true, groupId: 'projects' },
  { id: 'ref.agileSurvival', copyId: 'agileSurvival', seat: 'CTO', icon: '⚡', marketingHref: '/survival-focused-agile', appHref: '/projects?tab=ceremonies', kind: 'domain', placement: 'make', panel: true },
  // ── Product ▾ · RUN — one row per business seat ──────────────────────────
  { id: 'ref.businessIntelligence', copyId: 'businessIntelligence', seat: 'CFO', icon: '📊', marketingHref: '/business-intelligence', appHref: '/seat/finance', kind: 'domain', placement: 'run', panel: true, groupId: 'finance' },
  { id: 'ref.salesRevenue', copyId: 'salesRevenue', seat: 'CRO', icon: '📈', marketingHref: '/sales-revenue', appHref: '/seat/revenue', kind: 'domain', placement: 'run', panel: true, groupId: 'revenue' },
  { id: 'ref.marketingGrowth', copyId: 'marketingGrowth', seat: 'CMO', icon: '📣', marketingHref: '/marketing-growth', appHref: '/growth', kind: 'domain', placement: 'run', panel: true, groupId: 'growth' },
  { id: 'ref.operationalCadence', copyId: 'operationalCadence', seat: 'HR', icon: '🎯', marketingHref: '/operational-cadence', appHref: '/seat/people', kind: 'domain', placement: 'run', panel: true, groupId: 'people' },
  { id: 'ref.investorIntelligence', copyId: 'investorIntelligence', seat: 'CEO', icon: '💼', marketingHref: '/investor-intelligence', appHref: '/seat/investor', kind: 'domain', placement: 'run', panel: true, groupId: 'investor' },
  { id: 'ref.governanceSecurity', copyId: 'governanceSecurity', seat: 'Security', icon: '🛡', marketingHref: '/governance-security', appHref: '/seat/governance', kind: 'domain', placement: 'run', panel: true, groupId: 'governance' },
  { id: 'ref.customerEngagement', copyId: 'customerEngagement', seat: 'Support', icon: '💬', marketingHref: '/customer-engagement', appHref: '/seat/support', kind: 'domain', placement: 'run', panel: true, groupId: 'support' },
  { id: 'ref.companiesContacts', copyId: 'companiesContacts', seat: 'CMO', icon: '🏢', marketingHref: '/companies-contacts', appHref: '/seat/revenue', kind: 'foundation', placement: 'run', panel: true },
  // ── Learn ▾ · READ — long-form, and deliberately NOT panels: an article
  //    wants the whole screen, and nobody reads a tutorial over their own board.
  { id: 'blog', seat: 'CMO', icon: '📝', marketingHref: '/blog', appHref: '/blog', kind: 'link', placement: 'read', panel: false },
  { id: 'tutorials', seat: 'Support', icon: '🎓', marketingHref: '/tutorials', appHref: '/tutorials', kind: 'link', placement: 'read', panel: false },
  { id: 'compare', seat: 'CMO', icon: '⚖️', marketingHref: '/compare', appHref: '/compare', kind: 'link', placement: 'read', panel: false },
  // ── Learn ▾ · PROVE — evidence surfaces. These ARE panels: "can I show my
  //    auditor the controls" is a question you ask mid-turn, not instead of one.
  { id: 'diagnostics', seat: 'Manager', icon: '🩺', marketingHref: '/tools', appHref: '/insights/compliance', kind: 'link', placement: 'prove', panel: true },
  {
    id: 'soc2', seat: 'Security', icon: '🛡', marketingHref: '/soc2', appHref: '/seat/governance',
    kind: 'link', placement: 'prove', panel: true,
    // The page's own `<section id>`s, offered as the panel's index rail. Declared
    // beside the destination rather than inside the page so the rail cannot list
    // a section the page stopped having — `check-destinations` asserts the ids.
    sections: [
      { id: 'report', labelKey: 'report' },
      { id: 'criteria', labelKey: 'criteria' },
      { id: 'how', labelKey: 'how' },
      { id: 'audits', labelKey: 'audits' },
      { id: 'faq', labelKey: 'faq' },
    ],
  },
  { id: 'evermind', seat: 'Brain', icon: '🧠', marketingHref: '/evermind', appHref: '/create', kind: 'link', placement: 'prove', panel: true },
  // ── Learn ▾ · BUILD WITH ─────────────────────────────────────────────────
  { id: 'ref.integrations', copyId: 'integrations', seat: 'CTO', icon: '🔌', marketingHref: '/integrations', appHref: '/settings/integrations', kind: 'foundation', placement: 'buildWith', panel: true },
  // `/models` and `/prompts` are not panels: signed in they are already app
  // surfaces (Marketplace's asset family and Knowledge's Prompts tab), and a
  // route cannot be both a panel over the board and a destination in it.
  { id: 'models', seat: 'CTO', icon: '🧮', marketingHref: '/models', appHref: '/marketplace?family=asset&kind=model', kind: 'link', placement: 'buildWith', panel: false },
  { id: 'prompts', seat: 'Support', icon: '📚', marketingHref: '/prompts', appHref: '/prompts', kind: 'link', placement: 'buildWith', panel: false },
  // ── The flat bar ─────────────────────────────────────────────────────────
  { id: 'features', seat: 'platform', icon: '✨', marketingHref: '/features', appHref: '/create', kind: 'link', placement: 'bar', panel: true },
  // Talent, agents, models and assets are FAMILIES of the one storefront, not
  // four destinations — so one entry, and the families filter inside it. It is
  // "Marketplace" here, in the footer and in the rail: one place, one name.
  { id: 'marketplace', seat: 'platform', icon: '🛒', marketingHref: '/marketplace', appHref: '/marketplace', kind: 'link', placement: 'bar', panel: false },
  { id: 'pricing', seat: 'CFO', icon: '💳', marketingHref: '/pricing', appHref: '/pricing', kind: 'link', placement: 'bar', panel: false },
  { id: 'about', seat: 'CEO', icon: '🏛', marketingHref: '/about', appHref: '/about', kind: 'link', placement: 'bar', panel: false },
  // ── Footer only ──────────────────────────────────────────────────────────
  { id: 'demo', seat: 'CRO', icon: '▶', marketingHref: '/demo', appHref: '/create', kind: 'link', placement: 'account', panel: false },
  { id: 'sell', seat: 'CRO', icon: '🤝', marketingHref: '/sell-builderforce', appHref: '/sales', kind: 'link', placement: 'account', panel: false },
  { id: 'media', seat: 'CMO', icon: '🗂', marketingHref: '/media', appHref: '/media', kind: 'link', placement: 'account', panel: false },
  { id: 'signIn', seat: 'platform', icon: '🔑', marketingHref: '/login', appHref: '/create', kind: 'link', placement: 'account', panel: false },
];

/**
 * The explainer subset — the rows `/features` indexes. A `link` row is a public
 * page but not a story about a business domain, so it belongs in the menus and
 * the footer and not in the features index.
 */
export type ExplainerDestination = PublicDestination & { copyId: string };

export const REFERENCE_DESTINATIONS = PUBLIC_DESTINATIONS.filter(
  (entry): entry is ExplainerDestination => entry.kind !== 'link',
);
export const REFERENCE_DOMAINS = REFERENCE_DESTINATIONS.filter((entry) => entry.kind === 'domain');
export const REFERENCE_FOUNDATIONS = REFERENCE_DESTINATIONS.filter((entry) => entry.kind === 'foundation');

/** Public rows that mount as a panel over the board once you are signed in. */
export const PANEL_SURFACES = PUBLIC_DESTINATIONS.filter((entry) => entry.panel).map((entry) => entry.marketingHref);

export function publicById(id: string): PublicDestination | undefined {
  return PUBLIC_DESTINATIONS.find((entry) => entry.id === id);
}

/**
 * An EXPLAINER by its public href. Deliberately narrower than
 * `publicDestinationFor`: the domain-page route feeds the result straight into
 * `burnrateMarketing.domains.<copyId>`, so returning `/blog` here would render a
 * page of `domains.undefined`.
 */
export function referenceByHref(href: string): ExplainerDestination | undefined {
  return REFERENCE_DESTINATIONS.find((entry) => entry.marketingHref === href);
}

export function referenceBySlug(slug: string): ExplainerDestination | undefined {
  return referenceByHref(`/${slug}`);
}

/** The row a pathname belongs to, longest public href first (`/features/ai-coach`
 *  must beat `/features`). */
export function publicDestinationFor(pathname: string): PublicDestination | undefined {
  let best: PublicDestination | undefined;
  for (const entry of PUBLIC_DESTINATIONS) {
    const href = entry.marketingHref;
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (!best || href.length > best.marketingHref.length) best = entry;
  }
  return best;
}

/** The rows of one menu column, in declaration order. */
export function columnOf(column: Placement): PublicDestination[] {
  return PUBLIC_DESTINATIONS.filter((entry) => entry.placement === column);
}

/**
 * The stages the public Product ▾ menu shows.
 *
 * Idea → Make → Run → Measure: the same arc, in the same order, as the left
 * panel. Market and Admin are left out on purpose — the storefront has its own
 * top-level link and nobody browses a product's settings before signing up.
 */
export const PRODUCT_STAGES = ['idea', 'make', 'run', 'measure'] as const;

/**
 * One row of the public Product menu — a RAIL destination, wearing whichever
 * public face it has.
 *
 * The menu was a projection of the twelve explainer pages, and the explainers do
 * not line up with the product: it advertised "Business Intelligence" for the row
 * the app calls Finance, and it had no row at all for Quality, Embedded,
 * Reliability, Knowledge or Insights, because none of those has a marketing page.
 * Somebody who read the menu and then signed up found a different product.
 *
 * So the menu reads `NAV_GROUPS` — the rail itself — and a destination's public
 * face is only its LINK and its one-line description:
 *
 *   - `href` is the explainer when one is bound to this row (`groupId`), so
 *     Finance still sells itself with `/business-intelligence`; otherwise it is
 *     the app route, which a signed-out visitor meets as its route teaser.
 *   - `titleKey` is always the rail's own label. One name for one place, in the
 *     menu and in the product.
 */
export interface PublicFace {
  group: NavGroup;
  href: string;
  /** i18n key under `nav` — the destination's own name. */
  titleKey: string;
  /** Full-path i18n key for the one-liner under it. */
  taglineKey: string;
}

export function publicFaceOf(group: NavGroup): PublicFace {
  const face = PUBLIC_DESTINATIONS.find((entry) => entry.groupId === group.id);
  return {
    group,
    href: face?.marketingHref ?? group.href,
    titleKey: group.labelKey,
    // A bound explainer already owns a translated tagline in all five catalogs;
    // a row without one keeps its own under `marketingNav.tagline.<id>`.
    taglineKey: face ? destTaglineKey(face) : `marketingNav.tagline.${group.id}`,
  };
}

/** The Product menu's rows for one stage. */
export function productFacesFor(stage: Stage): PublicFace[] {
  return groupsForStage(NAV_GROUPS, stage)
    // Superadmin surfaces are not a public offer.
    .filter((group) => !group.superadminOnly)
    .map(publicFaceOf);
}

/**
 * Where a row's title and one-line tagline live.
 *
 * Two homes rather than one because the nine domain explainers already own
 * translated copy under `burnrateMarketing.domains.*` in all five catalogs, and
 * re-keying it would have been a rename dressed up as a refactor. A row without
 * a `copyId` keys its own copy under `marketingNav.dest.<id>`.
 */
export function destTitleKey(entry: PublicDestination): string {
  return entry.copyId ? `burnrateMarketing.domains.${entry.copyId}.title` : `marketingNav.dest.${entry.id}.title`;
}

export function destTaglineKey(entry: PublicDestination): string {
  return entry.copyId ? `burnrateMarketing.domains.${entry.copyId}.tagline` : `marketingNav.dest.${entry.id}.tagline`;
}

/**
 * The site footer, as four projections of the array above (§11.4.7).
 *
 * Ids rather than rows so the ORDER a reader sees is editable without a second
 * declaration of the destination itself. The previous footer was that second
 * declaration: it called the storefront "Workforce Registry" and still offered
 * an `/agents` destination that had been folded into it.
 */
export interface FooterColumn {
  /** i18n key under `footer`. */
  titleKey: string;
  ids: string[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  { titleKey: 'colProduct', ids: ['canvas', 'marketplace', 'features', 'pricing', 'about'] },
  { titleKey: 'colPlatform', ids: ['evermind', 'ref.integrations', 'models', 'prompts'] },
  { titleKey: 'colLearn', ids: ['blog', 'tutorials', 'compare', 'diagnostics', 'soc2', 'media'] },
  { titleKey: 'colGetStarted', ids: ['demo', 'sell', 'signIn'] },
];

/** The footer's columns resolved to rows — unknown ids are a build-time failure
 *  in `check-destinations`, so this can drop them without hiding a typo. */
export const footerColumns = (): { titleKey: string; links: PublicDestination[] }[] =>
  FOOTER_COLUMNS.map((column) => ({
    titleKey: column.titleKey,
    links: column.ids.map(publicById).filter((entry): entry is PublicDestination => Boolean(entry)),
  }));

/**
 * The PUBLIC bar — the marketing header's flat links (§11.4.6).
 *
 * A projection of `PUBLIC_DESTINATIONS`, not a list: it was a list, living in
 * the header component as `FLAT_LINKS`, and that is how the storefront ended up
 * with three names. There is no `Home` row either — the logo is home, and a
 * separate entry was the second way to do the one thing every logo does.
 */
export const PUBLIC_NAV = columnOf('bar');
