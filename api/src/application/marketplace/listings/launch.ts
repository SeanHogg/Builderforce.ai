/**
 * Launch and install — what a visitor pressing the primary button is handed (the
 * preview or the product, decided here), the immutable published snapshot behind
 * it, the copy an install puts on the buyer's own board, and the install counter.
 * Split out of `../creationListings.ts`, which re-exports the public names.
 */
import { eq, sql } from 'drizzle-orm';
import {
  listingKindSpec,
  resolveListingAccess,
  SNAPSHOT_REASON_PUBLICATION,
  type ListingLaunchMode,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import {
  catalogItems,
  creationSessionMembers,
  creationSessionObjects,
  creationSessions,
  snapshots,
} from '../../../infrastructure/database/schema';
import { getOrSetCached } from '../../../infrastructure/cache/readThroughCache';
import { acrossTenants } from '../../../infrastructure/database/tenantScope';
import { creationObjectSearchText } from '../../creation/creationSessionModel';
import { registerObject } from '../../kernel/ObjectRegistry';
import { liveUrl, runnableDocument, type StageObject } from '../stageChecks';
import { hostedListingStatus, isHostedListing, type HostedListingStatus } from '../creationListings.hosted';
import { SNAPSHOT_TTL_SECONDS, invalidateListingCaches, snapshotCacheKey } from './cache';
import {
  ListingError,
  type CatalogRow,
  type ListingBody,
  type ListingSnapshotPayload,
} from './model';

export interface LaunchPayload {
  mode: ListingLaunchMode;
  /** True when the caller is entitled to the full thing (free listing, full trial,
   *  or a purchase on record). False means this is the preview. */
  entitled: boolean;
  title: string;
  /** `play`: the game document, rendered into a sandboxed frame with `srcDoc`.
   *  `open`: a live URL. `install`/`run`/`preview`: the canvas payload. */
  document?: string;
  url?: string;
  objects?: ListingSnapshotPayload['objects'];
  /** Present only for a `hosted` listing: whether the thing the buyer subscribes to
   *  is still serving, and what they may do if it is not. */
  hosted?: HostedListingStatus;
}

/**
 * TURN A SNAPSHOT INTO WHAT THE VIEWER SEES.
 *
 * ── WHY THIS IS ITS OWN FUNCTION ─────────────────────────────────────────────────
 * Two callers need exactly this and they reach the snapshot by different routes:
 * the public launch endpoint resolves a listing by its public SLUG, and the seller's
 * Stage preview resolves a candidate by SNAPSHOT ID — a staged version deliberately
 * has no slug, which is precisely why a seller could read a verdict about their own
 * product without ever seeing it. What happens once you HAVE the payload is identical
 * for both, and it has to be: the whole promise of the preview is that it is the real
 * thing running, not a second renderer that agrees for now.
 *
 * The `entitled` flag is an ARGUMENT rather than something derived here, because the
 * two callers establish it differently — `resolveListingAccess` for a visitor, "you
 * are the seller of your own candidate" for Stage — and one function deciding both
 * would have to know about licences AND sessions.
 */
export function launchPayloadFor(
  payload: ListingSnapshotPayload,
  mode: ListingLaunchMode,
  entitled: boolean,
): LaunchPayload {
  const base: LaunchPayload = { mode, entitled, title: payload.title };
  if (!entitled) {
    // The preview is the METADATA of the thing, never the thing. Returning the
    // objects "but with a flag" is how a paid product ends up in a network tab.
    return { ...base, mode: 'preview', objects: payload.objects.map((object) => ({
      id: object.id, kind: object.kind, canvasData: object.canvasData, content: null,
    })) };
  }
  if (mode === 'play') return { ...base, document: gameDocument(payload) ?? undefined };
  if (mode === 'open') return { ...base, url: siteUrl(payload) ?? undefined };
  return { ...base, objects: payload.objects };
}

/**
 * A listing by slug, WITHOUT the visibility filter.
 *
 * Every browse surface filters on `visibility = 'public'`, and that is right for a
 * catalogue. It is wrong for the two paths a BUYER uses. Withdrawing a listing
 * takes it off sale; it does not repossess it. A seller who stops selling must not
 * be able to reach into a workspace that already paid and switch the thing off —
 * so launch and install resolve the row here and then apply the licence rule,
 * rather than resolving through the shop window and 404-ing the customer.
 *
 * Exported for the install path, which needs the same reading.
 */
export async function resolveListingBySlug(
  db: Db,
  slug: string,
): Promise<CatalogRow | null> {
  const [row] = await db
    .select()
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.slug, slug)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve what to hand a visitor pressing the primary button.
 *
 * The entitlement decision is made HERE and nowhere else. A route that checked it
 * and then fetched the payload separately is a route where a client can skip the
 * check by calling the second endpoint; so there is one endpoint, it returns the
 * preview or the product, and which one is not the caller's choice.
 */
export async function launchListing(
  db: Db,
  env: Env,
  slug: string,
  entitled: boolean,
  /**
   * The snapshot this caller's licence is pinned to, when they have one.
   *
   * A buyer must be served THE VERSION THEY BOUGHT, not whatever the seller has
   * published since. Null — no licence, or one granted before versions were pinned —
   * falls back to the listing's current snapshot, which is what every caller was
   * being served before this existed.
   */
  heldSnapshotId: string | null = null,
): Promise<LaunchPayload | null> {
  const row = await resolveListingBySlug(db, slug);
  if (!row) return null;
  const body = row.body as ListingBody | null;
  if (!body) return null;

  // THE rule, called rather than restated. `resolveListingAccess` answers both
  // halves at once — may this caller see the listing, and do they get the product or
  // the preview — and it is the same call the creator's own landing page and the
  // subscribe surface make, so two shop windows onto one product cannot disagree
  // about who has paid for it.
  const access = resolveListingAccess({
    priceCents: row.priceCents ?? 0,
    trial: body.trial,
    visibility: row.visibility,
    hasLicence: entitled,
  });
  // Withdrawn: only the people who already hold it may still run it. To everybody
  // else it is simply gone, which is what withdrawing it meant.
  if (!access.visible) return null;

  const spec = listingKindSpec(row.kind);
  const mode = body.launch ?? spec?.launch ?? 'preview';

  // The buyer's pinned snapshot wins over the listing's current one. Only for a
  // caller who is actually entitled: an unpinned visitor asking for an old snapshot
  // id would otherwise be a way to read a superseded build of a paid listing.
  const payload = await publishedSnapshot(db, env, (access.entitled && heldSnapshotId) || body.snapshotId);
  if (!payload) return null;

  const launch = launchPayloadFor(payload, mode, access.entitled);
  // A subscriber's app is a thing that can stop existing without them being told.
  // Carried on the launch rather than left to a second call, because the person who
  // needs it is looking at the address right now.
  return isHostedListing(body)
    ? { ...launch, hosted: await hostedListingStatus(db, env, row.id) }
    : launch;
}

/**
 * Read one published snapshot.
 *
 * The id is never caller input — it is reached through a listing already resolved
 * by its public slug — and `reason` is pinned to `'publication'` so a listing
 * whose body was tampered with cannot be made to serve some other kind of
 * snapshot (a pre-migration copy of a private board, say).
 */
export async function publishedSnapshot(
  db: Db,
  env: Env,
  snapshotId: string,
): Promise<ListingSnapshotPayload | null> {
  return getOrSetCached(env, snapshotCacheKey(snapshotId), async () => {
    const [row] = await db
      .select({ payload: snapshots.payload })
      .from(snapshots)
      .where(acrossTenants(snapshots, 'public_catalogue',
        eq(snapshots.id, snapshotId), eq(snapshots.reason, SNAPSHOT_REASON_PUBLICATION)))
      .limit(1);
    return (row?.payload ?? null) as ListingSnapshotPayload | null;
  }, { kvTtlSeconds: SNAPSHOT_TTL_SECONDS });
}

/**
 * A game's playable HTML, from the one card the listing is.
 *
 * `runnableDocument` was extracted in `stageChecks.ts` precisely so "is there
 * something to run" and "here is the thing to run" could not disagree — and then the
 * launch path kept its own copy anyway, which meant a card Stage passed could still
 * hand a buyer nothing. One reading, called from both.
 */
function gameDocument(payload: ListingSnapshotPayload): string | null {
  return runnableDocument(payload.objects as readonly StageObject[]);
}

/**
 * A published site's live address.
 *
 * Delegated to the harness's reading rather than repeated here. This file used to
 * carry its own copy that looked only at `canvasData`, so a card keeping its address
 * on `content` was VERIFIED by Stage at one URL and OPENED by the buyer at none —
 * two readings of "where does this thing live" is exactly how a deployment harness
 * comes to certify an address nobody is sent to.
 */
function siteUrl(payload: ListingSnapshotPayload): string | null {
  return liveUrl(payload.objects as readonly StageObject[]);
}

/**
 * Put what someone bought onto a board of their own.
 *
 * ── WHY A NEW SESSION AND NOT AN INSERT INTO AN EXISTING ONE ─────────────────────
 * An install is a COPY, and the copy has to land somewhere the buyer already
 * trusts. Dropping twelve cards into whichever board happened to be open is how a
 * purchase becomes a mess someone has to undo; a new session is undoable by
 * deleting it, and it carries the listing's name so a month later it is obvious
 * where those cards came from.
 *
 * The objects come from the SNAPSHOT, never from the seller's live board — the
 * buyer gets the version that was on sale, and a seller editing their canvas
 * cannot reach into a workspace that has already paid.
 *
 * Ids are regenerated. Reusing the seller's would make two rows in two tenants
 * claim the same primary key the first time anyone installed their own listing.
 */
export async function installListingIntoCanvas(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; slug: string; heldSnapshotId?: string | null },
): Promise<{ sessionId: string; title: string; objectCount: number }> {
  // Visibility is deliberately not a condition: the caller has already been
  // checked for a live licence, and a withdrawn listing is still owned by the
  // people who bought it. The seller withdrew it from SALE, not from them.
  const listing = await resolveListingBySlug(db, input.slug);
  if (!listing) throw new ListingError('Listing not found', 404);
  const body = listing.body as ListingBody | null;
  if (!body) throw new ListingError('This listing has nothing to install', 400);

  // Same cached read the launch path uses — an install is a launch that keeps a
  // copy, and two readers of one immutable row should not be two queries.
  //
  // Pinned to the buyer's own version. This is the defect the pin was added for:
  // somebody who bought v1.1 and installs a month later was silently handed v1.4,
  // and if v1.4 was worse they had nowhere to go back to.
  const payload = await publishedSnapshot(db, env, input.heldSnapshotId || body.snapshotId);
  if (!payload?.objects.length) throw new ListingError('This listing has nothing to install', 400);

  const sessionId = crypto.randomUUID();
  const now = new Date();
  const objectRows = payload.objects.map((object, index) => ({
    id: crypto.randomUUID(),
    sessionId,
    kind: object.kind,
    // Laid out in a readable grid rather than at the seller's coordinates: their
    // board may put a card at x=9000, and a buyer opening an empty canvas scrolled
    // to nowhere concludes the install failed.
    canvasData: {
      ...(object.canvasData && typeof object.canvasData === 'object' ? object.canvasData : {}),
      x: 120 + (index % 3) * 380,
      y: 100 + Math.floor(index / 3) * 320,
    },
    content: object.content,
    searchText: creationObjectSearchText(object.content),
    createdBy: input.userId,
    updatedBy: input.userId,
  }));

  await db.batch([
    db.insert(creationSessions).values({
      id: sessionId,
      tenantId: input.tenantId,
      title: listing.name.slice(0, 255),
      description: listing.summary,
      createdBy: input.userId,
      updatedBy: input.userId,
      canvasRevision: 1,
      lastActivityAt: now,
    }),
    db.insert(creationSessionMembers).values({
      sessionId, userId: input.userId, role: 'owner', invitedBy: input.userId,
    }),
    db.insert(creationSessionObjects).values(objectRows),
  ] as unknown as Parameters<typeof db.batch>[0]);

  await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: 'creation_session',
    refId: sessionId,
    domain: 'canvas',
    title: listing.name,
  });

  return { sessionId, title: listing.name, objectCount: objectRows.length };
}

/**
 * Count one acquisition against the listing. Called by the commerce path only.
 *
 * Cross-tenant because the counter belongs to the SELLER's row while the buyer is
 * in their own workspace — the same asymmetry that made the seller's ledger entry
 * land in the wrong tenant until it was caught.
 */
export async function recordInstall(db: Db, env: Env, listingId: string): Promise<void> {
  const [row] = await db
    .update(catalogItems)
    .set({ installCount: sql`${catalogItems.installCount} + 1` })
    .where(acrossTenants(catalogItems, 'public_catalogue',
      eq(catalogItems.id, listingId), eq(catalogItems.visibility, 'public')))
    .returning({ slug: catalogItems.slug });
  if (row) await invalidateListingCaches(env, row.slug);
}
