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
 * Cached per isolate — a salt never changes, so a cached copy cannot go stale.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { hiringRefSalts } from '../../infrastructure/database/schema/hiring';
import { bytesToHex } from '../../domain/shared/bytes';

const cache = new Map<number, string>();

/** Forget cached salts (tests). */
export function clearRefSaltCache(): void { cache.clear(); }

export async function loadRefSalt(db: Db, tenantId: number): Promise<string> {
  const known = cache.get(tenantId);
  if (known) return known;
  const read = async (): Promise<string | undefined> => (await db
    .select({ salt: hiringRefSalts.salt })
    .from(hiringRefSalts)
    .where(eq(hiringRefSalts.tenantId, tenantId))
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
  cache.set(tenantId, salt);
  return salt;
}
