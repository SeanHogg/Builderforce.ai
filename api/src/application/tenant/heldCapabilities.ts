/**
 * WHICH MARKETPLACE CAPABILITIES THIS WORKSPACE HOLDS (PRD 33 §4.2 step 3).
 *
 * The licence an install writes (`template_licenses`) IS the entitlement: there is
 * no second "enabled" flag to drift from it. This is the ONE read of that fact —
 * the feature gate (`resolveFeatureEntitlement`), the capability state route and
 * the replay commerce code all ask here, and `replayPacks.tenantInstalledReplay`
 * (the copy this replaced) is gone.
 *
 * A capability is held by the WORKSPACE, not by the member who pressed Install, so
 * any live licence from any member counts. Only platform-published capability rows
 * count (`tenant_id IS NULL`, `publisher_ref = 'builderforce'`): a seller cannot
 * publish a look-alike listing and grant access with it.
 *
 * Cached per tenant; every licence write and revoke calls
 * {@link capabilityLicenceChanged}, so an install (or a refund) takes effect on the
 * next request rather than after a TTL.
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, templateLicenses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import {
  CAPABILITY_LISTING_KIND,
  CAPABILITY_PUBLISHER_REF,
  featuresForCapabilities,
} from '../../domain/tenant/capabilityFeatures';
import type { PlanFeature } from '../../domain/tenant/planFeatures';

/** Safety net only — every licence writer invalidates explicitly. */
const HELD_TTL_SECONDS = 10 * 60;

export const heldCapabilitiesCacheKey = (tenantId: number): string => `capability:held:t:${tenantId}`;

/**
 * Slugs of the platform capability listings this tenant holds a live licence for
 * (not revoked, not expired). Uncached: the cached form is
 * {@link heldCapabilitySlugsCached}.
 */
export async function heldCapabilitySlugs(db: Db, tenantId: number, now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select({ slug: catalogItems.slug })
    .from(templateLicenses)
    .innerJoin(catalogItems, eq(catalogItems.id, templateLicenses.catalogItemId))
    .where(scopedToTenant(
      templateLicenses,
      tenantId,
      isNull(templateLicenses.revokedAt),
      or(isNull(templateLicenses.expiresAt), gt(templateLicenses.expiresAt, now)),
      and(
        eq(catalogItems.kind, CAPABILITY_LISTING_KIND),
        isNull(catalogItems.tenantId),
        eq(catalogItems.publisherRef, CAPABILITY_PUBLISHER_REF),
      ),
    ));
  return [...new Set(rows.map((row) => row.slug))].sort();
}

/** {@link heldCapabilitySlugs} through the read-through cache. */
export async function heldCapabilitySlugsCached(
  env: Env | undefined,
  db: Db | undefined,
  tenantId: number,
): Promise<string[]> {
  return getOrSetCached(env, heldCapabilitiesCacheKey(tenantId), async () => {
    const handle = db ?? (env ? buildDatabase(env) : null);
    if (!handle) throw new Error('heldCapabilitySlugs needs a worker env or a database handle');
    return heldCapabilitySlugs(handle, tenantId);
  }, { kvTtlSeconds: HELD_TTL_SECONDS });
}

/** The plan features this tenant holds through capability licences. */
export async function heldCapabilityFeatures(
  env: Env | undefined,
  db: Db | undefined,
  tenantId: number,
): Promise<PlanFeature[]> {
  return featuresForCapabilities(await heldCapabilitySlugsCached(env, db, tenantId));
}

/** Does this tenant hold the capability listed under `slug`? */
export async function tenantHoldsCapability(
  env: Env | undefined,
  db: Db | undefined,
  tenantId: number,
  slug: string,
): Promise<boolean> {
  return (await heldCapabilitySlugsCached(env, db, tenantId)).includes(slug);
}

/**
 * Call after ANY write to a tenant's `template_licenses` (grant, re-grant, revoke).
 * Cheap and unconditional: a licence for a non-capability listing simply leaves the
 * set unchanged on the next read.
 */
export async function capabilityLicenceChanged(env: CacheEnv, tenantId: number): Promise<void> {
  await invalidateCached(env, heldCapabilitiesCacheKey(tenantId));
}
