/**
 * EDGES BETWEEN OBJECTS — the `relations` primitive, and its first writer.
 *
 * ── WHY THIS EXISTS AND WHY IT IS GENERIC ────────────────────────────────────
 * `relations` shipped with PRD 20 and its own instruction on the table: "Ordered
 * join rows (a course's modules, a path's courses) are this table with a
 * position — not their own DDL (§3.3)." Until now nothing wrote to it, so every
 * feature that needed an ordered many-to-many kept reaching for a join table —
 * which is exactly the shape repetition the primitive was created to end.
 *
 * This module is the port that makes using it cheaper than not using it. It is
 * deliberately about OBJECTS and EDGES, and knows nothing about courses, paths or
 * tasks: the learning surface is its first consumer, and the second one must not
 * need to add a branch here.
 *
 * ── WHAT AN EDGE IS ──────────────────────────────────────────────────────────
 * A directed `(from, to)` pair with a `kind` and a `position`. Both endpoints are
 * real foreign keys into `objects`, so an edge cannot outlive what it points at —
 * the failure mode a `(subject_type, subject_id)` pair always eventually has.
 *
 * ── ORDER IS A PROPERTY OF THE EDGE, NOT OF THE TARGET ───────────────────────
 * `position` lives on the edge because the same course can sit third in one path
 * and first in another. Putting the order on the course would make those two
 * facts contradict each other, which is the update anomaly 3NF is about.
 *
 * ── ACYCLIC KINDS REFUSE AT WRITE TIME ───────────────────────────────────────
 * `depends_on` and `blocks` describe sequence, and a cycle in either is data that
 * cannot be read back — no first element, no topological order, no "what next".
 * {@link linkObjects} refuses such an edge rather than storing it; the arithmetic
 * is pure and lives in `domain/kernel/graphCycle.ts`.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * Reads are cached per (tenant, object, kind) and invalidated by every writer
 * here, on BOTH endpoints — an edge changes what two objects are related to, and
 * caching only the side that was named is how a stale reverse listing survives a
 * delete.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { objects, relations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { wouldCycle, type GraphEdge } from '../../domain/kernel/graphCycle';

/**
 * The edge vocabulary, as declared on the table.
 *
 * Open in the column (varchar) and closed here, which is the right split: the
 * DDL should not need a migration for a new edge kind, and a typo should not
 * quietly create one.
 */
export const RELATION_KINDS = [
  'depends_on', 'blocks', 'maps_to', 'overrides', 'contains', 'derived_from', 'duplicates',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Kinds that describe SEQUENCE, where a cycle is unreadable rather than merely
 *  odd. `contains` is absent on purpose: a containment loop is prevented by the
 *  self-edge check alone, and a diamond ("this lesson appears in two modules")
 *  is legitimate. */
const ACYCLIC_KINDS = new Set<RelationKind>(['depends_on', 'blocks']);

/** One edge, resolved to the object on the far end. Callers want the title and
 *  the ref far more often than the edge's own id, so the join is done here once
 *  rather than by every consumer. */
export interface RelatedObject {
  edgeId: number;
  objectId: string;
  kind: string;
  refId: string;
  domain: string;
  title: string | null;
  position: number;
  attrs: Record<string, unknown> | null;
}

export type RelationRefusal =
  | { ok: false; reason: 'would_cycle'; detail: string }
  | { ok: false; reason: 'unknown_object'; detail: string };

export const relationsCacheKey = (tenantId: number, id: string, kind: string, dir: 'from' | 'to') =>
  `kernel:relations:${tenantId}:${id}:${kind}:${dir}`;

/** Drop both directions of both endpoints. An edge is one fact about two
 *  objects, so a writer that invalidates one side leaves the other lying. */
async function invalidateEdge(env: Env, tenantId: number, fromId: string, toId: string, kind: string): Promise<void> {
  await Promise.all([
    invalidateCached(env, relationsCacheKey(tenantId, fromId, kind, 'from')),
    invalidateCached(env, relationsCacheKey(tenantId, toId, kind, 'to')),
    invalidateCached(env, relationsCacheKey(tenantId, fromId, kind, 'to')),
    invalidateCached(env, relationsCacheKey(tenantId, toId, kind, 'from')),
  ]);
}

/**
 * Create or update one edge.
 *
 * Upserts onto `uq_relations_edge`, so re-linking the same pair moves it rather
 * than failing — which is what makes a "set the members of this path" call able
 * to be written as a loop over the desired state instead of a diff.
 */
export async function linkObjects(
  db: Db, env: Env,
  input: {
    tenantId: number; fromId: string; toId: string; kind: RelationKind;
    position?: number; attrs?: Record<string, unknown> | null;
  },
): Promise<{ ok: true; edgeId: number } | RelationRefusal> {
  if (ACYCLIC_KINDS.has(input.kind)) {
    const existing = await loadEdges(db, input.tenantId, input.kind);
    if (wouldCycle(existing, input.fromId, input.toId)) {
      return {
        ok: false,
        reason: 'would_cycle',
        detail: input.fromId === input.toId
          ? 'an object cannot depend on itself'
          : 'that edge closes a loop, and a loop has no first step',
      };
    }
  }

  const [row] = await db.insert(relations).values({
    tenantId: input.tenantId,
    fromId: input.fromId,
    toId: input.toId,
    kind: input.kind,
    position: input.position ?? 0,
    attrs: (input.attrs ?? null) as never,
  }).onConflictDoUpdate({
    target: [relations.tenantId, relations.fromId, relations.toId, relations.kind],
    set: { position: input.position ?? 0, attrs: (input.attrs ?? null) as never, updatedAt: new Date() },
  }).returning({ id: relations.id });

  if (!row) throw new Error('linkObjects: no edge returned');
  await invalidateEdge(env, input.tenantId, input.fromId, input.toId, input.kind);
  return { ok: true, edgeId: Number(row.id) };
}

/** Remove one edge. Idempotent — unlinking what is already unlinked is a
 *  successful no-op, not an error a caller has to special-case. */
export async function unlinkObjects(
  db: Db, env: Env, tenantId: number, fromId: string, toId: string, kind: RelationKind,
): Promise<boolean> {
  const removed = await db.delete(relations)
    .where(scopedToTenant(relations, tenantId, and(
      eq(relations.fromId, fromId),
      eq(relations.toId, toId),
      eq(relations.kind, kind),
    )!))
    .returning({ id: relations.id });

  await invalidateEdge(env, tenantId, fromId, toId, kind);
  return removed.length > 0;
}

/**
 * Replace the ordered members of `fromId` with exactly `toIds`, in that order.
 *
 * One delete and one insert rather than a read-diff-write: the desired state is
 * what the caller has, and computing a diff in the isolate only to send both
 * halves anyway adds a round trip and a race. Positions are the array indices, so
 * they are dense and gapless by construction — a reorder can never leave two
 * members claiming slot 3.
 */
export async function setOrderedMembers(
  db: Db, env: Env,
  input: { tenantId: number; fromId: string; kind: RelationKind; toIds: string[] },
): Promise<{ ok: true; count: number } | RelationRefusal> {
  const seen = new Set<string>();
  const ordered = input.toIds.filter((id) => id !== input.fromId && !seen.has(id) && seen.add(id));

  if (ordered.length > 0) {
    const known = await db.select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.tenantId, input.tenantId), inArray(objects.id, ordered)));
    if (known.length !== ordered.length) {
      // A missing id is almost always another tenant's object rather than a
      // typo, and inserting it would fail on the foreign key with a message
      // that says nothing about which one.
      return { ok: false, reason: 'unknown_object', detail: 'one or more members are not objects in this workspace' };
    }
  }

  const previous = await db.select({ toId: relations.toId })
    .from(relations)
    .where(scopedToTenant(relations, input.tenantId, and(
      eq(relations.fromId, input.fromId),
      eq(relations.kind, input.kind),
    )!));

  await db.delete(relations).where(scopedToTenant(relations, input.tenantId, and(
    eq(relations.fromId, input.fromId),
    eq(relations.kind, input.kind),
  )!));

  if (ordered.length > 0) {
    await db.insert(relations).values(ordered.map((toId, index) => ({
      tenantId: input.tenantId,
      fromId: input.fromId,
      toId,
      kind: input.kind,
      position: index,
    })));
  }

  const touched = new Set([...previous.map((r) => r.toId), ...ordered]);
  await Promise.all([
    invalidateCached(env, relationsCacheKey(input.tenantId, input.fromId, input.kind, 'from')),
    ...[...touched].map((id) => invalidateCached(env, relationsCacheKey(input.tenantId, id, input.kind, 'to'))),
  ]);
  return { ok: true, count: ordered.length };
}

/** What `fromId` points AT, in `position` order — a path's courses, a course's
 *  prerequisites. Cached; `idx_relations_from` covers it. */
export async function listRelatedFrom(
  db: Db, env: Env, tenantId: number, fromId: string, kind: RelationKind,
): Promise<RelatedObject[]> {
  return getOrSetCached(env, relationsCacheKey(tenantId, fromId, kind, 'from'), () =>
    queryRelated(db, tenantId, 'from', fromId, kind));
}

/** What points AT `toId` — "which paths include this course". Cached;
 *  `idx_relations_to` covers it. */
export async function listRelatedTo(
  db: Db, env: Env, tenantId: number, toId: string, kind: RelationKind,
): Promise<RelatedObject[]> {
  return getOrSetCached(env, relationsCacheKey(tenantId, toId, kind, 'to'), () =>
    queryRelated(db, tenantId, 'to', toId, kind));
}

/** Every edge of one kind in the tenant, as plain pairs — what the cycle check
 *  folds over. Not cached: its only caller is a WRITE, and a write that decides
 *  on a stale graph is the one case where staleness costs correctness. */
export async function loadEdges(db: Db, tenantId: number, kind: RelationKind): Promise<GraphEdge[]> {
  const rows = await db.select({ from: relations.fromId, to: relations.toId })
    .from(relations)
    .where(scopedToTenant(relations, tenantId, eq(relations.kind, kind))!);
  return rows;
}

/** `direction` says which END the caller holds: 'from' walks the edge forward
 *  (a path's courses), 'to' walks it back (the paths a course appears in). The
 *  two differ only in which column is matched and which is joined, so they are
 *  one query rather than two that can drift. */
async function queryRelated(
  db: Db, tenantId: number, direction: 'from' | 'to', value: string, kind: RelationKind,
): Promise<RelatedObject[]> {
  const near = direction === 'from' ? relations.fromId : relations.toId;
  const far = direction === 'from' ? relations.toId : relations.fromId;
  const rows = await db.select({
    edgeId: relations.id,
    objectId: objects.id,
    kind: objects.kind,
    refId: objects.refId,
    domain: objects.domain,
    title: objects.title,
    position: relations.position,
    attrs: relations.attrs,
  })
    .from(relations)
    .innerJoin(objects, eq(objects.id, far))
    .where(scopedToTenant(relations, tenantId, and(
      eq(near, value),
      eq(relations.kind, kind),
    )!))
    .orderBy(asc(relations.position), asc(relations.id));

  return rows.map((r) => ({
    edgeId: Number(r.edgeId),
    objectId: r.objectId,
    kind: r.kind,
    refId: r.refId,
    domain: r.domain,
    title: r.title,
    position: r.position,
    attrs: (r.attrs ?? null) as Record<string, unknown> | null,
  }));
}

/**
 * How many edges of one kind each of these objects has, in ONE query.
 *
 * The alternative — asking per object while rendering a list — is the N+1 a
 * directory page always eventually grows. Returns a Map so a missing key reads
 * as zero rather than undefined.
 */
export async function countRelatedFrom(
  db: Db, tenantId: number, fromIds: string[], kind: RelationKind,
): Promise<Map<string, number>> {
  if (fromIds.length === 0) return new Map();
  const rows = await db.select({ fromId: relations.fromId, n: sql<string>`count(*)` })
    .from(relations)
    .where(scopedToTenant(relations, tenantId, and(
      inArray(relations.fromId, fromIds),
      eq(relations.kind, kind),
    )!))
    .groupBy(relations.fromId);
  return new Map(rows.map((r) => [r.fromId, Number(r.n)]));
}
