/**
 * PUBLISHING A CANVAS CREATION TO THE MARKETPLACE.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * The canvas could take an idea, make it and run it, and then had nowhere to send
 * it. The marketplace had four hardcoded producers — `marketplace_skills` (a form),
 * `ide_agents.published`, knowledge listings, gigs — and not one of them could
 * accept a canvas object. So the person who had just built a working game could not
 * say "this is a Game, it costs $9, go and play it", and the last step of
 * "idea → real" ended at their own board.
 *
 * ── WHY THERE IS NO NEW TABLE ────────────────────────────────────────────────────
 * `catalog_items` (kernel.ts) was written for exactly this and had no real consumer:
 * "every marketplace listing, template, pack and offering is a `catalog_items` row
 * with a kind". Adding `creation_listings` beside it would have been the twenty-
 * fourth intra-product duplicate the data-model analysis found, created knowingly.
 * The listing KIND is a column value from the shared contract, so a new sellable
 * thing is one registry entry — not DDL and not a branch here.
 *
 * ── THE THREE ROWS A PUBLISH WRITES, AND WHY EACH IS SEPARATE ────────────────────
 *  1. `objects` — the listing joins the registry, so activity, shares, annotations
 *     and members work on it for free and its id is a real foreign key.
 *  2. `snapshots` — an IMMUTABLE copy of what was published. This is the load-
 *     bearing one: buyers must never be served the seller's live object. Without it,
 *     editing a card on your board silently changes what a stranger already paid
 *     for, and "unpublish" would not be able to stop it because there would be
 *     nothing else to serve.
 *  3. `catalog_items` — the listing itself: price, visibility, slug, install count.
 *
 * Re-publishing takes a NEW snapshot and bumps the version. The old snapshot stays,
 * because someone bought it.
 */
//
// ── WHERE IT LIVES ──────────────────────────────────────────────────────────────
// One module per concern under `./listings/`, bottom-up:
//   cache       — the browse version token, per-slug and per-snapshot keys
//   model       — the shared shapes, `ListingError`, the row → view projection
//   entitlement — the one "product or preview" rule (a contract delegation)
//   source      — reading the seller's board: candidates and the stripped payload
//   target      — what publish and stage both establish; slug claim; row writer
//   publish     — the gated publish, and withdrawal
//   browse      — the public feed, one public listing, the seller's own view
//   launch      — launch, the published snapshot, install, the install counter
// This module is the stable import path; it re-exports each public name.

export { LISTINGS_VERSION_KEY, invalidateListingCaches } from './listings/cache';
export {
  ListingError,
  type CreationListingView,
  type ListingBody,
  type ListingSnapshotPayload,
  type PublishCandidate,
  type PublishInput,
} from './listings/model';
export { entitledToListing, type ListingAccessFacts } from './listings/entitlement';
export { buildSnapshotPayload, publishCandidates } from './listings/source';
export { resolveListingTarget, writeListingRow, type ListingTarget } from './listings/target';
export {
  bumpVersion,
  publishCreationListing,
  stagedPayload,
  unpublishCreationListing,
} from './listings/publish';
export {
  browseCreationListings,
  getPublicListing,
  sellerListings,
  type BrowseQuery,
} from './listings/browse';
export {
  installListingIntoCanvas,
  launchListing,
  launchPayloadFor,
  publishedSnapshot,
  recordInstall,
  resolveListingBySlug,
  type LaunchPayload,
} from './listings/launch';
