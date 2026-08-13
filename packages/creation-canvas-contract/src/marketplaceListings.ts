/**
 * WHAT A THING BUILT ON THE CANVAS *IS* WHEN IT GOES ON SALE.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────
 * The canvas could take an idea, make it, and run it — and then stop. A person who
 * had just built a working game, a live site, a workflow or a playbook had no way to
 * say "this is a Game, others may play it, it costs $9". The marketplace had four
 * hardcoded producers (a skill form, the agent registry, knowledge listings, gigs)
 * and none of them could accept a canvas object, so the last step of "idea → real"
 * had no destination.
 *
 * The missing piece was never a screen. It was a VOCABULARY: the sentence "this
 * thing I built is an X" needs a closed set of X, and each X has to answer one more
 * question before a stranger can get value from it — HOW DO THEY RUN IT. A game is
 * played, a site is opened, a workflow is installed, a dashboard is previewed, a
 * diagnostic is run. That answer is the whole difference between a marketplace of
 * screenshots and a marketplace of working things.
 *
 * So a listing kind is SPEC DATA here, exactly as canvas object kinds are spec data
 * in `specObjects.ts` and connector vendors are manifest rows (migration 0410).
 * Adding "this is also sellable" is ONE entry plus its i18n keys — never a render
 * branch, never a column, never a table. Both the API and the web app import this
 * module, so the seller's choices, the buyer's launch button and the server's
 * validation cannot drift.
 *
 * ── THE TWO FLAGS THAT CARRY THE RULES ───────────────────────────────────────────
 *  - `launch` decides what a buyer's primary button DOES. It is closed on purpose:
 *    five verbs, each with one implementation, rather than a per-kind bespoke
 *    runner that turns into thirty.
 *  - `trial` decides what a NON-buyer may do before paying. `full` means the thing
 *    runs for anyone (correct for a free listing, and the reason a marketplace with
 *    playable games is worth visiting); `preview` means the snapshot renders but the
 *    runnable payload is withheld. A priced listing defaults to `preview` because
 *    the alternative is giving the product away at the URL that sells it.
 */

/** How a buyer gets value out of a listing. Five verbs, one implementation each. */
export const LISTING_LAUNCH_MODES = ['play', 'open', 'run', 'preview', 'install'] as const;
export type ListingLaunchMode = (typeof LISTING_LAUNCH_MODES)[number];

/** What a visitor who has not paid is allowed to do. */
export const LISTING_TRIAL_POLICIES = ['full', 'preview'] as const;
export type ListingTrialPolicy = (typeof LISTING_TRIAL_POLICIES)[number];

/**
 * The marketplace family a kind files under.
 *
 * The same four families the marketplace already groups its tabs by
 * (`marketplaceFamilies.ts`) — talent, companies, agents, assets — so a published
 * creation lands in the vocabulary a visitor is already filtering with rather than
 * in a new tab nobody looks at.
 */
export const LISTING_FAMILIES = ['asset', 'agent'] as const;
export type ListingFamily = (typeof LISTING_FAMILIES)[number];

export interface MarketplaceListingKindSpec {
  /** Stored in `catalog_items.kind`. Stable — it is in URLs and in sold rows. */
  readonly id: string;
  /** The buyer's primary action. */
  readonly launch: ListingLaunchMode;
  /**
   * Canvas object kinds that may become this listing.
   *
   * Empty means the kind is published from a whole SESSION rather than from one
   * object — the board itself is the product.
   */
  readonly from: readonly string[];
  readonly family: ListingFamily;
  /** May the seller charge for it? `free` exists for kinds where a price would be
   *  a lie — nothing is transferred that the buyer keeps. */
  readonly pricing: 'free' | 'either';
  /** Default trial policy for a FREE listing of this kind. A priced listing always
   *  starts at `preview`; the seller may widen it, never the other way by accident. */
  readonly trial: ListingTrialPolicy;
  /** Emoji shown on the card before the kind's icon token resolves. */
  readonly icon: string;
}

/**
 * THE SELLABLE KINDS.
 *
 * Every entry earns its place by answering "what does a stranger DO with it" with
 * something other than "look at a picture of it". A canvas kind absent from every
 * `from` list is deliberately not sellable — a `resume`, a `comment`, a `timer` and
 * a private `inbox` are not products, and listing them would only teach people that
 * the marketplace is full of things that do nothing.
 */
export const MARKETPLACE_LISTING_KINDS: readonly MarketplaceListingKindSpec[] = [
  {
    // The reason this whole seam was built: a generated game is playable the moment
    // it exists, and until now only its author could play it.
    id: 'game',
    launch: 'play',
    from: ['game'],
    family: 'asset',
    pricing: 'either',
    trial: 'full',
    icon: '🎮',
  },
  {
    // A published site already has a real URL (`publishStaticSite`). Selling it is
    // selling the source, and the URL is the demo.
    id: 'app',
    launch: 'open',
    from: ['website', 'prototype', 'build', 'project', 'service'],
    family: 'asset',
    pricing: 'either',
    trial: 'full',
    icon: '🚀',
  },
  {
    id: 'automation',
    launch: 'install',
    from: ['workflow'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '⚙️',
  },
  {
    // Agents already have a registry of their own; a canvas-authored agent joins it
    // through the same listing row rather than through a second publish path.
    id: 'agent',
    launch: 'install',
    from: ['agent', 'staff'],
    family: 'agent',
    pricing: 'either',
    trial: 'preview',
    icon: '🤖',
  },
  {
    id: 'template',
    launch: 'install',
    from: ['template', 'frame'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '🧩',
  },
  {
    // The board itself. `from: []` — a pack is published from a session, and the
    // publish panel offers it only when the whole canvas is the product.
    id: 'pack',
    launch: 'install',
    from: [],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '📦',
  },
  {
    id: 'dashboard',
    launch: 'preview',
    from: ['dashboard', 'chart', 'kpi', 'report', 'metric', 'liveMetric'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '📊',
  },
  {
    id: 'playbook',
    launch: 'preview',
    from: ['document', 'knowledge', 'prd', 'slides', 'diagram', 'roadmap', 'pitch', 'testPlan'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '📘',
  },
  {
    id: 'course',
    launch: 'run',
    from: ['course', 'practice', 'guidedTour'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '🎓',
  },
  {
    id: 'dataset',
    launch: 'preview',
    from: ['dataset', 'table', 'spreadsheet', 'datasource'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '🗂️',
  },
  {
    id: 'tool',
    launch: 'run',
    from: ['diagnostics', 'mcp', 'code', 'evaluation'],
    family: 'asset',
    pricing: 'either',
    trial: 'preview',
    icon: '🛠️',
  },
  {
    id: 'creative',
    launch: 'preview',
    from: ['image', 'video', 'animation', 'podcast', 'comic', 'model3d', 'cad', 'mockup', 'mockupSet', 'drawing'],
    family: 'asset',
    pricing: 'either',
    trial: 'full',
    icon: '🎨',
  },
] as const;

export type MarketplaceListingKind = (typeof MARKETPLACE_LISTING_KINDS)[number]['id'];

export const LISTING_KIND_IDS: readonly string[] = MARKETPLACE_LISTING_KINDS.map((spec) => spec.id);

/** Lookup by id, or null. Never throws — an id from a stored row may predate a
 *  rename, and a listing whose kind no longer exists must degrade, not 500. */
export function listingKindSpec(id: string): MarketplaceListingKindSpec | null {
  return MARKETPLACE_LISTING_KINDS.find((spec) => spec.id === id) ?? null;
}

export function isListingKind(value: unknown): value is MarketplaceListingKind {
  return typeof value === 'string' && LISTING_KIND_IDS.includes(value);
}

/**
 * Which listing kinds a given canvas object may be published as.
 *
 * Usually one; the array is the point — a `code` object is plausibly a `tool`, and
 * the day it is also a `template` that is one more entry in `from`, not a new
 * branch at the call site.
 */
export function listingKindsForObjectKind(objectKind: string): readonly MarketplaceListingKindSpec[] {
  return MARKETPLACE_LISTING_KINDS.filter((spec) => spec.from.includes(objectKind));
}

/** True when this canvas object can go on sale at all. The publish action reads
 *  this to decide its own visibility rather than taking a `canPublish` prop. */
export function isPublishableObjectKind(objectKind: string): boolean {
  return listingKindsForObjectKind(objectKind).length > 0;
}

/** The kinds a whole SESSION may be published as. */
export function sessionListingKinds(): readonly MarketplaceListingKindSpec[] {
  return MARKETPLACE_LISTING_KINDS.filter((spec) => spec.from.length === 0);
}

/**
 * The trial policy a listing gets, given its kind and its price.
 *
 * ONE derivation, called by the publish panel (to show the seller what buyers will
 * get) and by the server (to decide what the public launch endpoint hands out). Two
 * copies of this rule is how a paid listing ends up free at the URL that sells it.
 */
export function resolveTrialPolicy(
  kindId: string,
  priceCents: number,
  requested?: string | null,
): ListingTrialPolicy {
  const spec = listingKindSpec(kindId);
  if (priceCents > 0) {
    // A seller may deliberately give a paid thing away as a demo, but it has to be
    // said out loud — the default never does it for them.
    return requested === 'full' ? 'full' : 'preview';
  }
  if (requested === 'preview') return 'preview';
  return spec?.trial ?? 'full';
}

/** Whether a seller may put a price on this kind. */
export function allowsPricing(kindId: string): boolean {
  return listingKindSpec(kindId)?.pricing === 'either';
}
