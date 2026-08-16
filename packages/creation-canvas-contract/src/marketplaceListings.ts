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

/**
 * HOW A CREATION IS EXERCISED BEFORE ANYONE PAYS FOR IT.
 *
 * ── WHY SIX, AND WHY NOT ONE PER KIND ────────────────────────────────────────────
 * `launch` answers "what does a buyer DO with it". It does not answer "how do we
 * find out whether it works for them", and those are different questions with
 * different answers: a game and an app both `play`/`open` for a buyer, and both have
 * to be exercised the same way — booted in a sandbox and driven. A book and a comic
 * launch as `preview` and both need the same three things asked of them: does every
 * page have content, does it reflow, does it hold at print resolution.
 *
 * So the harness follows the SHAPE OF THE OUTPUT, not the noun. Counting the shapes
 * across everything the platform can make — canvas creations and studio media kinds
 * together — there are six. Thirty-odd sellable things, six runners.
 *
 *  - `media`      time-based output. Play it through and measure it: does the render
 *                 finish, is it loud enough, do the captions cover it.
 *  - `runtime`    executable output. Boot it in a sandbox and drive it: no console
 *                 errors, no outbound requests, works without a keyboard.
 *  - `paged`      fixed-page output. Read it, reflow it, proof it: no empty pages,
 *                 alt text present, resolution holds at final size.
 *  - `geometry`   dimensioned output. Can it actually be made: manifold, wall
 *                 thickness, overhangs, units declared.
 *  - `instrument`  something a person answers. Take it, then read its own results on
 *                 zero responses: stable ids, scoring, an honest empty state.
 *  - `system`     something that runs against other systems. Dry-run it with every
 *                 outbound step stubbed and every seller binding gone.
 *  - `deployment` something whose product IS the running system. Ask the ADDRESS,
 *                 not the capture.
 *
 * ── WHY THE SEVENTH IS NOT LIKE THE OTHER SIX ────────────────────────────────────
 * The first six all read the CAPTURED SNAPSHOT, because for a game, a book or a pack
 * the snapshot is what the buyer receives. That is exactly wrong for a `hosted`
 * listing: what the buyer receives is ACCESS to something the seller keeps running,
 * and the snapshot is a description of it. An app whose address 404s has a perfectly
 * well-formed snapshot, so every one of the six passes it — which is how a dead
 * service came to be sellable.
 *
 * `deployment` is therefore selected by DELIVERY rather than by output shape, and it
 * is the one runner that does I/O. See `resolveListingHarness`.
 */
export const LISTING_HARNESSES = [
  'media', 'runtime', 'paged', 'geometry', 'instrument', 'system', 'deployment',
] as const;
export type ListingHarness = (typeof LISTING_HARNESSES)[number];

/**
 * WHERE A RELEASE IS IN ITS LIFE.
 *
 * Not a column anywhere. Every state is derivable from two facts the data already
 * holds — does a snapshot exist, and is the listing pointing at it — and deriving it
 * in one place is what stops the seller's rail and the buyer's badge disagreeing.
 */
export const LISTING_RELEASE_STATES = ['draft', 'staged', 'live', 'superseded'] as const;
export type ListingReleaseState = (typeof LISTING_RELEASE_STATES)[number];

/**
 * The two `snapshots.reason` values this seam writes.
 *
 * `publication` is load-bearing beyond bookkeeping: the public read pins it, so a
 * STAGED snapshot cannot be served to a stranger by construction rather than by a
 * visibility flag somebody could get wrong. The privacy of Stage is the existing
 * security check, reused — which is also why staging must never write `publication`.
 */
export const SNAPSHOT_REASON_STAGE = 'stage';
export const SNAPSHOT_REASON_PUBLICATION = 'publication';

/** What a check found. `block` refuses the publish; `warn` is declared, not fixed. */
export const STAGE_CHECK_SEVERITIES = ['pass', 'warn', 'block'] as const;
export type StageCheckSeverity = (typeof STAGE_CHECK_SEVERITIES)[number];

/**
 * The three questions every harness asks, in the order a seller cares about them.
 *
 * Shared so the six runners cannot invent their own headings and the panel can group
 * without knowing which harness produced a row.
 */
export const STAGE_CHECK_GROUPS = ['runs', 'travels', 'sells'] as const;
export type StageCheckGroup = (typeof STAGE_CHECK_GROUPS)[number];

/** One finding. `code` is stable and is what the i18n key and any test assert on. */
export interface StageCheck {
  code: string;
  group: StageCheckGroup;
  severity: StageCheckSeverity;
  /** Already-resolved human text. The runner owns the wording; it has the numbers. */
  label: string;
  detail?: string;
}

/** What a visitor who has not paid is allowed to do. */
export const LISTING_TRIAL_POLICIES = ['full', 'preview'] as const;
export type ListingTrialPolicy = (typeof LISTING_TRIAL_POLICIES)[number];

/**
 * WHAT THE BUYER ACTUALLY RECEIVES.
 *
 * ── THE DISTINCTION THIS DRAWS ───────────────────────────────────────────────
 * `launch` says what a buyer DOES with a listing. It does not say what they GET,
 * and until this existed those two questions had one answer — which is how an
 * `app` came to be sold as a hyperlink. `siteUrl()` scraped a URL out of the
 * snapshot and handed it over, so buying an app gave you a link to the SELLER's
 * running instance: nothing provisioned, nothing isolated, and the one field
 * that could have connected the listing back to a deployable project stripped on
 * the way out (correctly — it is the seller's binding).
 *
 * Two honest shapes had been collapsed into one that was neither:
 *
 *  - `copy`   the buyer receives THE THING. It lands on a board in their own
 *             workspace, they own it, and the seller can never reach it again.
 *             This is every creative, every book, every pack — and it is why a
 *             copy purchase still needs an account: there is nowhere else to put
 *             twelve cards.
 *  - `hosted` the buyer receives ACCESS. The seller keeps running it; the buyer
 *             gets an account on that app and a subscription. No workspace, no
 *             install, and — the whole point — no second signup and no second
 *             invoice.
 *
 * ── WHY A LIST AND NOT A VALUE ───────────────────────────────────────────────
 * One listing can legitimately offer both: "use it for $4 a month, or own the
 * build for $89" is one product page with two doors, not two products. So the
 * KIND declares what it may offer and the seller picks from that set — exactly
 * how `trial` already works. A kind that lists only `copy` cannot be sold as a
 * subscription no matter what a client posts.
 */
export const LISTING_DELIVERIES = ['copy', 'hosted'] as const;
export type ListingDelivery = (typeof LISTING_DELIVERIES)[number];

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
  /**
   * How Stage exercises it, when the source object does not say otherwise.
   *
   * A DEFAULT rather than the answer, because one listing kind can carry more than
   * one output shape: `creative` legitimately covers a video (time-based), a comic
   * (paged) and a 3D model (dimensioned). `resolveListingHarness` reads the source
   * object kind first and falls back here — one derivation, called by the panel and
   * by the server, so what was tested and what was gated cannot drift.
   */
  readonly harness: ListingHarness;
  /**
   * What this kind MAY hand over, most specific first.
   *
   * Almost everything is `['copy']` — the buyer gets the thing. Only a kind that
   * is a running system can be `hosted`, because only a running system has
   * anything to give access TO. A kind offering both means one listing may open
   * two doors; the seller chooses, and `resolveDelivery` decides the effective
   * value so the panel and the server cannot disagree.
   */
  readonly deliveries: readonly ListingDelivery[];
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
    harness: 'runtime',
    deliveries: ['copy'],
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
    harness: 'runtime',
    // The only kind that IS a running system on an address somebody keeps
    // operating — so the only kind there is anything to give ACCESS to.
    deliveries: ['hosted', 'copy'],
    pricing: 'either',
    trial: 'full',
    icon: '🚀',
  },
  {
    id: 'automation',
    launch: 'install',
    from: ['workflow'],
    family: 'asset',
    harness: 'system',
    deliveries: ['copy'],
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
    harness: 'system',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '🤖',
  },
  {
    id: 'template',
    launch: 'install',
    from: ['template', 'frame'],
    family: 'asset',
    harness: 'system',
    deliveries: ['copy'],
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
    harness: 'system',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '📦',
  },
  {
    id: 'dashboard',
    launch: 'preview',
    from: ['dashboard', 'chart', 'kpi', 'report', 'metric', 'liveMetric'],
    family: 'asset',
    harness: 'system',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '📊',
  },
  {
    id: 'playbook',
    launch: 'preview',
    from: ['document', 'knowledge', 'prd', 'slides', 'diagram', 'roadmap', 'pitch', 'testPlan'],
    family: 'asset',
    harness: 'paged',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '📘',
  },
  {
    id: 'course',
    launch: 'run',
    from: ['course', 'practice', 'guidedTour'],
    family: 'asset',
    harness: 'instrument',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '🎓',
  },
  {
    id: 'dataset',
    launch: 'preview',
    from: ['dataset', 'table', 'spreadsheet', 'datasource'],
    family: 'asset',
    harness: 'system',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '🗂️',
  },
  {
    id: 'tool',
    launch: 'run',
    from: ['diagnostics', 'mcp', 'code', 'evaluation'],
    family: 'asset',
    harness: 'instrument',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '🛠️',
  },
  {
    id: 'creative',
    launch: 'preview',
    from: ['image', 'video', 'animation', 'podcast', 'comic', 'model3d', 'cad', 'mockup', 'mockupSet', 'drawing'],
    family: 'asset',
    // The kind that proved `harness` cannot be one value per listing kind: a video is
    // time-based, a comic is paged and a 3D model is dimensioned, and all three are
    // legitimately `creative`. `resolveListingHarness` reads the source object first.
    harness: 'media',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'full',
    icon: '🎨',
  },
  {
    // An INSTRUMENT, not its answers. What is sold is the questions and the scoring;
    // the responses belong to whoever runs it and are the one thing the seller must
    // never be able to read — which is why the buyer gets an empty response store and
    // the publish path strips the seller's own.
    id: 'survey',
    launch: 'run',
    from: ['form'],
    family: 'asset',
    harness: 'instrument',
    deliveries: ['copy'],
    pricing: 'either',
    // `preview` even when free: an instrument someone can read in full is one they can
    // copy, and the sample is the sales pitch.
    trial: 'preview',
    icon: '📋',
  },
  {
    // Cover, pages and figures as one product with three outputs (reader, EPUB/PDF,
    // print). Separate from `playbook` because the harness differs: a playbook is read
    // on a screen and a book has to hold at print resolution as well.
    id: 'book',
    launch: 'preview',
    from: ['book'],
    family: 'asset',
    harness: 'paged',
    deliveries: ['copy'],
    pricing: 'either',
    trial: 'preview',
    icon: '📖',
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

/** Everything this kind may hand over. Empty for an unknown kind, so a stored
 *  row whose kind was renamed degrades rather than claiming to be hosted. */
export function deliveriesForKind(kindId: string): readonly ListingDelivery[] {
  return listingKindSpec(kindId)?.deliveries ?? [];
}

/** Can this kind be sold as access to something the seller keeps running? */
export function allowsHostedDelivery(kindId: string): boolean {
  return deliveriesForKind(kindId).includes('hosted');
}

/**
 * THE DELIVERY A LISTING ACTUALLY USES.
 *
 * ONE derivation, called by the publish panel (to show the seller which doors
 * their listing opens), by the storefront (to decide what the buy button does)
 * and by the server (to decide what a purchase grants). Two copies of this rule
 * is how a listing offers a subscription for something that cannot be hosted.
 *
 * A requested value the kind does not permit falls back to the kind's FIRST
 * declared delivery rather than throwing: the request came from a client, the
 * kind list is the authority, and refusing a publish over it would be a 400 for
 * something the server can answer correctly.
 */
export function resolveDelivery(kindId: string, requested?: string | null): ListingDelivery {
  const allowed = deliveriesForKind(kindId);
  if (allowed.length === 0) return 'copy';
  const wanted = requested as ListingDelivery | null | undefined;
  return wanted && allowed.includes(wanted) ? wanted : allowed[0]!;
}

/**
 * Does a purchase of this listing need a Builderforce workspace?
 *
 * THE CONSUMER RULE, in one place. A `copy` lands twelve cards on a board, so
 * there has to be a board — that genuinely needs an account. A `hosted`
 * purchase grants access to something already running and issues a `site_user`,
 * which is a separate identity space with no workspace, no tenant membership and
 * no platform permissions. Deriving it from `delivery` rather than storing a
 * second flag is what stops the storefront and the checkout disagreeing about
 * whether somebody has to sign up.
 */
export function requiresWorkspace(delivery: ListingDelivery): boolean {
  return delivery === 'copy';
}

// ---------------------------------------------------------------------------
// The entitlement rule — ONE derivation, both shop windows
// ---------------------------------------------------------------------------

/** Why this visitor got what they got. Stable — it is an i18n key and a test
 *  assertion, not prose. */
export const LISTING_ACCESS_REASONS = ['free', 'openTrial', 'licence', 'preview', 'withdrawn'] as const;
export type ListingAccessReason = (typeof LISTING_ACCESS_REASONS)[number];

export interface ListingAccess {
  /**
   * May this caller see the listing AT ALL.
   *
   * False only for a WITHDRAWN listing seen by somebody who never bought it. A
   * withdrawn listing is not deleted — it is simply gone from the shop window, and
   * still there for the people who hold it.
   */
  visible: boolean;
  /** True for the product; false means this caller gets the bounded preview. */
  entitled: boolean;
  reason: ListingAccessReason;
}

export interface ListingAccessInput {
  priceCents: number;
  /** `full` opens the whole thing to non-buyers; `preview` withholds the payload. */
  trial?: string | null;
  /** `catalog_items.visibility`. Omitted means "not asking about the shop window". */
  visibility?: string | null;
  /**
   * Does this caller hold a live claim — a licence on a `copy`, a live subscription
   * on a `hosted` app, or the seller looking at their own staged candidate.
   *
   * A BOOLEAN and not a licence row on purpose: this module is the shared contract
   * and may not know what a licence, a subscription or a seller session is. The
   * caller answers "does this person have a claim" from its own domain and this
   * answers "so what do they get" — which is the half that must not be reimplemented.
   */
  hasLicence: boolean;
}

/**
 * WHAT THIS VISITOR GETS: the product, the preview, or nothing.
 *
 * ── WHY THIS IS A NAMED FUNCTION AND NOT THREE LINES INSIDE `launchListing` ───────
 * The marketplace listing page and the creator's own landing page are TWO SHOP
 * WINDOWS ONTO ONE PRODUCT, and a `hosted` app adds a third caller — the subscribe
 * surface, which has to answer "is this person already in" with the same rule the
 * launch endpoint uses. Three callers deriving `priceCents === 0 || trial === 'full'
 * || paid` independently is three chances for a paid product to be free at one of
 * the three URLs that sell it, and the failure is silent at the two that got it
 * right.
 *
 * So: one derivation, exported from the module both the API and the web app already
 * import, called by the launch path (`creationListings.ts`), by the landing-page
 * fork and by the subscribe surface. A second copy is the defect, not a convenience.
 *
 * The precedence is deliberate and is the whole rule:
 *   1. a claim beats everything — a withdrawn listing still runs for its holders;
 *   2. free, or a trial the seller deliberately opened, runs for anyone;
 *   3. withdrawn is invisible to everybody else;
 *   4. otherwise: the bounded preview.
 */
export function resolveListingAccess(input: ListingAccessInput): ListingAccess {
  if (input.hasLicence) return { visible: true, entitled: true, reason: 'licence' };

  // A seller may deliberately give a paid thing away as a demo; `resolveTrialPolicy`
  // is what decided that, and this only reads the decision.
  const open = (input.priceCents ?? 0) === 0 || input.trial === 'full';
  const withdrawn = input.visibility != null && input.visibility !== 'public';

  // Withdrawn beats `open`: a free listing taken off sale is off sale. Without this
  // ordering, "unpublish" would do nothing at all to anything free.
  if (withdrawn) return { visible: false, entitled: false, reason: 'withdrawn' };
  if (open) {
    return { visible: true, entitled: true, reason: (input.priceCents ?? 0) === 0 ? 'free' : 'openTrial' };
  }
  return { visible: true, entitled: false, reason: 'preview' };
}

// ---------------------------------------------------------------------------
// What happens to a HOSTED app when nobody is running it any more
// ---------------------------------------------------------------------------

/**
 * THE LIFE OF A HOSTED LISTING AFTER THE SELLER STOPS.
 *
 * ── THE QUESTION WITHDRAWAL DOES NOT ANSWER ──────────────────────────────────────
 * Withdrawing a listing takes the storefront away and leaves every existing holder
 * exactly where they were — that already falls out of the licence rule
 * (`resolveListingAccess`, precedence 1) and needs nothing new. It is the right
 * answer for a `copy`, where the buyer holds their own cards and the seller can
 * never reach them again.
 *
 * It is not an answer at all for a `hosted` app, because the buyer holds ACCESS to
 * an instance THE SELLER RUNS. Nothing about withdrawing a storefront obliges anyone
 * to keep that instance alive, and until this existed the platform had no written
 * position on what a subscriber is owed when it goes dark. "The licence outlives the
 * listing" is unenforceable when the licence is a promise about somebody else's
 * server.
 *
 * ── THE FOUR STATES ──────────────────────────────────────────────────────────────
 *   operating   the address answers. Nothing is owed beyond the subscription.
 *   grace       it stopped answering. Transient outages are the common case, so the
 *               seller gets a window, subscribers keep their subscription, and
 *               billing CONTINUES — a deploy that takes four minutes must not
 *               refund a month.
 *   readOnly    the window closed. Billing STOPS, and each subscriber may export the
 *               data they put in. The app is no longer expected to serve.
 *   released    still dark after the read-only window. The product is abandoned:
 *               every live subscriber may TAKE the published build as a `copy`, at
 *               no charge, onto a board of their own.
 *
 * ── WHY IT IS DERIVED AND NOT STORED ─────────────────────────────────────────────
 * Same reason `ListingReleaseState` is derived: the state is a function of two facts
 * the row already holds — when it was first seen dark, and what time it is now — and
 * a stored state column is a second copy that goes stale the moment a sweep does not
 * run. Deriving it here means the seller's panel, the subscriber's page and the
 * billing sweep cannot disagree about whether a month is owed.
 *
 * ── WHY THE WINDOWS ARE HERE ─────────────────────────────────────────────────────
 * They are the PROMISE, and the promise is quoted to a buyer before they subscribe
 * and to a seller before they publish. A number that lives only in a cron job is a
 * promise nobody can read.
 */
export const HOSTED_LIFECYCLE_STATES = ['operating', 'grace', 'readOnly', 'released'] as const;
export type HostedLifecycleState = (typeof HOSTED_LIFECYCLE_STATES)[number];

/** How long a dark address is treated as an outage rather than an abandonment. */
export const HOSTED_GRACE_DAYS = 14;
/** How long after that subscribers may still get their data out before the build
 *  itself is released to them. */
export const HOSTED_READ_ONLY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HostedLifecycle {
  state: HostedLifecycleState;
  /** When the clock started; null while the address is answering. */
  darkSinceISO: string | null;
  /** Whole days until the NEXT transition, or null when there is not one. */
  daysUntilNextState: number | null;
  /** May the platform still charge for this subscription this period. */
  billable: boolean;
  /** May a subscriber pull the data they put into the app. */
  subscriberMayExport: boolean;
  /** May a subscriber take the published build itself, as a `copy`, for nothing. */
  subscriberMayTake: boolean;
}

export function resolveHostedLifecycle(input: {
  /** First moment the address was observed not serving. Null = it answers. */
  unreachableSinceISO?: string | null;
  nowISO?: string;
}): HostedLifecycle {
  const dark = input.unreachableSinceISO ? Date.parse(input.unreachableSinceISO) : NaN;
  if (!Number.isFinite(dark)) {
    return {
      state: 'operating',
      darkSinceISO: null,
      daysUntilNextState: null,
      billable: true,
      subscriberMayExport: false,
      subscriberMayTake: false,
    };
  }
  const now = input.nowISO ? Date.parse(input.nowISO) : Date.now();
  const days = Math.max(0, (now - dark) / DAY_MS);
  const darkSinceISO = new Date(dark).toISOString();

  if (days < HOSTED_GRACE_DAYS) {
    return {
      state: 'grace',
      darkSinceISO,
      daysUntilNextState: Math.ceil(HOSTED_GRACE_DAYS - days),
      billable: true,
      subscriberMayExport: false,
      subscriberMayTake: false,
    };
  }
  if (days < HOSTED_GRACE_DAYS + HOSTED_READ_ONLY_DAYS) {
    return {
      state: 'readOnly',
      darkSinceISO,
      daysUntilNextState: Math.ceil(HOSTED_GRACE_DAYS + HOSTED_READ_ONLY_DAYS - days),
      // Billing stops the moment the outage stops being an outage. Charging for a
      // month of nothing is the part a subscriber would be right to call theft.
      billable: false,
      subscriberMayExport: true,
      subscriberMayTake: false,
    };
  }
  return {
    state: 'released',
    darkSinceISO,
    daysUntilNextState: null,
    billable: false,
    subscriberMayExport: true,
    // The end of the promise: nobody is running it, so the people paying for it get
    // the build. This is why the rule has to exist BEFORE the first hosted sale —
    // it is a term of that sale, not a remedy invented after one goes wrong.
    subscriberMayTake: true,
  };
}

/**
 * OBJECT KINDS WHOSE OUTPUT SHAPE OVERRIDES THEIR LISTING KIND'S DEFAULT.
 *
 * Only the kinds that genuinely disagree with their listing kind are listed. A card
 * absent from this map is exercised by its listing kind's `harness`, which is right
 * for the great majority — this map exists for `creative`, which spans three output
 * shapes, and for the handful of cards that are paged output filed under a listing
 * kind whose other members are not.
 *
 * Deliberately keyed by the CANVAS kind rather than by a per-listing override field:
 * a `video` is time-based wherever it is sold, and encoding that once is what stops
 * two listing kinds answering the question differently.
 */
const HARNESS_BY_OBJECT_KIND: Readonly<Record<string, ListingHarness>> = {
  // Time-based.
  video: 'media',
  animation: 'media',
  podcast: 'media',
  voice: 'media',
  // Fixed pages.
  comic: 'paged',
  image: 'paged',
  drawing: 'paged',
  mockup: 'paged',
  mockupSet: 'paged',
  slides: 'paged',
  book: 'paged',
  document: 'paged',
  prd: 'paged',
  pitch: 'paged',
  // Dimensioned.
  model3d: 'geometry',
  cad: 'geometry',
  // Executable.
  game: 'runtime',
  website: 'runtime',
  prototype: 'runtime',
};

/**
 * Which of the six runners exercises this creation.
 *
 * ONE derivation, called by the Stage surface (to show the seller what will be
 * checked) and by the server (to decide what actually gates the publish). Two copies
 * of this rule is how a seller is shown a print proof and gated on a loudness
 * measurement.
 *
 * A pack — published from a whole board, so no single source kind — falls to its
 * listing kind's default, which is `system`: the right question for a board is
 * whether it still stands up in an empty workspace.
 */
export function resolveListingHarness(
  kindId: string,
  objectKind?: string | null,
  /**
   * What the buyer actually receives.
   *
   * Checked FIRST, and it overrules the source kind. A `website` sold as a `copy` is
   * a runnable document and belongs to `runtime`; the same `website` sold as `hosted`
   * is an address somebody keeps operating, and asking the captured document whether
   * it works answers a question nobody is buying. The output shape is the right axis
   * for everything the buyer TAKES AWAY, and the wrong one for the single case where
   * the product stays where it is.
   *
   * Optional so the pre-publish hint — a seller choosing a kind before they have
   * chosen a delivery — keeps its existing two-argument call.
   */
  delivery?: ListingDelivery | string | null,
): ListingHarness {
  if (delivery === 'hosted') return 'deployment';
  if (objectKind) {
    const override = HARNESS_BY_OBJECT_KIND[objectKind];
    if (override) return override;
  }
  return listingKindSpec(kindId)?.harness ?? 'system';
}

/**
 * Does this set of findings refuse the publish?
 *
 * The rule is `block`, and only `block`. A warning is a fact about the buyer's
 * environment the seller should DECLARE — a 1.2mm wall, a local high score, a font
 * that may substitute — and a gate that refuses on those teaches sellers to ignore
 * the panel, which costs more than the warnings save.
 */
export function blockingChecks(checks: readonly StageCheck[]): readonly StageCheck[] {
  return checks.filter((check) => check.severity === 'block');
}

/** True when a staged release may go on sale. */
export function isPublishable(checks: readonly StageCheck[]): boolean {
  return blockingChecks(checks).length === 0;
}

/**
 * WHAT THE SELLER LEARNED IN STAGE, ON ITS WAY TO THE BUYER.
 *
 * ── THE RULE THIS ENCODES ────────────────────────────────────────────────────────
 * A limitation a seller is shown in Stage is DECLARED on the listing, not discovered
 * by the buyer. Every `warn` is by definition a fact about the buyer's environment
 * that the seller was told and chose to ship with — a font that may substitute, a
 * 1.2mm wall, a dashboard bound to nothing, the bound on what Stage itself could
 * verify. Showing those only to the seller turns the panel into a private
 * disclaimer, which is worse than not running the checks: it means the platform
 * knows and the buyer does not.
 *
 * Blockers are absent because a listing carrying one cannot be published at all.
 * So this is exactly the warnings, in the order Stage sorted them.
 */
export function declaredLimits(checks: readonly StageCheck[]): readonly StageCheck[] {
  return checks.filter((check) => check.severity === 'warn');
}

/**
 * The bound on Stage itself, stated as a finding rather than left implicit.
 *
 * ── WHAT THIS MEANT BEFORE THE STAGE SANDBOX EXISTED ─────────────────────────
 * Originally: Stage exercised only the captured snapshot and — for a hosted app —
 * the live address, because installing a snapshot into a disposable tenant and
 * driving it needed a lifecycle and a per-press cost nobody had agreed to pay.
 *
 * ── WHAT IT MEANS NOW ─────────────────────────────────────────────────────────
 * `runtime` and `media` listings ARE driven in a disposable Cloudflare Container
 * (a real headless browser, dispatched a real touch gesture, a real
 * `loadedmetadata` measurement) — see `application/marketplace/stageSandboxRuns.ts`.
 * `system` listings are dry-run in-process with every outbound call stubbed. This
 * code is unchanged (it rides `declared` on already-published listings), but its
 * WORDING is now per-harness rather than a single blanket disclaimer — see
 * `application/marketplace/stageSandboxChecks.ts`'s `notApplicableCheck`. It
 * still names a real, honest bound: `paged`/`geometry`/`instrument` listings and
 * a hosted app's address are legitimately never driven, because there is nothing
 * a sandbox adds over reading the exact copy a buyer receives (or, for an
 * address, asking it directly). Deliberately a `warn`: true of some listing on
 * the platform at all times and must never refuse a publish on its own.
 */
export const STAGE_SANDBOX_LIMIT_CODE = 'stage.sandboxLimit';

/**
 * FIELDS THAT NEVER LEAVE THE SELLER'S TENANT.
 *
 * A published snapshot is a copy of a canvas object, and a canvas object carries
 * more than its content: it carries the BINDINGS that made it work here — the
 * project it compiles in, the repository path it was captured from, the connector
 * connection it reads, the R2 key its upload lives at. None of that is the product.
 * Shipping it would hand a stranger the coordinates of the seller's own resources,
 * and in the connector case an id they can quote at an API.
 *
 * Stripped on the server at publish time, so a client that forgets is not the thing
 * standing between a seller's infrastructure and a public URL. Declared here rather
 * than in the API because the publish panel shows the seller what will be included,
 * and a preview that disagrees with the projection is worse than no preview.
 */
export const LISTING_STRIPPED_FIELDS: readonly string[] = [
  'resourceId', 'resourceType', 'resourceRevision',
  'projectId', 'sessionId', 'tenantId', 'workspaceId', 'segmentId',
  'path', 'filePath', 'repoUrl', 'repository', 'storageKey', 'r2Key',
  'connectionId', 'connectorId', 'credentialId', 'secretName', 'secrets',
  'apiKey', 'token', 'accessToken', 'refreshToken', 'webhookUrl', 'ingressToken',
  'createdBy', 'updatedBy', 'lockedBy', 'assigneeId', 'ownerUserId',
];

/** True when a snapshot key must be dropped before publication. Case-insensitive
 *  and suffix-matched, so a binding a kind renamed for itself (`gameProjectId`,
 *  `sourceRepoUrl`) is caught as the same binding rather than as a new field
 *  nobody added to the list. */
export function isStrippedListingField(key: string): boolean {
  const lower = key.toLowerCase();
  return LISTING_STRIPPED_FIELDS.some((field) => lower.endsWith(field.toLowerCase()));
}
