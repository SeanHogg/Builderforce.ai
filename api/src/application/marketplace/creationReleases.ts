/**
 * THE RELEASE LIFECYCLE OF A CANVAS CREATION — build, stage, live.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Publishing already wrote an IMMUTABLE snapshot per version and bumped
 * `catalog_items.version`, so the full history of every listing has been on disk
 * from the first day. Nothing read it. There was no way to see the versions, no way
 * to go back to one, and no way to capture a candidate WITHOUT selling it — so the
 * first time a seller saw the buyer's view of their own creation was on the public
 * URL that was already selling it.
 *
 * ── WHY THERE IS NO NEW TABLE ────────────────────────────────────────────────────
 * The release history IS the `snapshots` rows: `objectId` (the listing's registry
 * entry), `reason`, `createdBy`, `takenAt`. A `listing_releases` table beside them
 * would be a second copy of a fact already stored — the exact duplication the data
 * model forbids. Staging is therefore a `reason` VALUE, not DDL.
 *
 * That choice pays for itself immediately: the public snapshot read pins
 * `reason = 'publication'`, so a STAGED snapshot is unreachable from the marketplace
 * BY CONSTRUCTION rather than by a visibility flag somebody could get wrong. The
 * privacy of Stage is an existing security check, reused.
 *
 * ── WHY VERSIONS ARE DERIVED AND NOT STORED ──────────────────────────────────────
 * `catalog_items.version` holds the CURRENT number and nothing holds the historical
 * ones. Rather than add a column and have two facts that can disagree, the rail
 * replays `bumpVersion` over the publication snapshots in the order they were
 * written — which reconstructs exactly the sequence that produced the stored current
 * value, because that is the only function that has ever written it. A stored
 * per-snapshot version would be the same number in two places, and the day they
 * differ the buyer's badge and the seller's rail say different things.
 *
 * ── WHY NONE OF THIS IS CACHED ───────────────────────────────────────────────────
 * The rail is the seller's own management view, read once per panel open and
 * expected to show a change the instant they make it — the same reasoning
 * `sellerListings` is uncached for. Every read here is bounded (one listing's
 * snapshots) and every one of them is followed by a decision the seller is waiting
 * on. The hot path this seam DOES have — a stranger launching a published listing —
 * goes through `publishedSnapshot`, which is cached by id and never invalidated
 * because the row behind an id is immutable by construction.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { listingKindSpec, resolveListingHarness } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, snapshots, templateLicenses } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  ListingError,
  bumpVersion,
  buildSnapshotPayload,
  invalidateListingCaches,
  resolveListingTarget,
  writeListingRow,
  type ListingBody,
  type ListingSnapshotPayload,
  type PublishInput,
} from './creationListings';
import { runStageChecks, type StageObject } from './stageChecks';
import {
  SNAPSHOT_REASON_PUBLICATION,
  SNAPSHOT_REASON_STAGE,
  type ListingHarness,
  type ListingReleaseState,
  type StageCheck,
} from '@builderforce/creation-canvas-contract';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ReleaseView {
  /** Null on the DRAFT row — the board has moved on and nothing has been captured. */
  snapshotId: string | null;
  version: string;
  state: ListingReleaseState;
  takenAtISO: string | null;
  /** Buyers pinned to this exact snapshot. The number that makes a revert a
   *  decision rather than a shrug. */
  holders: number;
}

export interface ReleaseRail {
  listingId: string | null;
  slug: string | null;
  kind: string | null;
  /** Which of the six runners exercises this creation, resolved once and shared. */
  harness: ListingHarness | null;
  /** Whether the listing is currently on sale, as opposed to staged or withdrawn. */
  live: boolean;
  releases: ReleaseView[];
}

export interface StagedRelease {
  snapshotId: string;
  version: string;
  harness: ListingHarness;
  checks: StageCheck[];
  /** The staged payload, so Stage can render exactly what a buyer would receive
   *  rather than re-reading the seller's board. */
  payload: ListingSnapshotPayload;
}

export interface ReleaseQuery {
  tenantId: number;
  userId: string;
  sessionId: string;
  objectId: string | null;
}

// ---------------------------------------------------------------------------
// Finding the listing behind a board card
// ---------------------------------------------------------------------------

/**
 * The listing published (or staged) from this exact source, if there is one.
 *
 * Matched on the source coordinates in `body`, the same key `publishCandidates`
 * uses, so the rail a seller opens on a card is the rail for the listing that
 * card's publish button would update.
 */
async function listingForSource(
  db: Db,
  tenantId: number,
  sessionId: string,
  objectId: string | null,
): Promise<typeof catalogItems.$inferSelect | null> {
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(
      eq(catalogItems.tenantId, tenantId),
      sql`${catalogItems.body}->'source'->>'sessionId' = ${sessionId}`,
    ));
  const wanted = objectId ?? null;
  return rows.find((row) => {
    const body = row.body as ListingBody | null;
    return (body?.source?.objectId ?? null) === wanted;
  }) ?? null;
}

/**
 * How many buyers hold each of these snapshots.
 *
 * ONE grouped query for the whole rail rather than a count per row — a listing with
 * a dozen releases would otherwise cost a dozen round-trips on every panel open,
 * which is the N+1 the publish-candidates read was already written to avoid.
 *
 * Deliberately cross-tenant, and DECLARED as such rather than left for the guard to
 * catch: a licence lives in the BUYER's workspace, so counting only the seller's own
 * tenant would report zero holders for every real sale and make every revert look
 * free. The access predicate that governs it in place of a tenant filter is the
 * snapshot id list — every id in it came from this seller's own listing, so the count
 * can only ever be of people holding a version this seller published.
 *
 * A COUNT and nothing else. No buyer, no workspace, no order — the seller learns how
 * many people a revert affects and learns nothing about who they are.
 */
async function holderCounts(db: Db, snapshotIds: readonly string[]): Promise<Map<string, number>> {
  if (!snapshotIds.length) return new Map();
  const rows = await db
    .select({ snapshotId: templateLicenses.snapshotId, held: sql<string>`count(*)` })
    .from(templateLicenses)
    .where(acrossTenants(
      templateLicenses,
      'public_catalogue',
      inArray(templateLicenses.snapshotId, [...snapshotIds]),
      sql`${templateLicenses.revokedAt} is null`,
    ))
    .groupBy(templateLicenses.snapshotId);
  return new Map(rows.filter((row) => row.snapshotId).map((row) => [row.snapshotId as string, Number(row.held)]));
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

/**
 * Every version of the creation behind this card, newest first.
 *
 * The four states are derived rather than stored, from two facts the data already
 * holds — does a snapshot exist, and is the listing pointing at it:
 *
 *   draft       nothing captured since the board last changed. Always present, and
 *               always first, because it is the thing the seller is looking at.
 *   staged      a `stage` snapshot. Never public.
 *   live        the `publication` snapshot the listing currently points at, and
 *               only when the listing is actually on sale.
 *   superseded  a publication snapshot the listing has moved on from — still held
 *               by everyone who bought it, which is why it is never deleted.
 */
export async function listReleases(db: Db, query: ReleaseQuery): Promise<ReleaseRail> {
  const listing = await listingForSource(db, query.tenantId, query.sessionId, query.objectId);
  if (!listing) {
    return { listingId: null, slug: null, kind: null, harness: null, live: false, releases: [] };
  }

  const body = listing.body as ListingBody | null;
  const harness = resolveListingHarness(listing.kind, body?.source?.objectKind ?? null);

  const rows = await db
    .select({
      id: snapshots.id,
      reason: snapshots.reason,
      takenAt: snapshots.takenAt,
    })
    .from(snapshots)
    .where(and(
      scopedToTenant(snapshots, query.tenantId),
      // Resolved through the listing's registry entry, which is the only link
      // between a catalogue row and its snapshots.
      sql`${snapshots.objectId} = (select id from objects where ref_id = ${listing.id} and kind = 'catalog_item' limit 1)`,
      inArray(snapshots.reason, [SNAPSHOT_REASON_PUBLICATION, SNAPSHOT_REASON_STAGE]),
    ))
    .orderBy(desc(snapshots.takenAt));

  const holders = await holderCounts(db, rows.map((row) => row.id));

  // Publication versions replay `bumpVersion` from oldest to newest — the same
  // sequence that produced the stored current value, reconstructed rather than
  // duplicated into a column.
  const published = [...rows].filter((row) => row.reason === SNAPSHOT_REASON_PUBLICATION).reverse();
  const versionBySnapshot = new Map<string, string>();
  let version = '1.0.0';
  published.forEach((row, index) => {
    versionBySnapshot.set(row.id, index === 0 ? '1.0.0' : (version = bumpVersion(version)));
  });
  // A staged candidate is numbered as what it WOULD become, so the seller stages
  // "v1.3" and publishes "v1.3" rather than watching the number change under them.
  const nextVersion = published.length ? bumpVersion(version) : '1.0.0';

  const liveSnapshotId = listing.visibility === 'public' ? body?.snapshotId ?? null : null;

  const releases: ReleaseView[] = [
    {
      snapshotId: null,
      version: nextVersion,
      state: 'draft',
      takenAtISO: null,
      holders: 0,
    },
    ...rows.map((row) => ({
      snapshotId: row.id,
      version: row.reason === SNAPSHOT_REASON_STAGE
        ? nextVersion
        : versionBySnapshot.get(row.id) ?? '1.0.0',
      state: (row.reason === SNAPSHOT_REASON_STAGE
        ? 'staged'
        : row.id === liveSnapshotId ? 'live' : 'superseded') as ListingReleaseState,
      takenAtISO: row.takenAt?.toISOString() ?? null,
      holders: holders.get(row.id) ?? 0,
    })),
  ];

  return {
    listingId: listing.id,
    slug: listing.slug,
    kind: listing.kind,
    harness,
    live: listing.visibility === 'public' && !!listing.publishedAt,
    releases,
  };
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

/**
 * Capture the board as a candidate and run its harness over it.
 *
 * ── THE RULE THAT MAKES THIS WORTH BUILDING ──────────────────────────────────────
 * The checks read the SNAPSHOT, never the live board. Between the two, publishing
 * regenerates every id, recursively strips twenty families of seller binding, lays
 * the cards out at new coordinates and hands the result to an account with none of
 * the seller's connectors, data or entitlements. A check that ran against the
 * seller's own board would pass while the product is broken — which is exactly the
 * failure this whole surface exists to prevent, so it must not be reintroduced here.
 *
 * Staging an unpublished creation MATERIALISES its listing row, `private` with no
 * `publishedAt`. That is not a side effect to tidy away: a snapshot's `objectId` is
 * a real foreign key into the object registry, so a candidate has to hang off a real
 * listing. Because every browse surface already filters on
 * `visibility = 'public' AND published_at IS NOT NULL`, a staged-only listing is
 * invisible to the catalogue without a new flag being invented for it.
 */
export async function stageRelease(db: Db, env: Env, input: PublishInput): Promise<StagedRelease> {
  const target = await resolveListingTarget(db, env, input);
  const payload = await buildSnapshotPayload(db, input.sessionId, input.objectId, target.name);

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      tenantId: input.tenantId,
      objectId: target.registryObjectId,
      reason: SNAPSHOT_REASON_STAGE,
      payload: payload as unknown as Record<string, unknown>,
      createdBy: input.userId,
    })
    .returning({ id: snapshots.id });
  if (!snapshot) throw new ListingError('Could not stage the creation', 400);

  const body: ListingBody = {
    source: { sessionId: input.sessionId, objectId: input.objectId, objectKind: target.objectKind },
    // The live pointer is NOT moved. A stage that repointed the listing would put an
    // untested build in front of every existing buyer, which is the opposite of what
    // staging is for.
    snapshotId: (target.existing?.body as ListingBody | null)?.snapshotId ?? snapshot.id,
    launch: target.spec.launch,
    trial: target.trial,
    seller: { userId: input.userId, name: target.sellerName },
  };

  await writeListingRow(db, input, target, body, {
    // Keep a live listing live; a listing that has never been published stays
    // private. Staging must never take something off sale.
    visibility: target.existing?.visibility === 'public' ? 'public' : 'private',
    version: target.existing?.version ?? '1.0.0',
  });

  const rail = await listReleases(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    objectId: input.objectId,
  });
  const staged = rail.releases.find((release) => release.snapshotId === snapshot.id);

  return {
    snapshotId: snapshot.id,
    version: staged?.version ?? '1.0.0',
    harness: resolveListingHarness(target.spec.id, target.objectKind),
    checks: checksForPayload(payload, {
      listingKind: target.spec.id,
      objectKind: target.objectKind,
      priceCents: target.priceCents,
      trial: target.trial,
    }),
    payload,
  };
}

/**
 * Re-run the harness over a snapshot that already exists.
 *
 * Reopening Stage must not re-capture: a seller who staged yesterday and comes back
 * to read the findings would otherwise silently get a NEW candidate off today's
 * board, and the version they thought they were about to publish would be a
 * different build.
 */
export async function checksForStagedRelease(
  db: Db,
  query: ReleaseQuery & { snapshotId: string },
): Promise<StagedRelease> {
  const listing = await listingForSource(db, query.tenantId, query.sessionId, query.objectId);
  if (!listing) throw new ListingError('Nothing has been staged for this yet', 404);
  const body = listing.body as ListingBody | null;

  const [row] = await db
    .select({ payload: snapshots.payload })
    .from(snapshots)
    .where(and(
      eq(snapshots.id, query.snapshotId),
      scopedToTenant(snapshots, query.tenantId),
    ))
    .limit(1);
  const payload = (row?.payload ?? null) as ListingSnapshotPayload | null;
  if (!payload) throw new ListingError('That version no longer exists', 404);

  const objectKind = body?.source?.objectKind ?? null;
  const rail = await listReleases(db, query);
  const release = rail.releases.find((entry) => entry.snapshotId === query.snapshotId);

  return {
    snapshotId: query.snapshotId,
    version: release?.version ?? listing.version,
    harness: resolveListingHarness(listing.kind, objectKind),
    checks: checksForPayload(payload, {
      listingKind: listing.kind,
      objectKind,
      priceCents: listing.priceCents ?? 0,
      trial: body?.trial ?? 'preview',
    }),
    payload,
  };
}

/** The one call into the runners, so a caller cannot assemble a different input
 *  shape and get a different verdict for the same snapshot. */
function checksForPayload(
  payload: ListingSnapshotPayload,
  meta: {
    listingKind: string;
    objectKind: string | null;
    priceCents: number;
    trial: string;
  },
): StageCheck[] {
  return runStageChecks({
    listingKind: meta.listingKind,
    objectKind: meta.objectKind,
    objects: (payload.objects ?? []) as readonly StageObject[],
    priceCents: meta.priceCents,
    trial: meta.trial,
    strippedFields: payload.strippedFields ?? [],
  });
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

/**
 * Put an earlier version back on sale.
 *
 * ── WHY THIS DOES NOT EDIT A SNAPSHOT ────────────────────────────────────────────
 * Reverting points the listing at an older `publication` snapshot and BUMPS the
 * version. It never rewrites the old row and never reuses its number. "v1.4, whose
 * payload is v1.1's" is honest and traceable; a mutated v1.1 is a lie told to the
 * people who already bought it, and it would silently change what they hold — the
 * precise failure the snapshot model exists to make impossible.
 *
 * Existing buyers are NOT moved. Their licence pins the snapshot they bought, so a
 * revert changes what NEW buyers receive and leaves everyone else exactly where they
 * chose to be. That is what makes a revert a safe action rather than a second
 * incident.
 */
export async function revertListing(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; listingId: string; snapshotId: string },
): Promise<{ version: string; snapshotId: string }> {
  const [listing] = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.id, input.listingId), eq(catalogItems.tenantId, input.tenantId)))
    .limit(1);
  if (!listing) throw new ListingError('Listing not found', 404);
  if (listing.publisherRef !== input.userId) {
    throw new ListingError('Only the publisher can change this listing', 403);
  }

  const body = listing.body as ListingBody | null;
  if (!body) throw new ListingError('This listing has nothing to revert', 400);
  if (body.snapshotId === input.snapshotId) {
    throw new ListingError('That version is already the one on sale', 409);
  }

  // Pinned to `publication` and to this listing's own registry object: a revert that
  // accepted any snapshot id would let a seller point their public listing at a
  // staged candidate — or at another tenant's board.
  const [target] = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(and(
      eq(snapshots.id, input.snapshotId),
      scopedToTenant(snapshots, input.tenantId),
      eq(snapshots.reason, SNAPSHOT_REASON_PUBLICATION),
      sql`${snapshots.objectId} = (select id from objects where ref_id = ${listing.id} and kind = 'catalog_item' limit 1)`,
    ))
    .limit(1);
  if (!target) throw new ListingError('That version is not one of this listing’s releases', 404);

  const version = bumpVersion(listing.version);
  await db
    .update(catalogItems)
    .set({
      body: { ...body, snapshotId: input.snapshotId } as unknown as Record<string, unknown>,
      version,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(catalogItems, input.tenantId, eq(catalogItems.id, input.listingId)));

  await invalidateListingCaches(env, listing.slug);
  return { version, snapshotId: input.snapshotId };
}

/**
 * Which listing kinds this canvas card could be sold as, with the harness each one
 * would be exercised by.
 *
 * Read by the panel so a seller sees what will be CHECKED before they commit to a
 * kind — the difference between "publish and find out" and a decision.
 */
export function harnessForKinds(kinds: readonly string[], objectKind: string | null) {
  return kinds.map((kind) => ({
    kind,
    icon: listingKindSpec(kind)?.icon ?? '📦',
    harness: resolveListingHarness(kind, objectKind),
  }));
}
