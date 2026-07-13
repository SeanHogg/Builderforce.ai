import { and, eq } from 'drizzle-orm';
import type { Db } from '../database/connection';
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
 * Resolved ids are stable, so they are cached per (tenant, account, company) in
 * the isolate to avoid a DB round-trip on every request. The cache is:
 *  - BOUNDED (FIFO eviction past MAX_CACHE_ENTRIES) so a long-lived isolate seeing
 *    many federated (account, company) pairs can't grow it without limit;
 *  - INVALIDATED on segment mutate/delete (see invalidateSegment) so a
 *    suspended/archived/erased segment stops resolving inside the ORIGINATING
 *    isolate at once;
 *  - TTL-BACKSTOPPED (CACHE_TTL_MS): invalidateSegment only reaches the isolate
 *    it runs on, so a warm SIBLING isolate would otherwise serve a deleted
 *    segment's id forever. The per-entry TTL bounds that cross-isolate staleness
 *    to a few minutes while keeping the hot auth path fully in-isolate (no KV
 *    round-trip). A stale entry simply re-resolves against the DB after it lapses.
 */

/** Cap on cached (tenant, account, company) → segmentId entries per isolate. */
const MAX_CACHE_ENTRIES = 10_000;

/** Max age of a cached mapping — the cross-isolate invalidation backstop. */
const CACHE_TTL_MS = 300_000; // 5 minutes

type CacheEntry = { segmentId: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function keyFor(tenantId: number, accountId?: string, companyId?: string): string {
  return `${tenantId}|${accountId ?? ''}|${companyId ?? ''}`;
}

function cacheSet(key: string, segmentId: string): void {
  // Map preserves insertion order — evict the oldest entry when over the bound.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { segmentId, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Drop every cached mapping that resolves to `segmentId`. Call after any change
 * that alters or removes a segment (status flip, plan change, deletion) so the
 * originating isolate stops serving a stale id without waiting for a recycle.
 * Sibling isolates are covered by {@link CACHE_TTL_MS}.
 */
export function invalidateSegment(segmentId: string): void {
  for (const [key, value] of cache) {
    if (value.segmentId === segmentId) cache.delete(key);
  }
}

export interface SegmentClaims {
  accountId?: string;
  companyId?: string;
}

export async function resolveSegment(
  db: Db,
  tenantId: number,
  claims: SegmentClaims = {},
): Promise<string> {
  const { accountId, companyId } = claims;
  const cacheKey = keyFor(tenantId, accountId, companyId);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.segmentId;
  if (cached) cache.delete(cacheKey);

  const id = accountId && companyId
    ? await resolveFederated(db, tenantId, accountId, companyId)
    : await resolveDefault(db, tenantId);

  cacheSet(cacheKey, id);
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
