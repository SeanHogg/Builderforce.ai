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

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  LISTING_KIND_IDS,
  isListingKind,
  isPublishableObjectKind,
  isStrippedListingField,
  listingKindSpec,
  listingKindsForObjectKind,
  resolveTrialPolicy,
  sessionListingKinds,
  SNAPSHOT_REASON_PUBLICATION,
  SNAPSHOT_REASON_STAGE,
  type ListingLaunchMode,
  type ListingTrialPolicy,
  type MarketplaceListingKindSpec,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  catalogItems,
  creationSessionMembers,
  creationSessionObjects,
  creationSessions,
  objects,
  snapshots,
  users,
} from '../../infrastructure/database/schema';
import { creationObjectSearchText } from '../creation/creationSessionRouteService';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
  invalidateCached,
} from '../../infrastructure/cache/readThroughCache';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { registerObject } from '../kernel/ObjectRegistry';

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

/**
 * The public browse feed is searchable and filterable (q / kind / page) — an
 * UNBOUNDED keyspace — so it is cached behind a version token that every write
 * bumps, orphaning every cached variant at once. Same shape as the skills feed in
 * `marketplaceRoutes.ts`, deliberately: two invalidation strategies for two public
 * catalogues is how one of them goes stale for a fortnight without anyone noticing.
 */
/**
 * Exported because it is the invalidation signal for readers OUTSIDE this
 * module, not just for the browse feed.
 *
 * `application/ide/siteListing.ts` caches which listing sells a hosted site and
 * the seller facts that decide access to it, and both answers change on exactly
 * the writes that bump this token. Folding the token into that cache's KEY means
 * a publish, a re-publish, a price change or a withdrawal orphans it
 * automatically — no call from here into the hosting side, no import cycle, and
 * no reader this module has to remember exists. The alternative, a list of
 * invalidation callbacks, is a list somebody eventually forgets to add to.
 */
export const LISTINGS_VERSION_KEY = 'marketplace:creations:list';
const LISTINGS_TTL_SECONDS = 120;

/** A single listing's public payload. Bounded keyspace (one key per slug), so it
 *  is invalidated by key rather than by version token. */
const listingCacheKey = (slug: string) => `marketplace:creation:${slug}`;

/**
 * A published snapshot, keyed by its id — and NEVER invalidated, because it can
 * never change.
 *
 * This is the one cache here that needs no invalidation story at all, and the
 * reason is a property of the design rather than a hope: a re-publish writes a
 * NEW snapshot and points the listing at it, so the row behind a given id is
 * immutable from the moment it exists. That makes the hot path — a popular free
 * game being launched by strangers — a cache hit that never goes stale, which is
 * the difference between a marketplace people play in and one that reads a JSONB
 * document out of Postgres on every press of a Play button.
 */
const snapshotCacheKey = (snapshotId: string) => `marketplace:snapshot:${snapshotId}`;
const SNAPSHOT_TTL_SECONDS = 3600;

export async function invalidateListingCaches(env: Env, slug?: string): Promise<void> {
  await Promise.all([
    bumpCacheVersion(env, LISTINGS_VERSION_KEY),
    slug ? invalidateCached(env, listingCacheKey(slug)) : Promise.resolve(),
  ]);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the publish panel needs to know about ONE candidate before it offers it. */
export interface PublishCandidate {
  objectId: string | null;
  objectKind: string | null;
  title: string;
  /** Listing kinds this candidate may be published as, most specific first. */
  kinds: readonly string[];
  /** An existing listing for this exact source, if it has been published before. */
  existingListingId: string | null;
}

export interface CreationListingView {
  id: string;
  slug: string;
  kind: string;
  name: string;
  summary: string | null;
  category: string | null;
  tags: readonly string[];
  version: string;
  visibility: string;
  priceCents: number;
  currency: string;
  trial: ListingTrialPolicy;
  launch: ListingLaunchMode;
  icon: string;
  installCount: number;
  rating: number | null;
  publishedAtISO: string | null;
  updatedAtISO: string;
  sellerRef: string | null;
  sellerName: string | null;
  /** Source coordinates — seller-only. Absent on every public projection. */
  source?: { sessionId: string; objectId: string | null; objectKind: string | null };
}

/** The body stored on `catalog_items.body`. One shape, so nothing reads a `kind`
 *  and guesses at what else is present. */
export interface ListingBody {
  source: { sessionId: string; objectId: string | null; objectKind: string | null };
  snapshotId: string;
  launch: ListingLaunchMode;
  trial: ListingTrialPolicy;
  seller: { userId: string; name: string | null };
}

export interface PublishInput {
  tenantId: number;
  userId: string;
  sessionId: string;
  /** Null publishes the whole board as a pack. */
  objectId: string | null;
  kind: string;
  name: string;
  summary?: string | null;
  category?: string | null;
  tags?: readonly string[];
  priceCents?: number;
  currency?: string;
  trial?: string | null;
  /** Omitted on create; supplied to re-publish an existing listing in place. */
  listingId?: string | null;
  /**
   * A STAGED snapshot to promote instead of re-reading the board.
   *
   * This is what makes "what was tested is what ships" true. Absent, publish reads
   * the live board — correct for a seller who never staged, and a silent
   * substitution for one who did.
   */
  fromSnapshotId?: string | null;
}

export class ListingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = 'ListingError';
  }
}

// ---------------------------------------------------------------------------
// Snapshot projection
// ---------------------------------------------------------------------------

/**
 * Strip a canvas payload of everything that belongs to the seller rather than to
 * the product. Recursive, because a binding nested inside `content.steps[2]` is
 * still a binding, and a top-level-only strip is a strip that reads as thorough
 * and is not.
 */
function stripBindings(value: unknown, removed: Set<string>, depth = 0): unknown {
  if (depth > 12 || value == null) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => stripBindings(item, removed, depth + 1));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isStrippedListingField(key)) {
      // Recorded rather than merely dropped. A binding disappearing SILENTLY is the
      // defect Stage exists to surface: a workflow that worked on the seller's board
      // arrives at a buyer's attached to nothing, and until the seller is told which
      // field left there is no way for them to know that happened.
      removed.add(key);
      continue;
    }
    out[key] = stripBindings(item, removed, depth + 1);
  }
  return out;
}

/** The immutable payload a listing serves forever after. */
export interface ListingSnapshotPayload {
  kind: 'object' | 'session';
  title: string;
  /** For an object listing: the one card. For a pack: every card on the board. */
  objects: Array<{ id: string; kind: string; canvasData: unknown; content: unknown }>;
  connections: Array<{ sourceObjectId: string; targetObjectId: string; kind: string | null }>;
  /**
   * Field names `stripBindings` removed on the way in.
   *
   * Stored ON the snapshot rather than recomputed, because it is a fact about THIS
   * capture: the seller's board changes, and a list re-derived at read time would
   * describe a strip that never happened to the copy a buyer holds. Optional because
   * snapshots written before this seam existed do not carry it.
   */
  strippedFields?: string[];
}

// ---------------------------------------------------------------------------
// Candidates — what on this board could be sold
// ---------------------------------------------------------------------------

/**
 * Everything on a session that could become a listing, plus the board itself.
 *
 * The publish panel asks for this rather than deciding locally, so "is this
 * sellable" is answered by the same registry the server validates against. A
 * client-side guess is how a publish button appears over something the server will
 * refuse.
 */
export async function publishCandidates(
  db: Db,
  tenantId: number,
  sessionId: string,
): Promise<{ session: PublishCandidate; objects: readonly PublishCandidate[] }> {
  const [session] = await db
    .select({ id: creationSessions.id, title: creationSessions.title })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId)))
    .limit(1);
  if (!session) throw new ListingError('Session not found', 404);

  const rows = await db
    .select({
      id: creationSessionObjects.id,
      kind: creationSessionObjects.kind,
      canvasData: creationSessionObjects.canvasData,
    })
    .from(creationSessionObjects)
    .where(eq(creationSessionObjects.sessionId, sessionId));

  // ONE query for every listing already published off this board, so a board with
  // forty cards costs one round-trip rather than forty (the N+1 this panel would
  // otherwise introduce on every open).
  const existing = await db
    .select({ id: catalogItems.id, body: catalogItems.body })
    .from(catalogItems)
    .where(and(
      eq(catalogItems.tenantId, tenantId),
      sql`${catalogItems.body}->'source'->>'sessionId' = ${sessionId}`,
    ));
  const listingBySource = new Map<string, string>();
  for (const row of existing) {
    const body = row.body as ListingBody | null;
    if (!body?.source) continue;
    listingBySource.set(body.source.objectId ?? '__session__', row.id);
  }

  const candidates = rows
    .filter((row) => isPublishableObjectKind(row.kind))
    .map((row) => {
      const data = (row.canvasData ?? {}) as Record<string, unknown>;
      return {
        objectId: row.id,
        objectKind: row.kind,
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : row.kind,
        kinds: listingKindsForObjectKind(row.kind).map((spec) => spec.id),
        existingListingId: listingBySource.get(row.id) ?? null,
      } satisfies PublishCandidate;
    });

  return {
    session: {
      objectId: null,
      objectKind: null,
      title: session.title,
      kinds: sessionListingKinds().map((spec) => spec.id),
      existingListingId: listingBySource.get('__session__') ?? null,
    },
    objects: candidates,
  };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const MAX_TAGS = 12;

/** A URL-safe slug. Uniqueness is checked GLOBALLY, not per tenant: the public
 *  detail page is addressed by slug alone, so two tenants owning `space-game`
 *  would be two products at one URL. */
function slugify(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '').slice(0, 120) || 'listing';
}

async function claimSlug(db: Db, base: string, ownListingId: string | null): Promise<string> {
  const candidates = [base, ...Array.from({ length: 6 }, (_, i) => `${base}-${i + 2}`)];
  // Uniqueness is checked across EVERY tenant, which is the whole point: the slug
  // is the public URL, and a per-tenant check would happily hand two products the
  // same address.
  const taken = await db
    .select({ slug: catalogItems.slug, id: catalogItems.id })
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', inArray(catalogItems.slug, candidates)));
  const blocked = new Set(taken.filter((row) => row.id !== ownListingId).map((row) => row.slug));
  const free = candidates.find((slug) => !blocked.has(slug));
  // Six collisions on one name is rare enough that a random suffix is better than
  // a loop that can spin — and it still produces a readable URL.
  return free ?? `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function buildSnapshotPayload(
  db: Db,
  sessionId: string,
  objectId: string | null,
  title: string,
): Promise<ListingSnapshotPayload> {
  const rows = await db
    .select({
      id: creationSessionObjects.id,
      kind: creationSessionObjects.kind,
      canvasData: creationSessionObjects.canvasData,
      content: creationSessionObjects.content,
    })
    .from(creationSessionObjects)
    .where(objectId
      ? and(eq(creationSessionObjects.sessionId, sessionId), eq(creationSessionObjects.id, objectId))
      : eq(creationSessionObjects.sessionId, sessionId));
  if (!rows.length) throw new ListingError('Nothing to publish — the source is empty', 400);

  const removed = new Set<string>();
  return {
    kind: objectId ? 'object' : 'session',
    title,
    objects: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      canvasData: stripBindings(row.canvasData, removed),
      content: stripBindings(row.content, removed),
    })),
    // A pack's edges are part of the product; a single card has none to carry.
    connections: [],
    strippedFields: [...removed],
  };
}

/**
 * Publish, or re-publish, one canvas creation.
 *
 * Idempotent per source in the sense that matters: publishing the same object
 * twice UPDATES its listing (new snapshot, bumped version) rather than creating a
 * second row, so a seller who clicks twice does not end up competing with
 * themselves at two URLs.
 */
/**
 * Everything a publish and a STAGE both have to establish before either can write a
 * snapshot: that the kind accepts this source, that the caller owns the listing, and
 * that the listing has a registry entry a snapshot can point at.
 *
 * Extracted when Stage arrived because the two paths agree on every one of those
 * questions and differ only in what they do afterwards — publish points the listing
 * at the new snapshot and makes it public, staging leaves both alone. Two copies of
 * this validation is how a card becomes stageable as a kind the publish endpoint
 * would refuse.
 */
export interface ListingTarget {
  listingId: string;
  /** `objects.id` — the registry row a snapshot's foreign key resolves to. */
  registryObjectId: string;
  spec: MarketplaceListingKindSpec;
  objectKind: string | null;
  existing: CatalogRow | null;
  name: string;
  priceCents: number;
  trial: ListingTrialPolicy;
  sellerName: string | null;
}

export async function resolveListingTarget(
  db: Db,
  env: Env,
  input: PublishInput,
): Promise<ListingTarget> {
  const spec = listingKindSpec(input.kind);
  if (!spec) throw new ListingError(`Unknown listing kind "${input.kind}"`, 400);

  const name = input.name.trim().slice(0, 200);
  if (!name) throw new ListingError('A listing needs a name', 400);

  const [session] = await db
    .select({ id: creationSessions.id, title: creationSessions.title })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, input.sessionId), eq(creationSessions.tenantId, input.tenantId)))
    .limit(1);
  if (!session) throw new ListingError('Session not found', 404);

  // The kind must actually accept this source. Checked here rather than trusted
  // from the client, because `launch` is derived from it and a `game` launch over
  // a `document` payload renders an empty frame with a Play button on it.
  let objectKind: string | null = null;
  if (input.objectId) {
    const [row] = await db
      .select({ kind: creationSessionObjects.kind })
      .from(creationSessionObjects)
      .where(and(
        eq(creationSessionObjects.id, input.objectId),
        eq(creationSessionObjects.sessionId, input.sessionId),
      ))
      .limit(1);
    if (!row) throw new ListingError('Object not found on this board', 404);
    objectKind = row.kind;
    if (!spec.from.includes(row.kind)) {
      throw new ListingError(`A "${row.kind}" cannot be published as a ${spec.id}`, 400);
    }
  } else if (spec.from.length > 0) {
    throw new ListingError(`A ${spec.id} is published from an object, not from a board`, 400);
  }

  const priceCents = Math.max(0, Math.round(Number(input.priceCents ?? 0)) || 0);
  if (priceCents > 0 && spec.pricing === 'free') {
    throw new ListingError(`A ${spec.id} cannot be sold`, 400);
  }
  const trial = resolveTrialPolicy(spec.id, priceCents, input.trial ?? null);

  const existing = input.listingId
    ? (await db.select().from(catalogItems)
        .where(and(eq(catalogItems.id, input.listingId), eq(catalogItems.tenantId, input.tenantId)))
        .limit(1))[0] ?? null
    : null;
  if (input.listingId && !existing) throw new ListingError('Listing not found', 404);
  if (existing && existing.publisherRef !== input.userId) {
    throw new ListingError('Only the publisher can update this listing', 403);
  }

  const [seller] = await db
    .select({ displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  // Stamped onto the listing rather than joined at read time: the public card is
  // read far more often than a person renames themselves, and the alternative is a
  // join into the identity domain from a catalogue query — the exact cross-domain
  // reach the holding rule forbids. A rename reaches the card on the next publish.
  const sellerName = seller?.displayName ?? seller?.username ?? null;

  // The listing's registry entry comes FIRST: the snapshot's `objectId` is a real
  // foreign key into it, so there is no window where a snapshot points at nothing.
  const listingId = existing?.id ?? crypto.randomUUID();
  const registered = await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: 'catalog_item',
    refId: listingId,
    domain: 'commerce',
    title: name,
  });

  return {
    listingId,
    registryObjectId: registered.id,
    spec,
    objectKind,
    existing,
    name,
    priceCents,
    trial,
    sellerName,
  };
}

/**
 * Write the `catalog_items` row for a target.
 *
 * `visibility` is a parameter rather than a constant because that single value is
 * the whole difference between staging and publishing: a staged listing is a real
 * row with a real registry entry and a real snapshot, and it is `private` with no
 * `publishedAt` — which is exactly what every browse surface already filters out.
 * Staging therefore needs no new "is this live" flag for somebody to get wrong.
 */
export async function writeListingRow(
  db: Db,
  input: PublishInput,
  target: ListingTarget,
  body: ListingBody,
  options: { visibility: 'public' | 'private'; version: string },
): Promise<CatalogRow> {
  const { existing, listingId, spec, name, priceCents } = target;
  const slug = existing?.slug ?? await claimSlug(db, slugify(name), listingId);
  const tags = (input.tags ?? []).map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, MAX_TAGS);
  const now = new Date();

  const values = {
    id: listingId,
    tenantId: input.tenantId,
    kind: spec.id,
    slug,
    name,
    summary: input.summary?.trim().slice(0, 2000) ?? null,
    body: body as unknown as Record<string, unknown>,
    category: input.category?.trim().slice(0, 64) ?? null,
    tags: tags as unknown as string[],
    version: options.version,
    visibility: options.visibility,
    priceCents,
    currency: (input.currency ?? 'USD').toUpperCase().slice(0, 8),
    publisherRef: input.userId,
    // Set the first time it actually goes public, and never by a stage. A staged
    // listing carrying a publish date would appear in the feed the moment somebody
    // relaxed the visibility filter.
    publishedAt: existing?.publishedAt ?? (options.visibility === 'public' ? now : null),
    updatedAt: now,
  };

  const [row] = existing
    ? await db.update(catalogItems).set(values)
        .where(scopedToTenant(catalogItems, input.tenantId, eq(catalogItems.id, listingId))).returning()
    : await db.insert(catalogItems).values(values).returning();
  if (!row) throw new ListingError('Could not save the listing', 400);
  return row;
}

/**
 * Read a STAGED snapshot for promotion.
 *
 * Tenant-scoped and pinned to `reason = 'stage'` AND to this listing's registry
 * object: the id arrives from the client, and without all three a seller could
 * promote any snapshot in the database — including another tenant's private board —
 * into their own public listing.
 */
export async function stagedPayload(
  db: Db,
  tenantId: number,
  registryObjectId: string,
  snapshotId: string,
): Promise<ListingSnapshotPayload> {
  const [row] = await db
    .select({ payload: snapshots.payload })
    .from(snapshots)
    .where(and(
      eq(snapshots.id, snapshotId),
      eq(snapshots.tenantId, tenantId),
      eq(snapshots.objectId, registryObjectId),
      eq(snapshots.reason, SNAPSHOT_REASON_STAGE),
    ))
    .limit(1);
  const payload = (row?.payload ?? null) as ListingSnapshotPayload | null;
  if (!payload) throw new ListingError('That staged version no longer exists', 404);
  return payload;
}

/**
 * Publish, or re-publish, one canvas creation.
 *
 * Idempotent per source in the sense that matters: publishing the same object
 * twice UPDATES its listing (new snapshot, bumped version) rather than creating a
 * second row, so a seller who clicks twice does not end up competing with
 * themselves at two URLs.
 *
 * ── PUBLISHING WHAT WAS TESTED ───────────────────────────────────────────────────
 * `fromSnapshotId` names a STAGED snapshot to promote. Without it this re-reads the
 * live board, which means the thing that goes on sale is not the thing the checks
 * ran against — a seller stages v1.3, edits one card, presses Publish, and ships an
 * untested build under a tested version number. Promoting COPIES the staged payload
 * into a new `publication` snapshot rather than relabelling the staged row, so the
 * candidate stays in the rail and the sold copy is its own immutable record.
 */
export async function publishCreationListing(
  db: Db,
  env: Env,
  input: PublishInput,
): Promise<CreationListingView> {
  const target = await resolveListingTarget(db, env, input);
  const { spec, existing, objectKind, name } = target;

  const payload = input.fromSnapshotId
    ? await stagedPayload(db, input.tenantId, target.registryObjectId, input.fromSnapshotId)
    : await buildSnapshotPayload(db, input.sessionId, input.objectId, name);

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      tenantId: input.tenantId,
      objectId: target.registryObjectId,
      // Publication IS the reason — this is the copy a stranger is served, and
      // calling it 'manual' would lose the one fact that explains why it may
      // never be deleted while a sale references it.
      reason: SNAPSHOT_REASON_PUBLICATION,
      payload: payload as unknown as Record<string, unknown>,
      createdBy: input.userId,
    })
    .returning({ id: snapshots.id });
  if (!snapshot) throw new ListingError('Could not snapshot the creation', 400);

  const body: ListingBody = {
    source: { sessionId: input.sessionId, objectId: input.objectId, objectKind },
    snapshotId: snapshot.id,
    launch: spec.launch,
    trial: target.trial,
    seller: { userId: input.userId, name: target.sellerName },
  };

  const row = await writeListingRow(db, input, target, body, {
    visibility: 'public',
    // A previously-PUBLISHED listing bumps; one that has only ever existed as a
    // staged draft starts at 1.0.0 on its first real publish rather than inheriting
    // the number its candidates were staged under.
    version: existing?.publishedAt ? bumpVersion(existing.version) : '1.0.0',
  });

  await invalidateListingCaches(env, row.slug);
  return toView(row, body);
}

/** `1.0.0` → `1.1.0`. A re-publish is a new minor: the snapshot changed, and a
 *  buyer comparing what they hold against what is live needs the two to differ. */
export function bumpVersion(current: string): string {
  const [major, minor] = current.split('.').map((part) => Number.parseInt(part, 10));
  if (major == null || minor == null || !Number.isFinite(major) || !Number.isFinite(minor)) return '1.0.0';
  return `${major}.${minor + 1}.0`;
}

/** Take a listing off the public catalogue. The row and every sold snapshot stay —
 *  a buyer's licence outlives the seller's decision to stop selling. */
export async function unpublishCreationListing(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  listingId: string,
): Promise<void> {
  const [row] = await db
    .update(catalogItems)
    .set({ visibility: 'private', updatedAt: new Date() })
    .where(and(
      eq(catalogItems.id, listingId),
      eq(catalogItems.tenantId, tenantId),
      eq(catalogItems.publisherRef, userId),
    ))
    .returning({ slug: catalogItems.slug });
  if (!row) throw new ListingError('Listing not found', 404);
  await invalidateListingCaches(env, row.slug);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type CatalogRow = typeof catalogItems.$inferSelect;

function toView(row: CatalogRow, body: ListingBody | null, includeSource = true): CreationListingView {
  const spec = listingKindSpec(row.kind);
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    category: row.category,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    version: row.version,
    visibility: row.visibility,
    priceCents: row.priceCents ?? 0,
    currency: row.currency ?? 'USD',
    trial: body?.trial ?? 'preview',
    launch: body?.launch ?? spec?.launch ?? 'preview',
    icon: spec?.icon ?? '📦',
    installCount: row.installCount,
    rating: row.rating == null ? null : Number(row.rating),
    publishedAtISO: row.publishedAt?.toISOString() ?? null,
    updatedAtISO: row.updatedAt.toISOString(),
    sellerRef: row.publisherRef,
    sellerName: body?.seller?.name ?? null,
    ...(includeSource && body?.source ? { source: body.source } : {}),
  };
}

export interface BrowseQuery {
  q?: string;
  kind?: string;
  page?: number;
  limit?: number;
}

/** The public feed. Cached behind the version token; every publish bumps it. */
export async function browseCreationListings(
  db: Db,
  env: Env,
  query: BrowseQuery,
): Promise<{ listings: readonly CreationListingView[]; total: number }> {
  const limit = Math.min(48, Math.max(1, Math.round(query.limit ?? 24)));
  const page = Math.max(1, Math.round(query.page ?? 1));
  const q = (query.q ?? '').trim().slice(0, 80);
  const kind = isListingKind(query.kind) ? query.kind : '';
  const version = await getCacheVersion(env, LISTINGS_VERSION_KEY);
  const key = `${LISTINGS_VERSION_KEY}:${version}:${kind}:${q}:${page}:${limit}`;

  return getOrSetCached(env, key, async () => {
    const where = [eq(catalogItems.visibility, 'public'), isNotNull(catalogItems.publishedAt)];
    // `catalog_items` also holds policy packs and internal presets, which are not
    // for sale to anyone. The feed is bounded to the kinds this module publishes,
    // read from the registry rather than restated — a new sellable kind must not
    // need a second edit here to become visible.
    if (kind) where.push(eq(catalogItems.kind, kind));
    else where.push(inArray(catalogItems.kind, [...LISTING_KIND_IDS]));
    if (q) {
      where.push(sql`(${catalogItems.name} ILIKE ${`%${q}%`} OR ${catalogItems.summary} ILIKE ${`%${q}%`})`);
    }
    // The shop window. Cross-tenant by definition — `visibility = 'public'` is the
    // access predicate, not the shopper's own workspace. The call is inlined at
    // both statements rather than hoisted into a local: `where` already carries
    // the shared conditions, and a scope hidden behind a variable name is exactly
    // what the guard cannot read and a reviewer skims past.
    const rows = await db
      .select()
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue', ...where))
      .orderBy(desc(catalogItems.installCount), desc(catalogItems.publishedAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const [count] = await db
      .select({ total: sql<string>`count(*)` })
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue', ...where));
    return {
      listings: rows.map((row) => toView(row, row.body as ListingBody | null, false)),
      total: Number(count?.total ?? 0),
    };
  }, { kvTtlSeconds: LISTINGS_TTL_SECONDS });
}

/** One listing's public record, by slug. */
export async function getPublicListing(
  db: Db,
  env: Env,
  slug: string,
): Promise<CreationListingView | null> {
  return getOrSetCached(env, listingCacheKey(slug), async () => {
    const [row] = await db
      .select()
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue',
        eq(catalogItems.slug, slug), eq(catalogItems.visibility, 'public')))
      .limit(1);
    return row ? toView(row, row.body as ListingBody | null, false) : null;
  }, { kvTtlSeconds: LISTINGS_TTL_SECONDS });
}

/** Everything this seller has published, live or withdrawn. Not cached: it is the
 *  seller's own management view and must show a change the instant they make it. */
export async function sellerListings(
  db: Db,
  tenantId: number,
  userId: string,
): Promise<readonly CreationListingView[]> {
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.publisherRef, userId)))
    .orderBy(desc(catalogItems.updatedAt));
  return rows.map((row) => toView(row, row.body as ListingBody | null));
}

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

/** Project a listing row onto {@link ListingAccessFacts}. Exported so a caller
 *  that caches the inputs projects them the same way `launchListing` does. */
export function listingAccessFacts(row: CatalogRow): ListingAccessFacts {
  return {
    visibility: row.visibility,
    priceCents: row.priceCents,
    trial: (row.body as ListingBody | null)?.trial ?? null,
  };
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
 */
export function entitledToListing(facts: ListingAccessFacts, hasPaid: boolean): boolean {
  if (facts.visibility !== 'public') return hasPaid;
  const open = (facts.priceCents ?? 0) === 0 || facts.trial === 'full';
  return open || hasPaid;
}

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
  // Withdrawn: only the people who already own it may still run it. To everybody
  // else it is simply gone, which is what withdrawing it meant.
  if (row.visibility !== 'public' && !entitled) return null;
  const body = row.body as ListingBody | null;
  if (!body) return null;

  const spec = listingKindSpec(row.kind);
  const mode = body.launch ?? spec?.launch ?? 'preview';
  // A free listing, or one whose seller opened the trial, is entitled for everyone.
  // THE rule, called rather than restated — see `entitledToListing`. The
  // creator's own address asks this same function about this same listing.
  const allowed = entitledToListing(listingAccessFacts(row), entitled);

  // The buyer's pinned snapshot wins over the listing's current one. Only for a
  // caller who is actually entitled: an unpinned visitor asking for an old snapshot
  // id would otherwise be a way to read a superseded build of a paid listing.
  const payload = await publishedSnapshot(db, env, (allowed && heldSnapshotId) || body.snapshotId);
  if (!payload) return null;

  const base: LaunchPayload = { mode, entitled: allowed, title: payload.title };
  if (!allowed) {
    // The preview is the METADATA of the thing, never the thing. Returning the
    // objects "but with a flag" is how a paid product ends up in a network tab.
    return { ...base, mode: 'preview', objects: payload.objects.map((object) => ({
      id: object.id, kind: object.kind, canvasData: object.canvasData, content: null,
    })) };
  }

  if (mode === 'play') {
    return { ...base, document: gameDocument(payload) ?? undefined };
  }
  if (mode === 'open') {
    return { ...base, url: siteUrl(payload) ?? undefined };
  }
  return { ...base, objects: payload.objects };
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

/** A game's playable HTML, from the one card the listing is. */
function gameDocument(payload: ListingSnapshotPayload): string | null {
  for (const object of payload.objects) {
    const content = (object.content ?? {}) as Record<string, unknown>;
    const data = (object.canvasData ?? {}) as Record<string, unknown>;
    const doc = content.document ?? content.html ?? data.document ?? data.html;
    if (typeof doc === 'string' && doc.trim()) return doc;
  }
  return null;
}

/** A published site's live address. */
function siteUrl(payload: ListingSnapshotPayload): string | null {
  for (const object of payload.objects) {
    const data = (object.canvasData ?? {}) as Record<string, unknown>;
    const url = data.siteUrl ?? data.url;
    if (typeof url === 'string' && /^https:\/\//i.test(url)) return url;
  }
  return null;
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
