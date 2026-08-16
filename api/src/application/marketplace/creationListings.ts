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
  declaredLimits,
  isListingKind,
  isPublishable,
  isPublishableObjectKind,
  isStrippedListingField,
  listingKindSpec,
  listingKindsForObjectKind,
  resolveDelivery,
  resolveListingAccess,
  resolveTrialPolicy,
  sessionListingKinds,
  SNAPSHOT_REASON_PUBLICATION,
  SNAPSHOT_REASON_STAGE,
  type ListingDelivery,
  type ListingLaunchMode,
  type ListingTrialPolicy,
  type MarketplaceListingKindSpec,
  type StageCheck,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  catalogItems,
  creationSessionMembers,
  creationSessionObjects,
  creationSessionProjectLinks,
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
import { liveUrl, runStageChecks, runnableDocument, type StageObject } from './stageChecks';
import { deploymentProbe, watchHostedListing } from './stageChecks.probe';
import {
  hostedListingStatus,
  isHostedListing,
  recordHostedProbe,
  recordHostedWithdrawal,
  type HostedListingStatus,
} from './creationListings.hosted';

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
const LISTINGS_VERSION_KEY = 'marketplace:creations:list';
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
  /** What the buyer receives: the thing (`copy`), or access to it (`hosted`). */
  delivery: ListingDelivery;
  icon: string;
  installCount: number;
  rating: number | null;
  publishedAtISO: string | null;
  updatedAtISO: string;
  sellerRef: string | null;
  sellerName: string | null;
  /**
   * Limits Stage found and the seller shipped with — on the PUBLIC projection too.
   *
   * The inherited rule, made structural: a limitation a seller learns in Stage is
   * DECLARED on the listing rather than discovered by the buyer. Present on the
   * public card and the public detail read, because a disclosure only the seller can
   * see is not a disclosure.
   */
  declared: readonly StageCheck[];
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
  /**
   * What the buyer receives.
   *
   * STORED rather than re-derived from the kind on every read, because the kind
   * declares what a listing MAY offer and the seller chooses from that set — an `app`
   * can be sold either way, and a listing that re-derived its own delivery would
   * silently become whichever one happens to be first in the registry. It is also the
   * fact the deployment harness selects on, and the fact the hosted-lifecycle sweep
   * finds its work by.
   */
  delivery: ListingDelivery;
  seller: { userId: string; name: string | null };
  /**
   * The warnings the staged build carried when it went on sale.
   *
   * Written at publish, from the checks run over the PROMOTED snapshot — so it
   * describes the build a buyer receives rather than whatever the seller's board says
   * today. Absent on rows published before this existed, which read as "nothing
   * declared" rather than as an error.
   */
  declared?: StageCheck[];
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
  /**
   * Which door this listing opens. Validated against the kind's `deliveries`, so a
   * client cannot sell a book as a subscription no matter what it posts.
   */
  delivery?: string | null;
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
  /** Resolved once here, so the panel, the harness and the buy button agree. */
  delivery: ListingDelivery;
  /**
   * The project this board IS, when it is one.
   *
   * Read from the `app` link rather than taken from the client: that link is the
   * operator decision "the project IS the app" written down (migration 0473), and it
   * is the only fact that lets a hosted listing be put under the platform's standing
   * deployment watch. Null for every board that has not been converted, which is
   * every `copy` listing and is not an error.
   */
  projectId: number | null;
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
  // The KIND is the authority on what may be offered; the seller picks from that set.
  // Resolved once, here, and carried on the target — the harness selects on it, the
  // body stores it and the buy button reads it, and three derivations of one choice
  // is how a listing offers a subscription to something nobody is running.
  const delivery = resolveDelivery(spec.id, input.delivery ?? null);

  const existing = input.listingId
    ? (await db.select().from(catalogItems)
        .where(and(eq(catalogItems.id, input.listingId), eq(catalogItems.tenantId, input.tenantId)))
        .limit(1))[0] ?? null
    : null;
  if (input.listingId && !existing) throw new ListingError('Listing not found', 404);
  if (existing && existing.publisherRef !== input.userId) {
    throw new ListingError('Only the publisher can update this listing', 403);
  }

  // Only a HOSTED listing has anything to do with a project, so only a hosted publish
  // pays for the lookup — an extra round-trip on every book and every pack to answer
  // a question none of them ask is the kind of cost that never shows up in one trace
  // and always shows up in the bill.
  const [appLink] = delivery === 'hosted'
    ? await db
        .select({ projectId: creationSessionProjectLinks.projectId })
        .from(creationSessionProjectLinks)
        .where(and(
          eq(creationSessionProjectLinks.sessionId, input.sessionId),
          eq(creationSessionProjectLinks.linkKind, 'app'),
        ))
        .limit(1)
    : [];

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
    delivery,
    projectId: appLink?.projectId ?? null,
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
 *
 * ── THE GATE RUNS HERE, NOT ONLY IN THE PANEL ────────────────────────────────────
 * The Releases panel already refuses to publish while a blocker stands. That is the
 * seller's experience of the rule, and it is not the rule: a panel is a client, and a
 * gate that only exists in a client is a gate a different client does not have. So
 * the checks run again over the payload ACTUALLY BEING PUBLISHED and refuse it here.
 * It is also the only place the promoted build is in hand — a seller may stage v1.3,
 * edit a card, and publish without restaging.
 *
 * Every WARNING those checks produced is written onto the listing (`declared`), so
 * the limits the seller was shown are the limits the buyer reads.
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

  const checks = await runStageChecks({
    listingKind: spec.id,
    objectKind,
    objects: (payload.objects ?? []) as readonly StageObject[],
    priceCents: target.priceCents,
    trial: target.trial,
    delivery: target.delivery,
    strippedFields: payload.strippedFields ?? [],
    probe: deploymentProbe(db, env),
  });
  if (!isPublishable(checks)) {
    // 409 rather than 400: the request is well-formed and the seller is entitled to
    // make it — the CREATION is not ready. The panel shows the findings; the message
    // names the first one so a caller without a panel is not told merely "no".
    const first = checks.find((entry) => entry.severity === 'block');
    throw new ListingError(
      `This cannot go on sale yet — ${first?.label ?? 'a check refused it'}`,
      409,
    );
  }

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
    delivery: target.delivery,
    seller: { userId: input.userId, name: target.sellerName },
    declared: [...declaredLimits(checks)],
  };

  const row = await writeListingRow(db, input, target, body, {
    visibility: 'public',
    // A previously-PUBLISHED listing bumps; one that has only ever existed as a
    // staged draft starts at 1.0.0 on its first real publish rather than inheriting
    // the number its candidates were staged under.
    version: existing?.publishedAt ? bumpVersion(existing.version) : '1.0.0',
  });

  // A hosted listing that just went on sale is now something strangers depend on, so
  // it joins the standing watch — and its lifecycle clock is seeded from the probe
  // that just passed rather than from the first sweep to notice it hours later.
  // Re-publishing an existing hosted listing re-opens its shop window too.
  if (target.delivery === 'hosted') {
    const address = liveUrl(payload.objects as readonly StageObject[]);
    await Promise.all([
      recordHostedProbe(db, env, {
        tenantId: input.tenantId, listingId: row.id, url: address, ok: true,
      }),
      recordHostedWithdrawal(db, env, {
        tenantId: input.tenantId, listingId: row.id, withdrawn: false,
      }),
      address && target.projectId != null
        ? watchHostedListing(db, {
            tenantId: input.tenantId,
            projectId: target.projectId,
            projectName: name,
            deployedUrl: address,
          })
        : Promise.resolve(),
    ]);
  }

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

/**
 * Take a listing off the public catalogue.
 *
 * ── WHAT WITHDRAWING MEANS, FOR EACH OF THE TWO DELIVERIES ───────────────────────
 * The row and every sold snapshot stay. For a `copy` that settles it: the buyer holds
 * their own cards on their own board, `resolveListingAccess` keeps letting them
 * through on their licence, and the seller can never reach them again. Withdrawal is
 * a decision to stop SELLING and nothing more.
 *
 * For a `hosted` listing the same sentence is only half of one, because what the
 * buyer holds is ACCESS to an instance THE SELLER RUNS. Withdrawal still means the
 * storefront closes and existing subscribers keep working — but nothing here can make
 * the seller keep a cloud bill paid, so the platform records WHEN the shop window
 * closed and the hosted lifecycle (`creationListings.hosted.ts`) governs what
 * subscribers are owed if the address later goes dark. Explicitly NOT the same
 * timestamp: withdrawing is not abandoning, and starting an abandonment clock against
 * a seller who is still serving would be wrong on both facts.
 */
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
    .returning({ slug: catalogItems.slug, body: catalogItems.body });
  if (!row) throw new ListingError('Listing not found', 404);
  if (isHostedListing(row.body as ListingBody | null)) {
    await recordHostedWithdrawal(db, env, { tenantId, listingId, withdrawn: true });
  }
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
    // A row published before `delivery` was stored falls back to what its kind
    // declares first, which is the value `resolveDelivery` would have chosen for it.
    delivery: resolveDelivery(row.kind, body?.delivery ?? null),
    declared: body?.declared ?? [],
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
