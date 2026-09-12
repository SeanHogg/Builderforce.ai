/**
 * Entitlement — whether a caller gets the product rather than the preview. One
 * delegation to the shared contract's rule. Split out of `../creationListings.ts`,
 * which re-exports it.
 */
import { resolveListingAccess, type ListingTrialPolicy } from '@builderforce/creation-canvas-contract';

// ---------------------------------------------------------------------------
// Launch — what a visitor actually gets
// ---------------------------------------------------------------------------

/**
 * The three seller-controlled facts that decide access, and nothing else.
 *
 * A narrow interface on purpose. The full `catalog_items` row is 20 columns and
 * a JSONB body; a caller that has to hold all of it in order to ask "may this
 * person in" cannot cache the answer's inputs, and one that cannot cache them
 * reads the catalogue on every request to a public website.
 */
export interface ListingAccessFacts {
  /** `public` = on sale. Anything else is withdrawn. */
  visibility: string;
  priceCents: number | null;
  trial: ListingTrialPolicy | null;
}

/**
 * IS THIS CALLER ENTITLED TO THE PRODUCT, RATHER THAN THE PREVIEW?
 *
 * ── THE ONE RULE, AND THE ONLY COPY OF IT ────────────────────────────────────
 * `hasPaid` is the caller's own fact — a purchase on record, or a live
 * subscription. This function folds in the SELLER's: a free listing, or one
 * whose trial is `full`, is entitled for everybody, and a WITHDRAWN listing is
 * entitled for nobody who had not already bought it (withdrawing takes a thing
 * off sale; it does not repossess it).
 *
 * It is a pure function over three values precisely so that both shop windows
 * can call it. `launchListing` asks it for the marketplace listing page;
 * `application/ide/siteVisitor.ts` asks it for the creator's own address. Two
 * copies of this sentence is a paid product served free at one address, or a
 * paying customer locked out at the other — and whichever one is wrong,
 * somebody is owed something.
 *
 * ── WHY IT IS NOW A ONE-LINE DELEGATION ──────────────────────────────────────
 * Merged 2026-08-16: two lanes reached the same conclusion in the same week and
 * wrote it twice — this, and `resolveListingAccess` in the shared contract. The
 * contract's copy is the survivor because it is the one the FRONTEND can import,
 * and because it answers both halves (may they see it, do they get the product)
 * where this answers only the second. This name and this shape are kept so
 * `siteVisitor.ts` needs no edit; what it must never regain is a body of its own.
 */
export function entitledToListing(facts: ListingAccessFacts, hasPaid: boolean): boolean {
  return resolveListingAccess({
    priceCents: facts.priceCents ?? 0,
    trial: facts.trial,
    visibility: facts.visibility,
    hasLicence: hasPaid,
  }).entitled;
}
