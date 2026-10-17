/**
 * The cached half of xAPI Basic authentication: "what does this public key name?"
 *
 * ── WHAT IS CACHED, AND WHAT IS NOT ─────────────────────────────────────────
 * Keyed on sha256(public key) — the Basic USERNAME, never the password. The value
 * is the credential's row facts (tenant, connection, status, direction, label)
 * plus a SHA-256 of the sealed secret. The raw secret never enters the cache: the
 * caller hashes what it was presented and compares in constant time, the same
 * shape every hashed API key on this platform already has (`verifySecret`).
 * `bfx` secrets are 128 random bits, so an unsalted digest is not guessable.
 *
 * An unknown key is cached too (`found: false`), so a stranger cycling one dead
 * key costs one database read per TTL, not one per request.
 *
 * ── WHY A SHORT TTL AND AN EXPLICIT INVALIDATION ────────────────────────────
 * Revocation must still be immediate. Every writer that changes what a key
 * authenticates as — issue, outbound register/upsert, revoke — calls
 * {@link invalidateLrsCredentialLookup} with the key. The TTL is only the backstop
 * for a writer that does not (a tenant-delete cascade), so a revoked principal
 * keeps access for at most {@link LRS_AUTH_KV_TTL_SECONDS}.
 *
 * `recordForwardOutcome` flips OUTBOUND rows between connected/expired without
 * invalidating, deliberately: an outbound key presented inbound is refused either
 * way (403 vs 401), so a stale status there can only change which refusal is sent.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connections } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { readConnectionApiKey } from '../integrations/connectionApiKey';

/** The `connections.vendor` of every LRS row. Lives here (re-exported by
 *  `lrsCredentials`) so the lookup needs no import back into that module. */
export const LRS_VENDOR = 'lrs';

/** KV backstop TTL (the KV floor). Writers invalidate; this only bounds a missed one. */
export const LRS_AUTH_KV_TTL_SECONDS = 60;
/** L1 shorter than KV, so an isolate's copy never outlives the backstop. */
const LRS_AUTH_L1_TTL_MS = 15_000;

export type LrsCredentialLookup =
  | { found: false }
  | {
      found: true;
      tenantId: number;
      connectionId: number;
      status: string;
      /** Raw `connections.config.direction`; the caller interprets it. */
      config: unknown;
      label: string;
      /** sha256 hex of the sealed secret, or null when no secret is stored. */
      secretHash: string | null;
    };

/** The ONE spelling of the cache key — read and invalidated through this. */
export async function lrsCredentialLookupKey(publicKey: string): Promise<string> {
  return `lrs:auth:${await hashSecret(publicKey)}`;
}

/** Resolve a presented public key, cache first. Zero round trips on a warm hit. */
export async function lookupLrsCredential(db: Db, env: Env, publicKey: string): Promise<LrsCredentialLookup> {
  return getOrSetCached<LrsCredentialLookup>(env, await lrsCredentialLookupKey(publicKey), async () => {
    const [row] = await db.select({
      id: connections.id,
      tenantId: connections.tenantId,
      status: connections.status,
      displayName: connections.displayName,
      config: connections.config,
    })
      .from(connections)
      .where(acrossTenants(connections, 'share_token',
        eq(connections.vendor, LRS_VENDOR),
        eq(connections.externalAccount, publicKey)))
      .limit(1);
    if (!row) return { found: false };

    // Only open the sealed secret for a row that could authenticate — a revoked
    // row has had its secret destroyed, and an unconnected one is refused anyway.
    const secret = row.status === 'connected'
      ? await readConnectionApiKey(db, env, row.tenantId, row.id)
      : null;
    return {
      found: true,
      tenantId: row.tenantId,
      connectionId: row.id,
      status: row.status,
      config: row.config,
      label: row.displayName,
      secretHash: secret ? await hashSecret(secret) : null,
    };
  }, { kvTtlSeconds: LRS_AUTH_KV_TTL_SECONDS, l1TtlMs: LRS_AUTH_L1_TTL_MS });
}

/** Drop the cached lookup for a public key. Call from EVERY write that changes what
 *  the key authenticates as (issue, register/upsert, revoke, delete). */
export async function invalidateLrsCredentialLookup(env: Env, publicKey: string): Promise<void> {
  await invalidateCached(env, await lrsCredentialLookupKey(publicKey));
}
