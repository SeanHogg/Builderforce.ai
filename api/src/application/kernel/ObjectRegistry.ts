/**
 * The kernel application service (PRD 20 §6.3).
 *
 * One route group per domain, and **the kernel exposed once rather than fifteen
 * times**:
 *
 *   /api/objects/:id                 resolve any addressable thing
 *   /api/objects/:id/activity        one timeline endpoint, not one per subsystem
 *   /api/objects/:id/annotations
 *   /api/objects/:id/members
 *   /api/objects/:id/shares
 *   /api/objects/:id/revisions
 *
 * Every one of those exists today between six and forty times under different
 * names. The reason they could not be unified before is that there was nothing
 * for a generic endpoint to address: `objects` is what makes `(kind, id)` a real
 * foreign key, so a single handler can resolve a task, an artifact, a deal and a
 * candidate without a switch statement per subsystem.
 *
 * LAYER CONTRACT (§6.1). This file is the APPLICATION layer: use cases, ports,
 * tenancy enforcement, cache keys and invalidation. It knows nothing about HTTP —
 * no request shapes, no status codes, no Hono. The route group above it parses,
 * authorises, calls one function here, and serialises.
 *
 * THE PORT. `createObjectRegistry(db, env)` binds the connection once and returns
 * the use cases. Route files take THAT and never see `Db`, `Env` or a table name
 * — which is how `check-layering.mjs` stays at its baseline instead of growing by
 * two: §5 step 6's exit criterion is that baseline at zero, and a new file added
 * to it is moving the wrong way. `src/index.ts` sits outside the presentation
 * layer and is where the two halves are joined.
 *
 * CACHING. §6.3 states the rule and this is where it becomes enforceable: a new
 * read endpoint must either be served through `getOrSetCached` or say why it
 * cannot. The kernel finally makes that mechanical, because the cache key derives
 * from `(tenant, domain, object)` rather than from whichever table a feature
 * happened to invent. Writes invalidate the keys they touch — every mutation
 * below ends in an `invalidate…` call rather than leaving the reader to notice.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  activityLog,
  annotations,
  memberships,
  objects,
  revisions,
  shareLinks,
} from '../../infrastructure/database/schema';
import { sha256Hex } from '../../domain/shared/hash';
import type { Env } from '../../env';

/**
 * The seats on the roster (PRD 20 §3). The schema's domain column, the permission
 * module's `domain`, and the navigation's surface list are the same list, and §7 says
 * neither may drift from the other — so it is declared once.
 *
 * `operations` is the sixteenth, and the first added since the roster was drawn. Every
 * one of the original fifteen models how a company runs ITSELF; none modelled what it
 * DOES for the customer who pays it — the job, the asset, the visit, the part, the
 * certificate. That is fine for a horizontal SaaS whose product is the software, and
 * fatal for the verticals most companies actually are. `delivery` is the software
 * backlog and `support` is the ticket about the work, so neither could absorb it
 * without meaning something else. See `schema/operations.ts`.
 *
 * `legal` is the seventeenth, and it was added because a whole PHASE of a
 * company's life had no owner. `governance` belongs to Security and means SOC 2 —
 * controls, findings, policies, evidence: the compliance posture of a company
 * that already exists. Incorporating one, appointing a registered agent,
 * qualifying to trade in a second state, assigning the founders' IP and filing a
 * mark are none of those, and they are the first ninety days. Filing them under
 * `governance` would make that seat mean two things, which is exactly what a
 * bounded context refuses. See `schema/legal.ts`.
 */
export const DOMAINS = [
  'growth', 'delivery', 'agents', 'hiring', 'finance', 'revenue', 'commerce',
  'identity', 'people', 'platform', 'governance', 'investor', 'support',
  'canvas', 'integrations', 'operations', 'legal',
] as const;
export type Domain = (typeof DOMAINS)[number];

export function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

/** The kernel relations a caller can ask an object for. One list, so the route
 *  group, the OpenAPI description and the client all read the same set. */
export const OBJECT_RELATIONS = ['activity', 'annotations', 'members', 'shares', 'revisions'] as const;
export type ObjectRelation = (typeof OBJECT_RELATIONS)[number];

export type ObjectRef = {
  id: string;
  tenantId: number | null;
  kind: string;
  refId: string;
  domain: string;
  title: string | null;
  parentId: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
};

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Bound every list read. An unbounded result set is a performance
 *  anti-pattern the platform rejects outright, and a generic endpoint is exactly
 *  where one arrives unnoticed. */
function pageSize(requested?: number): number {
  if (!requested || requested < 1) return PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

// ---------------------------------------------------------------------------
// Cache keys — derived from (tenant, object), never from a feature's own table
// ---------------------------------------------------------------------------

export const objectCacheKey = (tenantId: number, id: string) => `kernel:object:${tenantId}:${id}`;
export const relationCacheKey = (tenantId: number, id: string, rel: ObjectRelation) =>
  `kernel:object:${tenantId}:${id}:${rel}`;
export const recentsCacheKey = (tenantId: number, actorRef: string, domain: string) =>
  `kernel:recents:${tenantId}:${actorRef}:${domain}`;

/** Drop every cached read for one object. Called by each mutation below, and
 *  exported so a domain service that writes the underlying row can say so too. */
export async function invalidateObject(env: Env, tenantId: number, id: string): Promise<void> {
  await Promise.all([
    invalidateCached(env, objectCacheKey(tenantId, id)),
    ...OBJECT_RELATIONS.map((rel) => invalidateCached(env, relationCacheKey(tenantId, id, rel))),
  ]);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a domain row in the registry, or return the existing entry.
 *
 * Idempotent on `(tenantId, kind, refId)` — a domain service calls this on every
 * write without needing to know whether it has registered before, which is what
 * keeps registration from becoming a step somebody forgets.
 */
export async function registerObject(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    kind: string;
    refId: string | number;
    domain: Domain;
    title?: string | null;
    parentId?: string | null;
  },
): Promise<ObjectRef> {
  const refId = String(input.refId);
  const [row] = await db
    .insert(objects)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      refId,
      domain: input.domain,
      title: input.title ?? null,
      parentId: input.parentId ?? null,
    })
    .onConflictDoUpdate({
      target: [objects.tenantId, objects.kind, objects.refId],
      // Re-registering is how a rename reaches the registry, and `updatedAt` is
      // what makes "what did I touch" derivable (§7) rather than a stored list.
      set: { title: input.title ?? null, parentId: input.parentId ?? null, updatedAt: new Date() },
    })
    .returning();

  if (!row) throw new Error(`registerObject: no row returned for ${input.kind}:${refId}`);
  await invalidateObject(env, input.tenantId, row.id);
  return row as ObjectRef;
}

/** Resolve an object by its registry id. Tenant-scoped: an id from another
 *  tenant resolves to null rather than to somebody else's row. */
export async function getObject(db: Db, env: Env, tenantId: number, id: string): Promise<ObjectRef | null> {
  return getOrSetCached(env, objectCacheKey(tenantId, id), async () => {
    const [row] = await db
      .select()
      .from(objects)
      .where(and(eq(objects.id, id), eq(objects.tenantId, tenantId)))
      .limit(1);
    return (row as ObjectRef | undefined) ?? null;
  });
}

/** Resolve the registry entry for a domain row, without knowing its id. */
export async function findObject(
  db: Db,
  tenantId: number,
  kind: string,
  refId: string | number,
): Promise<ObjectRef | null> {
  const [row] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), eq(objects.kind, kind), eq(objects.refId, String(refId))))
    .limit(1);
  return (row as ObjectRef | undefined) ?? null;
}

/**
 * The breadcrumb trail, root first.
 *
 * One recursive CTE rather than a loop of point reads — a five-deep breadcrumb
 * would otherwise be five round trips, per request, on every detail page.
 */
export async function getObjectTrail(db: Db, env: Env, tenantId: number, id: string): Promise<ObjectRef[]> {
  return getOrSetCached(env, `${objectCacheKey(tenantId, id)}:trail`, async () => {
    const rows = await db.execute(sql`
      WITH RECURSIVE trail AS (
        SELECT o.* FROM objects o WHERE o.id = ${id} AND o.tenant_id = ${tenantId}
        UNION ALL
        SELECT p.* FROM objects p JOIN trail t ON p.id = t.parent_id
      )
      SELECT * FROM trail
    `);
    const list = (rows as unknown as { rows?: ObjectRef[] }).rows ?? (rows as unknown as ObjectRef[]);
    return [...list].reverse();
  });
}

/**
 * "What did I touch" — derived, never a stored list (PRD 20 §7).
 *
 * Only possible because `objects` and `activity_log` both exist: one query
 * answers it, where today it would need a union across thirty tables and would
 * silently miss the thirty-first.
 */
export async function getRecents(
  db: Db,
  env: Env,
  tenantId: number,
  actorRef: string,
  opts: { domain?: Domain; limit?: number } = {},
): Promise<ObjectRef[]> {
  const limit = pageSize(opts.limit);
  return getOrSetCached(
    env,
    `${recentsCacheKey(tenantId, actorRef, opts.domain ?? 'all')}:${limit}`,
    async () => {
      const where = [
        eq(activityLog.tenantId, tenantId),
        eq(activityLog.actorRef, actorRef),
        isNull(objects.archivedAt),
      ];
      if (opts.domain) where.push(eq(objects.domain, opts.domain));

      const rows = await db
        .selectDistinctOn([objects.id], {
          id: objects.id,
          tenantId: objects.tenantId,
          kind: objects.kind,
          refId: objects.refId,
          domain: objects.domain,
          title: objects.title,
          parentId: objects.parentId,
          archivedAt: objects.archivedAt,
          updatedAt: objects.updatedAt,
        })
        .from(activityLog)
        .innerJoin(objects, eq(activityLog.objectId, objects.id))
        .where(and(...where))
        .orderBy(objects.id, desc(activityLog.occurredAt))
        .limit(limit);
      return rows as ObjectRef[];
    },
    { l1TtlMs: 15_000 },
  );
}

// ---------------------------------------------------------------------------
// The five relations
// ---------------------------------------------------------------------------

/** One timeline endpoint, instead of a per-subsystem feed (§7.1). */
export async function getObjectActivity(db: Db, env: Env, tenantId: number, id: string, limit?: number) {
  const take = pageSize(limit);
  return getOrSetCached(env, `${relationCacheKey(tenantId, id, 'activity')}:${take}`, async () => {
    return db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.objectId, id), eq(activityLog.tenantId, tenantId)))
      .orderBy(desc(activityLog.occurredAt))
      .limit(take);
  });
}

/** One comment thread, mountable anywhere (§7.1). */
export async function getObjectAnnotations(
  db: Db,
  env: Env,
  tenantId: number,
  id: string,
  opts: { kind?: string; limit?: number } = {},
) {
  const take = pageSize(opts.limit);
  const key = `${relationCacheKey(tenantId, id, 'annotations')}:${opts.kind ?? 'all'}:${take}`;
  return getOrSetCached(env, key, async () => {
    const where = [
      eq(annotations.objectId, id),
      eq(annotations.tenantId, tenantId),
      isNull(annotations.deletedAt),
    ];
    if (opts.kind) where.push(eq(annotations.kind, opts.kind));
    return db.select().from(annotations).where(and(...where)).orderBy(desc(annotations.createdAt)).limit(take);
  });
}

export async function addAnnotation(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    objectId: string;
    kind?: string;
    authorKind?: string;
    authorRef?: string | null;
    authorName?: string | null;
    body?: string | null;
    value?: string | null;
    label?: string | null;
    anchor?: unknown;
    parentId?: number | null;
  },
) {
  const [row] = await db
    .insert(annotations)
    .values({
      tenantId: input.tenantId,
      objectId: input.objectId,
      kind: input.kind ?? 'comment',
      authorKind: input.authorKind ?? 'user',
      authorRef: input.authorRef ?? null,
      authorName: input.authorName ?? null,
      body: input.body ?? null,
      value: input.value ?? null,
      label: input.label ?? null,
      anchor: (input.anchor ?? null) as never,
      parentId: input.parentId ?? null,
    })
    .returning();
  await invalidateObject(env, input.tenantId, input.objectId);
  return row;
}

/** Who is on this thing. `state` is never deleted — who WAS on a thing is the
 *  question an audit asks. */
export async function getObjectMembers(db: Db, env: Env, tenantId: number, id: string, limit?: number) {
  const take = pageSize(limit);
  return getOrSetCached(env, `${relationCacheKey(tenantId, id, 'members')}:${take}`, async () => {
    return db
      .select()
      .from(memberships)
      .where(and(eq(memberships.objectId, id), eq(memberships.tenantId, tenantId), eq(memberships.state, 'active')))
      .orderBy(memberships.role, memberships.memberRef)
      .limit(take);
  });
}

export async function addMember(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    objectId: string;
    memberKind: string;
    memberRef: string;
    role?: string;
  },
) {
  const [row] = await db
    .insert(memberships)
    .values({
      tenantId: input.tenantId,
      objectId: input.objectId,
      memberKind: input.memberKind,
      memberRef: input.memberRef,
      role: input.role ?? 'member',
      joinedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.objectId, memberships.memberKind, memberships.memberRef],
      // Re-adding somebody who left is a rejoin, not a duplicate row.
      set: { state: 'active', role: input.role ?? 'member', updatedAt: new Date() },
    })
    .returning();
  await invalidateObject(env, input.tenantId, input.objectId);
  return row;
}

export async function removeMember(
  db: Db,
  env: Env,
  input: { tenantId: number; objectId: string; memberKind: string; memberRef: string },
) {
  await db
    .update(memberships)
    .set({ state: 'removed', updatedAt: new Date() })
    .where(and(
      eq(memberships.tenantId, input.tenantId),
      eq(memberships.objectId, input.objectId),
      eq(memberships.memberKind, input.memberKind),
      eq(memberships.memberRef, input.memberRef),
    ));
  await invalidateObject(env, input.tenantId, input.objectId);
}

/**
 * One share sheet with ONE revocation path (§7.1).
 *
 * The token is returned exactly once, at creation, and only its hash is stored —
 * there are three independent API-key revocation paths in this repo today, and
 * each is a place a revoked token can keep working because somebody fixed only
 * the other two.
 */
export async function getObjectShares(db: Db, env: Env, tenantId: number, id: string) {
  return getOrSetCached(env, relationCacheKey(tenantId, id, 'shares'), async () => {
    return db
      .select({
        id: shareLinks.id,
        scope: shareLinks.scope,
        expiresAt: shareLinks.expiresAt,
        maxUses: shareLinks.maxUses,
        useCount: shareLinks.useCount,
        lastUsedAt: shareLinks.lastUsedAt,
        revokedAt: shareLinks.revokedAt,
        createdBy: shareLinks.createdBy,
        createdAt: shareLinks.createdAt,
      })
      .from(shareLinks)
      .where(and(eq(shareLinks.objectId, id), eq(shareLinks.tenantId, tenantId), isNull(shareLinks.revokedAt)))
      .orderBy(desc(shareLinks.createdAt))
      .limit(MAX_PAGE_SIZE);
  });
}

/** SHA-256, matching the hash-only rule the one-time-code store already applies. */
const hashToken = sha256Hex;

export async function createShareLink(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    objectId: string;
    scope?: 'view' | 'comment' | 'edit';
    expiresAt?: Date | null;
    maxUses?: number | null;
    createdBy?: string | null;
  },
): Promise<{ id: string; token: string }> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const [row] = await db
    .insert(shareLinks)
    .values({
      tenantId: input.tenantId,
      objectId: input.objectId,
      tokenHash: await hashToken(token),
      scope: input.scope ?? 'view',
      expiresAt: input.expiresAt ?? null,
      maxUses: input.maxUses ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: shareLinks.id });
  await invalidateObject(env, input.tenantId, input.objectId);
  if (!row) throw new Error('createShareLink: no row returned');
  // The only time the raw token exists. Never stored, never returned again.
  return { id: row.id, token };
}

/** THE revocation path. Not one of three. */
export async function revokeShareLink(db: Db, env: Env, tenantId: number, objectId: string, shareId: string) {
  await db
    .update(shareLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(shareLinks.id, shareId), eq(shareLinks.tenantId, tenantId)));
  await invalidateObject(env, tenantId, objectId);
}

/**
 * Resolve a raw share token to the object it grants access to.
 *
 * One expiry policy and one use-count check, applied here so a caller cannot
 * accidentally honour an expired link by forgetting one of the three conditions.
 * Deliberately NOT cached: a revocation has to take effect on the next request,
 * and a cache is how a revoked link keeps working for a TTL.
 */
export async function resolveShareToken(
  db: Db,
  token: string,
): Promise<{ tenantId: number; objectId: string; scope: string } | null> {
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, await hashToken(token)))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt <= new Date()) return null;
  if (row.maxUses != null && row.useCount >= row.maxUses) return null;

  // Scoped by the tenant the row itself reported, not by one the caller supplied —
  // a share token has no session and therefore no tenant context, which is the
  // one place `check-tenant-scope.mjs` has a documented exception rather than a
  // missing predicate. The SELECT above cannot be scoped for the same reason: the
  // token IS the credential, so it is looked up globally and every access
  // condition (revoked, expired, exhausted) is applied here, in one place, so no
  // caller can honour a dead link by forgetting one of the three.
  await db
    .update(shareLinks)
    .set({ useCount: row.useCount + 1, lastUsedAt: new Date() })
    .where(and(eq(shareLinks.id, row.id), eq(shareLinks.tenantId, row.tenantId)));
  return { tenantId: row.tenantId, objectId: row.objectId, scope: row.scope };
}

/** Version history for anything versionable. */
export async function getObjectRevisions(db: Db, env: Env, tenantId: number, id: string, limit?: number) {
  const take = pageSize(limit);
  return getOrSetCached(env, `${relationCacheKey(tenantId, id, 'revisions')}:${take}`, async () => {
    return db
      .select({
        id: revisions.id,
        version: revisions.version,
        label: revisions.label,
        authorRef: revisions.authorRef,
        summary: revisions.summary,
        byteSize: revisions.byteSize,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .where(and(eq(revisions.objectId, id), eq(revisions.tenantId, tenantId)))
      .orderBy(desc(revisions.version))
      .limit(take);
  });
}

export async function recordRevision(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    objectId: string;
    label?: string | null;
    authorRef?: string | null;
    summary?: string | null;
    patch?: unknown;
    snapshotKey?: string | null;
    byteSize?: number | null;
  },
) {
  // Next version, computed in the statement rather than read-then-write: two
  // concurrent saves would otherwise both compute the same number and one would
  // lose its history to the unique index.
  const [row] = await db
    .insert(revisions)
    .values({
      tenantId: input.tenantId,
      objectId: input.objectId,
      version: sql`(SELECT COALESCE(MAX(r.version), 0) + 1 FROM revisions r WHERE r.object_id = ${input.objectId})`,
      label: input.label ?? null,
      authorRef: input.authorRef ?? null,
      summary: input.summary ?? null,
      patch: (input.patch ?? null) as never,
      snapshotKey: input.snapshotKey ?? null,
      byteSize: input.byteSize ?? null,
    })
    .returning();
  await invalidateObject(env, input.tenantId, input.objectId);
  return row;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * Bind the connection and the environment once, and hand the presentation layer
 * a set of use cases instead of a database.
 *
 * Dependency inversion, which §6.2 records as already being the house pattern —
 * `DriveProvider`, `MailboxProvider`, `BoardProvider`, `PolicyGate` are all ports
 * with swappable adapters. The rule it states is the one applied here: the
 * application layer chooses the adapter, and the layer above depends on the
 * interface.
 */
export function createObjectRegistry(db: Db, env: Env) {
  return {
    get: (tenantId: number, id: string) => getObject(db, env, tenantId, id),
    find: (tenantId: number, kind: string, refId: string | number) => findObject(db, tenantId, kind, refId),
    trail: (tenantId: number, id: string) => getObjectTrail(db, env, tenantId, id),
    recents: (tenantId: number, actorRef: string, opts?: { domain?: Domain; limit?: number }) =>
      getRecents(db, env, tenantId, actorRef, opts),
    register: (input: Parameters<typeof registerObject>[2]) => registerObject(db, env, input),

    activity: (tenantId: number, id: string, limit?: number) => getObjectActivity(db, env, tenantId, id, limit),

    annotations: (tenantId: number, id: string, opts?: { kind?: string; limit?: number }) =>
      getObjectAnnotations(db, env, tenantId, id, opts),
    addAnnotation: (input: Parameters<typeof addAnnotation>[2]) => addAnnotation(db, env, input),

    members: (tenantId: number, id: string, limit?: number) => getObjectMembers(db, env, tenantId, id, limit),
    addMember: (input: Parameters<typeof addMember>[2]) => addMember(db, env, input),
    removeMember: (input: Parameters<typeof removeMember>[2]) => removeMember(db, env, input),

    shares: (tenantId: number, id: string) => getObjectShares(db, env, tenantId, id),
    createShare: (input: Parameters<typeof createShareLink>[2]) => createShareLink(db, env, input),
    revokeShare: (tenantId: number, objectId: string, shareId: string) =>
      revokeShareLink(db, env, tenantId, objectId, shareId),
    resolveShare: (token: string) => resolveShareToken(db, token),

    revisions: (tenantId: number, id: string, limit?: number) => getObjectRevisions(db, env, tenantId, id, limit),
    recordRevision: (input: Parameters<typeof recordRevision>[2]) => recordRevision(db, env, input),

    invalidate: (tenantId: number, id: string) => invalidateObject(env, tenantId, id),
  };
}

export type ObjectRegistry = ReturnType<typeof createObjectRegistry>;
