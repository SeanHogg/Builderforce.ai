/**
 * The EXTENSION CONTRACT — what a published package may be, and what it may ask
 * for. Pure data and pure functions; no database, no HTTP.
 *
 * This module is the open/closed seam for PRD 24. Adding `canvas_kind` to the
 * platform means adding a row to `EXTENSION_KINDS` and a branch to the ONE spec
 * validator — not a table, not a service, not a route. That is the same argument
 * `discipline` makes on `field_jobs` and `builtin_kind` makes on `ide_agents`,
 * applied to the marketplace.
 *
 * ── SCOPES ARE THE SECURITY BOUNDARY ────────────────────────────────────────
 * An install grants exactly the scopes an admin approved, and `requireScope` (the
 * strict form) decides every call — an empty grant grants nothing here, unlike
 * the legacy tenant-key path where an empty list means "minted before scopes
 * existed". A new credential has no legacy to accommodate, so it gets the strict
 * rule from day one.
 */

import { requireScope, widenedScopes } from '../shared/scopeList';

// ─────────────────────────────────────────────────────────────────────────────
// Kinds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a package IS. A column value on `extension_packages`, never a table.
 *
 * Ordered by what ships when: the first four are Phase 1 and 2 (PRD 24 §7), and
 * `seat_pack` is declared here rather than added later because the validator
 * below must fail closed on a kind it does not know how to check — a kind that
 * exists in the enum but has no spec validator is refused, which is the safe
 * direction.
 */
export const EXTENSION_KINDS = [
  'connector',
  'mcp_server',
  'canvas_kind',
  'agent',
  'skill',
  'template',
  'seat_pack',
] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export function isExtensionKind(v: unknown): v is ExtensionKind {
  return typeof v === 'string' && (EXTENSION_KINDS as readonly string[]).includes(v);
}

/** Kinds a publisher may actually submit today. The rest are declared, not open. */
export const SUBMITTABLE_KINDS: readonly ExtensionKind[] = ['connector', 'mcp_server'];

// ─────────────────────────────────────────────────────────────────────────────
// Listing / review / verification vocabularies
// ─────────────────────────────────────────────────────────────────────────────

export const LISTING_STATES = ['draft', 'listed', 'delisted'] as const;
export type ListingState = (typeof LISTING_STATES)[number];

export const REVIEW_STATES = ['pending', 'approved', 'rejected'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * A workspace's PUBLISHER state, in ascending order of trust.
 *
 * One scale, not two facts. `'none'` — the default for every workspace — means
 * this tenant does not publish; the rest are its trust tier once it does.
 * Splitting "is a publisher" from "how verified" into two columns would permit the
 * one combination nobody wants (not a publisher, yet identity-verified), and would
 * put the same question in two places for a reader to reconcile.
 *
 * `identity_verified` is what gates charging money (PRD 24 §9). The ORDER matters
 * and is expressed by the array index, so a caller asks "at least this tier?"
 * rather than enumerating states — one comparison that cannot drift from the list.
 *
 * Stored on `tenants.publisher_state` (migration 0472). Before that it was
 * `developer_orgs.verification_state`, on a party model that no longer exists:
 * a developer is a tenant.
 */
export const PUBLISHER_STATES = ['none', 'unverified', 'domain_verified', 'identity_verified'] as const;
export type PublisherState = (typeof PUBLISHER_STATES)[number];

export function isPublisherState(v: unknown): v is PublisherState {
  return typeof v === 'string' && (PUBLISHER_STATES as readonly string[]).includes(v);
}

/** Does this workspace publish at all? The one place `'none'` is interpreted. */
export function publishes(state: string): boolean {
  return isPublisherState(state) && state !== 'none';
}

/** True when `state` is at or above `minimum` in the trust order. */
export function meetsVerification(
  state: string,
  minimum: PublisherState,
): boolean {
  const have = PUBLISHER_STATES.indexOf(state as PublisherState);
  const need = PUBLISHER_STATES.indexOf(minimum);
  return have >= 0 && have >= need;
}

/**
 * MAY THIS PUBLISHER TAKE MONEY? — PRD 24 §9 decision 2, answered once.
 *
 * The question is asked in two places that must never disagree: when a price is
 * SET (`extensionPlans.setPackagePlans`, which refuses before a price is ever
 * advertised) and when a version is REVIEWED (`packageReview`'s
 * `paid_requires_identity`, which refuses before it can be installed). Two gates
 * deriving the same answer is exactly the shape CONTRIBUTING §1 describes: they
 * will diverge, and the one that is wider is the one that keeps letting people
 * through. So there is one predicate and both call it.
 *
 * The shipped answer is the PRD's recommendation — identity verification gates
 * charging. Changing it is this one line, and both gates move together.
 */
export function mayCharge(state: string): boolean {
  return meetsVerification(state, 'identity_verified');
}

/**
 * Authority over a publisher is authority over its WORKSPACE — see
 * `application/tenant/tenantRoles.ts`. There is deliberately no role ladder here:
 * this context had its own three-value one (`owner`/`admin`/`publisher`) beside
 * the tenant's four-value one, so "may this person ship a version?" had two
 * answers that were free to disagree. Migration 0472 kept the ladder that already
 * governed everything else.
 *
 *   ship a version, create a package  → at least `developer`
 *   list / delist, claim a domain     → at least `manager`
 */

// ─────────────────────────────────────────────────────────────────────────────
// Scopes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an extension may ask a tenant for.
 *
 * Deliberately COARSE and deliberately short. A scope list a human cannot read at
 * install time is a consent screen nobody reads, and the whole point of showing
 * the diff on a version bump is that the reader can tell what changed. Each entry
 * names a capability the runtime actually gates, not a table.
 */
export const EXTENSION_SCOPES = [
  'tools:call',        // its actions are advertised to agents and may be invoked
  'read:projects',     // read project + ticket metadata
  'write:tickets',     // create and update tickets
  'read:canvas',       // read boards and their objects
  'write:canvas',      // add or update canvas objects
  'read:insights',     // read aggregate metrics (never per-person rows)
  'notify:members',    // send a notification to workspace members
] as const;
export type ExtensionScope = (typeof EXTENSION_SCOPES)[number];

export function isExtensionScope(v: unknown): v is ExtensionScope {
  return typeof v === 'string' && (EXTENSION_SCOPES as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans — the paid half (PRD 24 §5.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How often a plan recurs. Two values, matching what the payment port offers — a
 * third would be a plan nobody could be charged for.
 */
export const PLAN_INTERVALS = ['month', 'year'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/**
 * ONE PLAN a tenant can pick on a paid listing.
 *
 * ── WHY A PLAN IS NOT A TABLE ───────────────────────────────────────────────
 * A plan has no lifecycle of its own. It is not ordered, not installed, not
 * reviewed and not versioned independently — it is a line in the PRICE LIST of
 * exactly one `catalog_items` row, and PRD 24 §5.2 is explicit that a package
 * listing "does not get its own price column, its own order table, or its own
 * payout path". So the plan list lives in that row's `body`, which is the column
 * the kernel put there for a catalogue entry's own payload, and the money it
 * produces is `orders` + `order_line_items` + `ledger_entries` exactly as every
 * other sale on this platform.
 *
 * What IS stored per install is which plan was picked —
 * `tenant_extension_installs.plan_code`: one column, 1:1 with the install.
 *
 * ── THE TWO PRICES, AND WHY BOTH ────────────────────────────────────────────
 * `priceCents` is the recurring subscription; `meteredRateCents` is what one unit
 * beyond `includedUnits` costs. Either may be zero. A plan with only the first is
 * a flat subscription; a plan with only the second is pure usage-based billing (a
 * $0 subscription that meters), which is the shape most infrastructure vendors
 * actually sell and the shape a marketplace that understood only flat plans would
 * force them to misrepresent.
 *
 * `unitLabel` is the vendor's word for what they meter — "document", "payroll
 * run", "lookup". It is stored rather than derived because it is the text that
 * appears on the CUSTOMER's invoice line, and an invoice that says "1,412 units"
 * is one the customer has to ring somebody about.
 */
export interface ExtensionPlan {
  /** Stable within a package. What an install stores and a checkout names. */
  code: string;
  name: string;
  description: string | null;
  /** The recurring charge. 0 for a pure usage-based plan. */
  priceCents: number;
  interval: PlanInterval;
  /** Units the recurring price already covers before metering starts. */
  includedUnits: number;
  /** What one unit beyond `includedUnits` costs. 0 = this plan does not meter. */
  meteredRateCents: number;
  /** The vendor's word for one unit — it appears on the customer's invoice. */
  unitLabel: string;
}

/** A plan code: short, lowercase, and safe in a metadata value and a URL. */
export function isPlanCode(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,46}[a-z0-9]$/.test(v);
}

/**
 * Read a plan list back out of untrusted JSON — the same discipline
 * `parseConnectorManifest` applies to a spec.
 *
 * A stored plan can outlive a contract change, and a plan that half-parses is a
 * price somebody is charged out of a field nobody validated. So every plan is
 * rebuilt field by field from primitives, and one that cannot be is DROPPED
 * rather than repaired: a listing missing a plan is visibly wrong, and a listing
 * whose plan silently costs nothing is not.
 *
 * Amounts are clamped to whole non-negative cents because a fractional or
 * negative price is not a cheaper plan — it is a refund the buyer never asked for.
 */
export function parseExtensionPlans(raw: unknown): ExtensionPlan[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExtensionPlan[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const code = typeof r.code === 'string' ? r.code.trim().toLowerCase() : '';
    if (!isPlanCode(code) || seen.has(code)) continue;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    const plan: ExtensionPlan = {
      code,
      name: name.slice(0, 80),
      description: typeof r.description === 'string' && r.description.trim()
        ? r.description.trim().slice(0, 400)
        : null,
      priceCents: wholeNonNegative(r.priceCents),
      interval: r.interval === 'year' ? 'year' : 'month',
      includedUnits: wholeNonNegative(r.includedUnits),
      meteredRateCents: wholeNonNegative(r.meteredRateCents),
      unitLabel: (typeof r.unitLabel === 'string' && r.unitLabel.trim() ? r.unitLabel.trim() : 'unit').slice(0, 40),
    };
    // A plan that charges nothing either way is not a plan — it is the free
    // listing the package already is, and offering it as one would put a checkout
    // button in front of a tenant that takes no money and grants exactly what
    // pressing Install would have granted.
    if (plan.priceCents === 0 && plan.meteredRateCents === 0) continue;
    seen.add(code);
    out.push(plan);
  }
  return out;
}

/** A non-negative whole number of cents (or units). Anything else reads as 0. */
function wholeNonNegative(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 100_000_000);
}

/** Does this plan bill by usage at all? The one place that question is decided. */
export function planMeters(plan: ExtensionPlan): boolean {
  return plan.meteredRateCents > 0;
}

/**
 * What a period's metered units cost on this plan.
 *
 * Pure, because it is both the number a customer is charged and the number a
 * vendor is paid from, and those two have to be computed once. `includedUnits` is
 * subtracted BEFORE pricing rather than after, which is the only reading of
 * "included" a customer would accept.
 */
export function meteredChargeCents(plan: ExtensionPlan, units: number): number {
  if (!planMeters(plan)) return 0;
  const billable = Math.max(0, Math.floor(units) - plan.includedUnits);
  return billable * plan.meteredRateCents;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An install's standing with the money, on ONE ordered vocabulary.
 *
 * `none` is the default and means what it says: this install is of a free
 * package, or of a paid one on no plan. It is a value on the install rather than
 * a second table for the same reason `publisher_state` is a value on the tenant —
 * it is 1:1 with the row it describes, and an `extension_subscriptions` table
 * would be a second answer to "is this install paid for".
 *
 * `past_due` is kept apart from `cancelled` because the tenant's extension keeps
 * working through a failed renewal: switching somebody's payroll integration off
 * the hour their card expired loses the marketplace the customer AND the vendor.
 * `cancelled` rows are kept — they are the record that somebody used to pay.
 */
export const INSTALL_SUBSCRIPTION_STATES = ['none', 'active', 'past_due', 'cancelled'] as const;
export type InstallSubscriptionState = (typeof INSTALL_SUBSCRIPTION_STATES)[number];

export function isInstallSubscriptionState(v: unknown): v is InstallSubscriptionState {
  return typeof v === 'string' && (INSTALL_SUBSCRIPTION_STATES as readonly string[]).includes(v);
}

/** May this install still call, and still be metered? `past_due` deliberately may. */
export function subscriptionEntitles(state: string): boolean {
  return state === 'active' || state === 'past_due';
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner tracks (PRD 24 §6 Phase C)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHICH PROGRAM a publisher is in, if any.
 *
 * Lovable runs two tracks and the split is the point (§2.1): a technology partner
 * wants distribution and co-marketing, an agency wants LEADS. They are one column
 * rather than two booleans because a publisher is in at most one — a vendor who is
 * also an agency is two workspaces, which is the same answer §5.1 gives to every
 * "but what if they are also an X" question on this platform.
 *
 * `none` is self-serve (§6 Phase B): open registration, 0% rev-share, no
 * application. It is the DEFAULT and it is not a lesser state — most publishers
 * should never need to be in a program at all.
 */
export const PARTNER_TRACKS = ['none', 'technology', 'solutions'] as const;
export type PartnerTrack = (typeof PARTNER_TRACKS)[number];

export function isPartnerTrack(v: unknown): v is PartnerTrack {
  return typeof v === 'string' && (PARTNER_TRACKS as readonly string[]).includes(v);
}

/**
 * Scopes that need a named human decision, not just an admin click.
 *
 * A write scope changes the customer's data; a read scope does not. The install
 * UI separates them for that reason, and the review pipeline treats a version
 * that adds one as never auto-updatable.
 */
export const SENSITIVE_SCOPES: readonly ExtensionScope[] = [
  'write:tickets',
  'write:canvas',
  'notify:members',
];

/** Does an install's grant permit `required`? Strict: an empty grant permits nothing. */
export function installGrants(granted: readonly string[] | null, required: ExtensionScope): boolean {
  return requireScope(granted, required);
}

/**
 * May a tenant's install move to `nextScopes` without re-prompting its admin?
 *
 * Only when nothing widened. Returning the widened list rather than a boolean is
 * what lets the caller SHOW the diff — a consent screen that says "this update
 * wants: write:canvas" is the one a person can actually answer.
 */
export function scopeUpgrade(
  granted: readonly string[] | null,
  nextScopes: readonly string[] | null,
): { auto: boolean; added: string[] } {
  const added = widenedScopes(granted, nextScopes);
  return { auto: added.length === 0, added };
}
