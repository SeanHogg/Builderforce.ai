/**
 * The per-tenant random salt a board candidate's email ref is an HMAC under.
 *
 * The key used to be derived from the credential-encryption secret. That secret is
 * ROTATED, and rotating it silently changed every ref: an already-imported person would be
 * imported a second time under a new ref, and an ERASED person would stop being recognised
 * — the one failure erasure must never have. A salt stored beside the data it protects
 * changes only if its row is deleted. (No stable hashing secret exists in the environment
 * to use instead, and a new env var would make a deploy-time setting load-bearing for
 * erasure.)
 *
 * Created on first use and never rewritten: two imports racing on a new tenant both try to
 * insert, one wins (`ON CONFLICT DO NOTHING`), and both then read the winner's value.
 *
 * CACHING — L1 ONLY, ON PURPOSE. The read goes through the canonical `getOrSetCached`, but
 * with NO cache env, so it never reaches the KV layer: the salt is HMAC key material, and a
 * copy in a shared KV namespace would put a secret in a second store with its own readers,
 * retention and backups. In-isolate it is the same bytes the isolate already holds while
 * hashing. The L1 entry is TTL-bounded ({@link REF_SALT_L1_TTL_MS}) and single-flight, so
 * concurrent first reads share one load. A salt never changes, so a cached copy cannot go
 * stale; the TTL only bounds how long it sits in memory.
 */

import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { hiringRefSalts } from '../../infrastructure/database/schema/hiring';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { bytesToHex } from '../../domain/shared/bytes';

/** How long a loaded salt stays in isolate memory. */
export const REF_SALT_L1_TTL_MS = 10 * 60_000;

/** Folded into the key so {@link clearRefSaltCache} can drop every tenant at once. */
let generation = 0;

/** Forget cached salts (tests: "a fresh isolate"). */
export function clearRefSaltCache(): void { generation += 1; }

export async function loadRefSalt(db: Db, tenantId: number): Promise<string> {
  return getOrSetCached(
    undefined, // L1 only: a secret never goes to KV (see header)
    `hiring:ref-salt:g${generation}:${tenantId}`,
    () => readOrCreateRefSalt(db, tenantId),
    { l1TtlMs: REF_SALT_L1_TTL_MS },
  );
}

async function readOrCreateRefSalt(db: Db, tenantId: number): Promise<string> {
  const read = async (): Promise<string | undefined> => (await db
    .select({ salt: hiringRefSalts.salt })
    .from(hiringRefSalts)
    .where(scopedToTenant(hiringRefSalts, tenantId))
    .limit(1))[0]?.salt;

  let salt = await read();
  if (!salt) {
    await db
      .insert(hiringRefSalts)
      .values({ tenantId, salt: bytesToHex(crypto.getRandomValues(new Uint8Array(32))) })
      .onConflictDoNothing({ target: hiringRefSalts.tenantId });
    salt = await read();
  }
  if (!salt) throw new Error('The candidate-ref salt could not be created.');
  return salt;
}
