/**
 * Selling what you built on the canvas — `/api/creation-listings`.
 *
 * TWO ROUTERS, because they have two different auth models and mixing them is how
 * a public catalogue ends up behind a login:
 *
 *   createCreationListingRoutes  (tenant JWT)  — publish, re-publish, withdraw,
 *                                                acquire, refund, earnings, payout.
 *   createPublicListingRoutes    (no auth)     — browse, detail, launch.
 *
 * The launch endpoint is public ON PURPOSE. "Others can use, test and play the
 * thing" is the entire point of publishing, and a marketplace whose products only
 * run after a sign-up is a catalogue of screenshots. What it hands out is decided
 * by `launchListing`, which returns the preview or the product — a free listing, or
 * one whose seller opened the trial, runs for anyone; a paid one previews until the
 * caller is on record as having bought it.
 *
 * This file is a presentation adapter and holds no data access: every handler calls
 * the application layer, which owns the tables.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { resolveAppBaseUrl, type HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';
import {
  ListingError,
  browseCreationListings,
  getPublicListing,
  installListingIntoCanvas,
  launchListing,
  publishCandidates,
  publishCreationListing,
  resolveListingBySlug,
  sellerListings,
  unpublishCreationListing,
} from '../../application/marketplace/creationListings';
import {
  checksForStagedRelease,
  listReleases,
  revertListing,
  stageRelease,
} from '../../application/marketplace/creationReleases';
import {
  acquireListing,
  acquiredListings,
  completeListingCheckout,
  entitlementFromAuthHeader,
  heldLicence,
  payoutSellerBalance,
  platformTakeRateBps,
  refundListingOrder,
  sellerEarnings,
  startListingCheckout,
} from '../../application/marketplace/listingCommerce';

/** One translation of a domain error into a status, so no handler invents its own. */
function fail(c: Context<HonoEnv>, error: unknown) {
  if (error instanceof ListingError) return c.json({ error: error.message }, error.status);
  return c.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
}

export function createCreationListingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** What on this board could be sold, and as what. */
  router.get('/candidates/:sessionId', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    try {
      const candidates = await publishCandidates(db, c.get('tenantId') as number, c.req.param('sessionId'));
      return c.json({ ...candidates, takeRateBps: platformTakeRateBps(c.env) });
    } catch (error) {
      return fail(c, error);
    }
  });

  /** Publish, or re-publish in place when `listingId` is supplied. */
  router.post('/', requirePermission(PERMISSIONS.MARKETPLACE_PUBLISH), async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const listing = await publishCreationListing(db, c.env, {
        tenantId: c.get('tenantId') as number,
        userId: c.get('userId') as string,
        sessionId: String(body.sessionId ?? ''),
        objectId: typeof body.objectId === 'string' && body.objectId ? body.objectId : null,
        kind: String(body.kind ?? ''),
        name: String(body.name ?? ''),
        summary: typeof body.summary === 'string' ? body.summary : null,
        category: typeof body.category === 'string' ? body.category : null,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        priceCents: Number(body.priceCents ?? 0),
        currency: typeof body.currency === 'string' ? body.currency : 'USD',
        trial: typeof body.trial === 'string' ? body.trial : null,
        listingId: typeof body.listingId === 'string' && body.listingId ? body.listingId : null,
        // Present when the seller pressed Publish from Stage: the staged payload is
        // promoted rather than the board re-read, so the build that was checked is
        // the build that goes on sale.
        fromSnapshotId: typeof body.fromSnapshotId === 'string' && body.fromSnapshotId ? body.fromSnapshotId : null,
      });
      return c.json({ listing }, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * The release rail for one card — every version, its state, and who holds it.
   *
   * `objectId` is a query parameter rather than a path segment because a rail for
   * the WHOLE BOARD is addressed by its absence, and `/releases/:sessionId/` with a
   * trailing empty segment is not a route anybody should have to reason about.
   */
  router.get('/releases/:sessionId', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    try {
      const rail = await listReleases(db, {
        tenantId: c.get('tenantId') as number,
        userId: c.get('userId') as string,
        sessionId: c.req.param('sessionId'),
        objectId: c.req.query('objectId') || null,
      });
      return c.json({ rail });
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Capture a candidate and run its harness over it. Publishes NOTHING.
   *
   * Same body as publish, because the same validation decides both — the kind has to
   * accept the source before either can write a snapshot.
   */
  router.post('/releases/stage', requirePermission(PERMISSIONS.MARKETPLACE_PUBLISH), async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const staged = await stageRelease(db, c.env, {
        tenantId: c.get('tenantId') as number,
        userId: c.get('userId') as string,
        sessionId: String(body.sessionId ?? ''),
        objectId: typeof body.objectId === 'string' && body.objectId ? body.objectId : null,
        kind: String(body.kind ?? ''),
        name: String(body.name ?? ''),
        summary: typeof body.summary === 'string' ? body.summary : null,
        priceCents: Number(body.priceCents ?? 0),
        currency: typeof body.currency === 'string' ? body.currency : 'USD',
        trial: typeof body.trial === 'string' ? body.trial : null,
        listingId: typeof body.listingId === 'string' && body.listingId ? body.listingId : null,
      });
      return c.json({ staged }, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Re-read an existing candidate's findings.
   *
   * Separate from staging on purpose: reopening Stage must not re-capture, or a
   * seller who staged yesterday silently gets a new build off today's board under
   * the version number they thought they were about to publish.
   */
  router.get('/releases/:sessionId/staged/:snapshotId', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    try {
      const staged = await checksForStagedRelease(db, c.env, {
        tenantId: c.get('tenantId') as number,
        userId: c.get('userId') as string,
        sessionId: c.req.param('sessionId'),
        objectId: c.req.query('objectId') || null,
        snapshotId: c.req.param('snapshotId'),
      });
      return c.json({ staged });
    } catch (error) {
      return fail(c, error);
    }
  });

  /** Put an earlier version back on sale. Existing buyers are not moved. */
  router.post('/releases/revert', requirePermission(PERMISSIONS.MARKETPLACE_PUBLISH), async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const result = await revertListing(db, c.env, {
        tenantId: c.get('tenantId') as number,
        userId: c.get('userId') as string,
        listingId: String(body.listingId ?? ''),
        snapshotId: String(body.snapshotId ?? ''),
      });
      return c.json({ reverted: result });
    } catch (error) {
      return fail(c, error);
    }
  });

  /** Everything I have published. */
  router.get('/mine', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    const listings = await sellerListings(db, c.get('tenantId') as number, c.get('userId') as string);
    return c.json({ listings });
  });

  /** Withdraw from the public catalogue. Buyers keep their licences. */
  router.delete('/:listingId', requirePermission(PERMISSIONS.MARKETPLACE_PUBLISH), async (c) => {
    try {
      await unpublishCreationListing(
        db, c.env, c.get('tenantId') as number, c.get('userId') as string, c.req.param('listingId'),
      );
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Take a FREE listing.
   *
   * It takes no body at all. An earlier shape accepted a `paymentIntentId` here,
   * which meant a paid product was one plausible string away from free; the paid
   * path is now checkout, below, and this route cannot grant anything priced.
   */
  router.post('/:slug/acquire', requirePermission(PERMISSIONS.MARKETPLACE_PURCHASE), async (c) => {
    try {
      const result = await acquireListing(db, c.env, {
        tenantId: c.get('tenantId') as number,
        buyerRef: c.get('userId') as string,
        slug: c.req.param('slug'),
      });
      return c.json({ acquisition: result }, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /** Start a paid purchase; answers with the processor's hosted checkout URL. */
  router.post('/:slug/checkout', requirePermission(PERMISSIONS.MARKETPLACE_PURCHASE), async (c) => {
    try {
      const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
      const result = await startListingCheckout(db, c.env, {
        tenantId: c.get('tenantId') as number,
        buyerRef: c.get('userId') as string,
        buyerEmail: typeof body.buyerEmail === 'string' ? body.buyerEmail : null,
        slug: c.req.param('slug'),
        returnUrl: typeof body.returnUrl === 'string' ? body.returnUrl : resolveAppBaseUrl(c.env),
      });
      return c.json(result);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Finish a paid purchase.
   *
   * Takes the checkout id and NOTHING else — no price, no payment id, no listing.
   * All of it is read back from the processor inside the application layer, which
   * is the only reading of "was this paid" that a buyer cannot author.
   */
  router.post('/checkout/:checkoutSessionId/complete', requirePermission(PERMISSIONS.MARKETPLACE_PURCHASE), async (c) => {
    try {
      const result = await completeListingCheckout(db, c.env, {
        tenantId: c.get('tenantId') as number,
        buyerRef: c.get('userId') as string,
        checkoutSessionId: c.req.param('checkoutSessionId'),
      });
      return c.json({ acquisition: result }, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Put what I bought onto a board of my own.
   *
   * Gated on the LICENCE, not on the price: a free listing grants one on
   * acquisition just as a paid one does, so there is a single condition here
   * rather than a price check that would let a paid item through the moment
   * somebody changed its price to zero and back.
   */
  router.post('/:slug/install', requirePermission(PERMISSIONS.MARKETPLACE_PURCHASE), async (c) => {
    try {
      const tenantId = c.get('tenantId') as number;
      const userId = c.get('userId') as string;
      const slug = c.req.param('slug');
      // Resolved WITHOUT the visibility filter: a buyer whose seller has since
      // withdrawn the listing still owns it, and installing through the shop
      // window would 404 the one person entitled to a copy.
      const listing = await resolveListingBySlug(db, slug);
      if (!listing) return c.json({ error: 'Listing not found' }, 404);
      // One read answers both questions: may they install, and WHICH VERSION do they
      // own. Asking them separately is how "they own it" and "this is what they own"
      // come to disagree.
      const licence = await heldLicence(db, tenantId, userId, listing.id);
      if (!licence) return c.json({ error: 'Take a copy first' }, 403);
      const installed = await installListingIntoCanvas(db, c.env, {
        tenantId, userId, slug, heldSnapshotId: licence.snapshotId,
      });
      return c.json({ installed }, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /** What I own. */
  router.get('/acquired', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    const rows = await acquiredListings(db, c.get('tenantId') as number, c.get('userId') as string);
    return c.json({ acquired: rows });
  });

  /** Reverse a sale: licence revoked first, then the ledger. */
  router.post('/orders/:orderId/refund', requirePermission(PERMISSIONS.MARKETPLACE_PURCHASE), async (c) => {
    try {
      const result = await refundListingOrder(db, c.env, {
        tenantId: c.get('tenantId') as number,
        orderId: Number.parseInt(c.req.param('orderId'), 10),
        actorRef: c.get('userId') as string,
      });
      return c.json(result);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Earned, paid, available — plus the rate the split was made at.
   *
   * `earnings.takeRate` is this SELLER's resolved rate (0 while under the lifetime
   * threshold), which is what a payout was actually cut at. `configuredTakeRateBps`
   * is the platform's flat rate — what the fee becomes once they cross it — sent
   * alongside so a seller under the threshold can be told both "you keep 100%
   * today" and "here is what starts afterwards" from one call. A prior version of
   * this route sent the flat configured rate ALONE, under the key `takeRateBps` —
   * so a seller who owed nothing was told they were being charged the platform
   * default, which is the exact inverse of the 0%-under-threshold promise.
   */
  router.get('/earnings', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    const earnings = await sellerEarnings(db, c.env, c.get('tenantId') as number, c.get('userId') as string);
    return c.json({ earnings, configuredTakeRateBps: platformTakeRateBps(c.env) });
  });

  /** Send the available balance to the seller's default payout destination. */
  router.post('/payout', requirePermission(PERMISSIONS.MARKETPLACE_PUBLISH), async (c) => {
    const result = await payoutSellerBalance(
      db, c.env, c.get('tenantId') as number, c.get('userId') as string,
    );
    return c.json(result, result.ok ? 200 : 400);
  });

  return router;
}

/**
 * The public half — mounted separately so no auth middleware can be attached to it
 * by accident.
 *
 * `launch` reads an OPTIONAL bearer token: present, it upgrades a paid listing from
 * preview to the real thing for someone who owns it; absent, the endpoint still
 * answers. That is why the entitlement lookup is here rather than in middleware —
 * middleware that can reject would turn "play this free game" into a login wall.
 */
export function createPublicListingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    const result = await browseCreationListings(db, c.env, {
      q: c.req.query('q') ?? '',
      kind: c.req.query('kind') ?? '',
      page: Number.parseInt(c.req.query('page') ?? '1', 10),
      limit: Number.parseInt(c.req.query('limit') ?? '24', 10),
    });
    return c.json(result);
  });

  router.get('/:slug', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    const listing = await getPublicListing(db, c.env, c.req.param('slug'));
    return listing ? c.json({ listing }) : c.json({ error: 'Listing not found' }, 404);
  });

  router.get('/:slug/launch', requirePermission(PERMISSIONS.MARKETPLACE_READ), async (c) => {
    const slug = c.req.param('slug');
    // Resolved WITHOUT the visibility filter so entitlement can be established
    // first: `launchListing` then decides that a withdrawn listing still runs for
    // the people who own it and is gone to everybody else. Resolving through the
    // public catalogue here would take a paid product away from its buyer the
    // moment the seller stopped selling it.
    const listing = await resolveListingBySlug(db, slug);
    if (!listing) return c.json({ error: 'Listing not found' }, 404);

    // A bad or expired token is treated exactly like no token: the visitor gets the
    // free/preview experience instead of an error, because a signed-out visitor and
    // a stale-token visitor want the same thing from this URL.
    const { entitled, snapshotId } = await entitlementFromAuthHeader(
      db, c.env, c.req.header('Authorization'), listing.id,
    );

    const payload = await launchListing(db, c.env, slug, entitled, snapshotId);
    return payload ? c.json({ launch: payload }) : c.json({ error: 'Nothing to launch' }, 404);
  });

  return router;
}
