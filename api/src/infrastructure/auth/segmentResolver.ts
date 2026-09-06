import { and, eq } from 'drizzle-orm';
import type { Db } from '../database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../cache/readThroughCache';
import { segments } from '../database/schema';

/**
 * resolveSegment — the SINGLE chokepoint that maps a request's tenant (+ optional
 * federated account/company claims) to a Segment id. Every business request runs
 * inside a (tenantId, segmentId) scope; this is where segmentId comes from.
 *
 *  - No claims (a 'single'/direct tenant): the tenant's default segment.
 *  - With (accountId, companyId) claims (a 'segmented' tenant whose IdP is an
 *    external host): the matching Segment, lazy-created on first sight.
 *
 * Resolved ids are stable, so they are cached per (tenant, account, company)
 * through the canonical read-through cache (`getOrSetCached`: L1 in-isolate, L2 KV
 * when the caller passes `env`) rather than a private Map. The cache is:
 *  - INVALIDATED on segment mutate/delete (see invalidateSegment) in both layers,
 *    so a suspended/archived/erased segment stops resolving at once;
 *  - TTL-BACKSTOPPED (CACHE_TTL_SECONDS) for any isolate the invalidation could not
 *    reach. The per-entry TTL bounds that staleness to a few minutes while keeping
 *    the hot auth path in-isolate for callers without `env` (no KV
 *    round-trip). A stale entry simply re-resolves against the DB after it lapses.
 */

/** How long a resolved mapping may be served before it is re-read — the cross-isolate backstop. */
const CACHE_TTL_SECONDS = 300;

/** Which cache keys resolved to each segment, so a segment mutation can drop exactly them. */
const keysBySegment = new Map<string, Set<string>>();

function keyFor(tenantId: number, accountId?: string, companyId?: string): string {
  return `segment:${tenantId}|${accountId ?? ''}|${companyId ?? ''}`;
}

/**
 * Drop every cached mapping that resolves to `segmentId` — both layers when `env` is
 * given. Call after any change that alters or removes a segment (status flip, plan
 * change, deletion) so the next request re-resolves instead of serving a stale id.
 */
export async function invalidateSegment(segmentId: string, env?: Env): Promise<void> {
  const keys = keysBySegment.get(segmentId);
  if (!keys) return;
  keysBySegment.delete(segmentId);
  await Promise.all([...keys].map((key) => invalidateCached(env, key)));
}

export interface SegmentClaims {
  accountId?: string;
  companyId?: string;
}

export async function resolveSegment(
  db: Db,
  tenantId: number,
  claims: SegmentClaims = {},
  env?: Env,
): Promise<string> {
  const { accountId, companyId } = claims;
  const cacheKey = keyFor(tenantId, accountId, companyId);
  const id = await getOrSetCached(env, cacheKey, () => (accountId && companyId
    ? resolveFederated(db, tenantId, accountId, companyId)
    : resolveDefault(db, tenantId)), { kvTtlSeconds: CACHE_TTL_SECONDS, l1TtlMs: CACHE_TTL_SECONDS * 1000 });
  const keys = keysBySegment.get(id) ?? new Set<string>();
  keys.add(cacheKey);
  keysBySegment.set(id, keys);
  return id;
}

async function resolveDefault(db: Db, tenantId: number): Promise<string> {
  const [row] = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.tenantId, tenantId), eq(segments.isDefault, true)))
    .limit(1);
  if (!row) {
    // Every tenant is backfilled a default segment (migration 0054); a miss means
    // the tenant row predates that invariant or was created out-of-band.
    throw new Error(`No default segment for tenant ${tenantId}`);
  }
  return row.id;
}

async function resolveFederated(
  db: Db,
  tenantId: number,
  accountId: string,
  companyId: string,
): Promise<string> {
  const existing = await findFederated(db, tenantId, accountId, companyId);
  if (existing) return existing;

  // Lazy-create on first sight (the Segment provisioning handshake, doc 05 §3).
  await db
    .insert(segments)
    .values({
      tenantId,
      externalAccountId: accountId,
      externalCompanyId: companyId,
      displayName: companyId,
      slug: `${accountId}-${companyId}`.slice(0, 255),
      isDefault: false,
    })
    .onConflictDoNothing();

  // Re-read so a concurrent creator and this caller converge on the same row.
  const created = await findFederated(db, tenantId, accountId, companyId);
  if (!created) throw new Error(`Failed to provision segment for ${accountId}/${companyId}`);
  return created;
}

async function findFederated(
  db: Db,
  tenantId: number,
  accountId: string,
  companyId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(
      eq(segments.tenantId, tenantId),
      eq(segments.externalAccountId, accountId),
      eq(segments.externalCompanyId, companyId),
    ))
    .limit(1);
  return row?.id ?? null;
}
