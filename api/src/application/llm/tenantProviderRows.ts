/**
 * ONE cached read of a tenant's `tenant_llm_provider_keys` rows.
 *
 * The gateway's credential resolution used to run six parallel SELECTs against this
 * table per request (four per-provider OAuth/api-key lookups, the vendor-key sweep and
 * the configured-provider list). They all read the same handful of columns for the same
 * tenant, so they now derive from this single read-through: warm requests cost zero
 * statements and the empty result ("no BYO account", the common case) is cached too.
 *
 * Only CIPHERTEXT is cached — decryption happens after the cache read, so KV never holds
 * a usable secret. Every writer of the table invalidates via
 * {@link invalidateTenantProviderRows}; the OAuth resolvers additionally re-read with
 * `fresh` before refreshing so a rotation made in another isolate is never raced with a
 * retired refresh token.
 */

import { asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { tenantLlmProviderKeys } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

export interface TenantProviderRow {
  id: string;
  provider: string;
  keyEnc: string | null;
  authType: string | null;
  priority: number | null;
}

export const tenantProviderRowsCacheKey = (tenantId: number): string => `byo-rows:${tenantId}`;

export async function invalidateTenantProviderRows(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, tenantProviderRowsCacheKey(tenantId));
}

/** All of the tenant's provider rows, ordered by BYO precedence (`priority` ASC, unset last,
 *  then provider). Throws on a DB error — callers pick their own degrade. */
export async function loadTenantProviderRows(
  env: Env,
  tenantId: number,
  opts: { fresh?: boolean } = {},
): Promise<TenantProviderRow[]> {
  if (opts.fresh) await invalidateTenantProviderRows(env, tenantId);
  return getOrSetCached(
    env,
    tenantProviderRowsCacheKey(tenantId),
    async () => {
      const selected = await buildDatabase(env)
        .select({
          id: tenantLlmProviderKeys.id,
          provider: tenantLlmProviderKeys.provider,
          keyEnc: tenantLlmProviderKeys.keyEnc,
          authType: tenantLlmProviderKeys.authType,
          priority: tenantLlmProviderKeys.priority,
        })
        .from(tenantLlmProviderKeys)
        .where(eq(tenantLlmProviderKeys.tenantId, tenantId))
        // `priority` NULL = unset and MUST sort last (a set precedence always wins).
        .orderBy(sql`${tenantLlmProviderKeys.priority} ASC NULLS LAST`, asc(tenantLlmProviderKeys.provider));
      return selected.map((r) => ({
        id: r.id,
        provider: r.provider,
        keyEnc: r.keyEnc ?? null,
        authType: r.authType ?? null,
        priority: typeof r.priority === 'number' ? r.priority : null,
      }));
    },
    { kvTtlSeconds: 3600, l1TtlMs: 15_000 },
  );
}
