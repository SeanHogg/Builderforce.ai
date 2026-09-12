/**
 * Reading the SELLER'S BOARD — what on it could be sold, and the binding-stripped
 * payload a snapshot is taken from. Split out of `../creationListings.ts`, which
 * re-exports the public names.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  isPublishableObjectKind,
  isStrippedListingField,
  listingKindsForObjectKind,
  sessionListingKinds,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../../infrastructure/database/connection';
import {
  catalogItems,
  creationSessionObjects,
  creationSessions,
} from '../../../infrastructure/database/schema';
import {
  ListingError,
  type ListingBody,
  type ListingSnapshotPayload,
  type PublishCandidate,
} from './model';

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
