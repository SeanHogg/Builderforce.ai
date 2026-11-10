/**
 * The voice-clone LISTS a client reads — the caller's usable clones (owned +
 * licensed) and the marketplace catalogue — served through the version-token
 * read-through cache, plus the one public projection of a clone row.
 *
 * Every writer that changes a list (enrol, license, delete) invalidates through
 * {@link invalidateUsableClones} / {@link invalidateMarketplaceClones}, so the cache
 * keys are spelled once, here.
 */

import { desc, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { studioVoiceClones } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { listUsableClones } from './voiceCloneList';

const usableVersionKey = (tenantId: number): string => `voiceclones:${tenantId}`;
const MARKETPLACE_VERSION_KEY = 'voiceclones:marketplace';

/** A clone row trimmed to what clients need. No-leak contract: R2 keys and the
 *  speaker embedding are NEVER in a list/marketplace/create payload, for anyone.
 *  The embedding is returned ONLY by the owner-only `GET /:id/embedding`, to the
 *  owner's own authenticated session (never to buyers/licensees/other users). */
export function toPublicClone(row: typeof studioVoiceClones.$inferSelect, viewer?: { tenantId: number }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider,
    visibility: row.visibility,
    status: row.status,
    priceMillicents: row.priceMillicents,
    consentAttested: Boolean(row.consentAttestedAt),
    hasReference: Boolean(row.referenceKey),
    // The owner's own IDE project: a licensee or marketplace browser never learns it.
    ideProjectId: viewer?.tenantId === row.tenantId ? row.ideProjectId ?? null : null,
    createdAt: row.createdAt,
  };
}

/** Clones the caller owns or has licensed, public projection, cached per tenant. */
export async function cachedUsableClones(db: Db, env: Env, tenantId: number) {
  const version = await getCacheVersion(env, usableVersionKey(tenantId));
  return getOrSetCached(
    env,
    `voiceclones:${tenantId}:v:${version}`,
    async () => {
      // Owned + licensed (cross-tenant, by license) — see listUsableClones.
      return (await listUsableClones(db, tenantId)).map((row) => toPublicClone(row, { tenantId }));
    },
    { kvTtlSeconds: 300 },
  );
}

/** The published marketplace catalogue, public projection, cached platform-wide. */
export async function cachedMarketplaceClones(db: Db, env: Env) {
  const version = await getCacheVersion(env, MARKETPLACE_VERSION_KEY);
  return getOrSetCached(
    env,
    `voiceclones:marketplace:v:${version}`,
    async () => {
      const rows = await db
        .select()
        .from(studioVoiceClones)
        .where(acrossTenants(studioVoiceClones, 'public_catalogue', eq(studioVoiceClones.visibility, 'marketplace')))
        .orderBy(desc(studioVoiceClones.createdAt)).limit(LIST_ROW_CAP);
      return rows.filter((r) => r.status === 'published').map((row) => toPublicClone(row));
    },
    { kvTtlSeconds: 300 },
  );
}

/** Drop a tenant's cached usable-clones list (its own or a licensed clone changed). */
export async function invalidateUsableClones(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, usableVersionKey(tenantId));
}

/** Drop the cached marketplace catalogue (a marketplace clone was added or removed). */
export async function invalidateMarketplaceClones(env: Env): Promise<void> {
  await bumpCacheVersion(env, MARKETPLACE_VERSION_KEY);
}
