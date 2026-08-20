/**
 * THE PLATFORM FEE, STATED OUT LOUD.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────────
 * The platform's cut was real but invisible. `resolveTakeRateBps` decided it correctly
 * at the instant of sale, `order_line_items.commission_cents` stamped it, and a
 * `ledger_entries` row recorded it against `partner/platform` — and then nothing ever
 * said any of that to the person paying it. A seller could see a balance and could not
 * see WHAT the fee is, WHY it is that number for them, or what it was on each past
 * transaction. A fee nobody can inspect is indistinguishable from a fee nobody agreed
 * to, and it is the single most common reason a marketplace loses its supply side.
 *
 * ── WHAT THIS MODULE IS, AND WHAT IT REFUSES TO BE ───────────────────────────────
 * It is a PROJECTION, not a second calculation. Every number it returns comes from
 * `marketplace/listingCommerce.ts` — `platformTakeRateBps`, `takeRateThresholdCents`,
 * `lifetimeSellerCents`, `resolveTakeRateBps` — which is the one place the rate a buyer
 * is actually charged is decided. A second take-rate computation here would be a second
 * answer to "what does this cost", and the one that drifted would be the one shown to
 * the seller while the other one took their money.
 *
 * So this file adds exactly one thing the resolver does not have: a REASON. The
 * resolver returns `{ bps, lifetimeCents, thresholdCents, underThreshold }` — four
 * numbers a surface has to interpret. `PlatformFeeQuote` interprets them once, on the
 * server, into a named reason a surface renders and a translator translates.
 *
 * ── WHERE THE FEE APPLIES, AND WHERE IT DOES NOT ─────────────────────────────────
 * TODAY the take rate applies to CATALOGUE SALES only: `grantListing` prices it,
 * `creditSeller` writes the seller's net and the platform's cut as a pair of ledger
 * rows. An ESCROW RELEASE takes nothing — `milestones.ts` moves the whole milestone
 * amount to the freelancer and writes no commission row at all.
 *
 * That asymmetry is a real, current product fact and this module reports it rather than
 * papering over it (`appliesTo`). It is exactly the sort of thing an implicit fee model
 * hides: before there was anything to inspect, nobody could have told you whether
 * fixed-price work was charged a fee, and two different people would have guessed two
 * different answers.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  platformTakeRateBps,
  resolveTakeRateBps,
  takeRateThresholdCents,
  type ResolvedTakeRate,
} from '../marketplace/listingCommerce';

/** Every money-shaped number in this module is in this denomination. */
export const USD_CENTS = 'usd_cents';

/**
 * WHY the fee is what it is, as a code rather than a sentence — the route maps it to
 * nothing and the surface translates it, which is the same discipline `EscrowRefusal`
 * follows and the reason neither of them ships English from the server.
 */
export type PlatformFeeReason =
  /** The seller has not passed the lifetime-earnings threshold, so the rate is zero. */
  | 'under_threshold'
  /** Past the threshold: the configured rate applies. */
  | 'standard_rate'
  /** A platform-owned listing — nobody to exempt, so the configured rate applies and
   *  the platform's cut of its own listing is still recorded rather than silently 0. */
  | 'platform_listing';

/** Which kinds of money this rate is charged on. See the header. */
export type FeeSurface = 'catalogue_sale' | 'escrow_release';

/**
 * The deployment's published schedule, independent of any one seller.
 *
 * Two numbers, both read from the SAME env readers the charge path uses. A surface that
 * wants to say "15% after $200,000" reads this rather than hard-coding either half.
 */
export interface PlatformFeeSchedule {
  /** The rate a seller pays once past the threshold, in basis points. */
  configuredBps: number;
  /** Lifetime earnings a seller must pass before any fee applies. */
  thresholdCents: number;
  /** The surfaces the rate is charged on today, and the ones it is not. */
  appliesTo: readonly FeeSurface[];
}

/**
 * Which surfaces charge the take rate.
 *
 * Declared as data next to the schedule rather than as prose in a component, so that a
 * future decision to charge escrow is one edit here plus a charge-path change — and so
 * that the two can be compared. A surface listed here with no charge in the write path
 * would be a lie the schedule tells; a charge with no entry here would be a fee nobody
 * was told about.
 */
const CHARGED_SURFACES: readonly FeeSurface[] = ['catalogue_sale'];

export function feeSchedule(env: Env): PlatformFeeSchedule {
  return {
    configuredBps: platformTakeRateBps(env),
    thresholdCents: takeRateThresholdCents(env),
    appliesTo: CHARGED_SURFACES,
  };
}

/** True when this kind of money is charged the take rate today. */
export function feeAppliesTo(surface: FeeSurface): boolean {
  return CHARGED_SURFACES.includes(surface);
}

/**
 * The fee on an amount, at a rate.
 *
 * `Math.round` and not `floor`, because this is the EXACT expression `grantListing`
 * uses to price a real charge (`Math.round((priceCents * takeRateBps) / 10_000)`). A
 * quote that rounded differently from the charge would be a quote that is wrong by a
 * cent on half of all sales — small enough never to be noticed and large enough to make
 * every reconciliation fail.
 */
export function feeCentsFor(grossCents: number, bps: number): number {
  if (!Number.isFinite(grossCents) || !Number.isFinite(bps)) return 0;
  const gross = Math.max(0, Math.round(grossCents));
  const rate = Math.max(0, bps);
  return Math.round((gross * rate) / 10_000);
}

/** Basis points as a percentage number (1500 → 15). Formatting is the surface's job. */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * What a seller would pay on a sale of `grossCents`, and why.
 *
 * Every field is either copied from the resolver or derived from it by one arithmetic
 * step, so there is nothing here a reader has to trust independently.
 */
export interface PlatformFeeQuote {
  grossCents: number;
  feeBps: number;
  feeCents: number;
  netCents: number;
  reason: PlatformFeeReason;
  /** True while the platform is taking nothing — the fact a creator most wants. */
  waived: boolean;
  /** What this seller has earned so far, and what they must pass. */
  lifetimeCents: number;
  thresholdCents: number;
  /** How much more they must earn before the fee starts. 0 once past it. */
  remainingToThresholdCents: number;
  /** The rate they will pay AFTER the threshold — the number a waived quote needs in
   *  order to say what is being waived. */
  configuredBps: number;
}

/**
 * The pure half: turn a resolved rate into a quote.
 *
 * Separated from the database read for the reason `escrow.ts` separates its machine
 * from its writer — every branch, including the two that look obvious, is asserted in a
 * table test with no database anywhere near it.
 *
 * `sellerKnown` distinguishes the two ways `resolveTakeRateBps` can return a non-zero
 * rate: a seller past the threshold, and a platform-owned listing with no seller to
 * exempt. The resolver already collapses both to `underThreshold: false`, which is
 * correct for pricing and wrong for explaining — telling the owner of a platform
 * listing that they have "passed $200,000 in lifetime earnings" would be a fabrication.
 */
export function quoteFromRate(
  rate: ResolvedTakeRate,
  grossCents: number,
  options: { sellerKnown: boolean; configuredBps: number },
): PlatformFeeQuote {
  const gross = Math.max(0, Math.round(Number.isFinite(grossCents) ? grossCents : 0));
  const feeCents = feeCentsFor(gross, rate.bps);
  const reason: PlatformFeeReason = !options.sellerKnown
    ? 'platform_listing'
    : rate.underThreshold ? 'under_threshold' : 'standard_rate';
  return {
    grossCents: gross,
    feeBps: rate.bps,
    feeCents,
    netCents: Math.max(0, gross - feeCents),
    reason,
    waived: rate.bps === 0,
    lifetimeCents: rate.lifetimeCents,
    thresholdCents: rate.thresholdCents,
    remainingToThresholdCents: Math.max(0, rate.thresholdCents - rate.lifetimeCents),
    configuredBps: options.configuredBps,
  };
}

/**
 * THE QUOTE, RESOLVED AGAINST THE BOOKS.
 *
 * Deliberately NOT cached, and for the same reason `resolveTakeRateBps` is not: this is
 * the number a seller is told they will be charged, and it is one indexed SUM behind a
 * page load. A stale rate either promises a fee that is not owed or hides one that is,
 * and a seller who was quoted 0% and charged 15% has been lied to by a cache.
 *
 * `grossCents` defaults to 0 so the common call — "what is my rate right now" — does
 * not have to invent a sale to ask.
 */
export async function quotePlatformFee(
  db: Db,
  env: Env,
  seller: { tenantId: number | null; ref: string | null },
  grossCents = 0,
): Promise<PlatformFeeQuote> {
  const rate = await resolveTakeRateBps(db, env, seller);
  return quoteFromRate(rate, grossCents, {
    sellerKnown: seller.tenantId != null && !!seller.ref,
    configuredBps: platformTakeRateBps(env),
  });
}
