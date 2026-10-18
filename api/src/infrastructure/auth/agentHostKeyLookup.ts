/**
 * Agent-host API key → host, through the ONE key-resolution cache.
 *
 * Every `/api/agent-hosts/:id/*` request (heartbeat, cron poll, tool-audit batches…)
 * and every LLM-gateway call from a host authenticates with the same `bfa_*`/`clk_*`
 * key. The stored hash is a plain SHA-256, so the key can be resolved BY HASH under
 * `auth:clk:<hash>` — a cache hit costs no database read, which is what lets an idle
 * fleet leave the core Neon compute asleep. The gateway door and both verify doors
 * ({@link verifyAgentHostKey}) share this loader, so they write a byte-identical
 * value under the shared cache key.
 *
 * Invalidation: status change, delete, limit change and provisioning all call
 * `invalidateAgentHostKeyCache` (keyResolutionCache) — see its header. Hosts have no
 * key-rotation path (a key is minted once at registration), so those are every write
 * of `api_key_hash`/`status`/`token_daily_limit`.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../database/connection';
import { agentHosts } from '../database/schema';
import { hashSecret } from './HashService';
import { resolveKeyCached, type ResolvedKey } from './keyResolutionCache';

/** What a resolved host key carries (the cached payload). */
export interface ResolvedAgentHostKey {
  id: number;
  tenantId: number;
  tokenDailyLimit: number | null;
}

/**
 * DB loader for an agent-host key hash → its cached auth envelope. A deactivated or
 * suspended host resolves to a rejection (the direct-key door must not authenticate
 * one), and that rejection is cached too — `invalidateAgentHostKeyCache` on the status
 * change is what flips it back.
 */
export async function loadAgentHostKeyByHash(db: Db, keyHash: string): Promise<ResolvedKey> {
  const [r] = await db
    .select({
      id:              agentHosts.id,
      tenantId:        agentHosts.tenantId,
      status:          agentHosts.status,
      tokenDailyLimit: agentHosts.tokenDailyLimit,
    })
    .from(agentHosts)
    .where(eq(agentHosts.apiKeyHash, keyHash))
    .limit(1);
  if (!r || r.status !== 'active') return { ok: false, reason: 'Invalid or inactive agentHost API key' };
  return {
    ok: true,
    payload: { id: r.id, tenantId: r.tenantId, tokenDailyLimit: r.tokenDailyLimit ?? null },
  };
}

/**
 * Resolve a raw host key (cache first). `null` = unknown / inactive key. `env` is
 * REQUIRED so a caller cannot silently skip the cache (an unbound KV still falls through
 * to the database inside the cache helper).
 */
export async function resolveAgentHostKey(
  env: Env,
  db: Db,
  rawKey: string,
): Promise<ResolvedAgentHostKey | null> {
  const keyHash = await hashSecret(rawKey);
  const resolved = await resolveKeyCached(env, 'clk', keyHash, () => loadAgentHostKeyByHash(db, keyHash));
  return resolved.ok ? (resolved.payload as unknown as ResolvedAgentHostKey) : null;
}

/** Verify `rawKey` belongs to active host `id`: hash → cached resolve → id must match. */
export async function verifyAgentHostKey(
  env: Env,
  db: Db,
  id: number,
  rawKey?: string | null,
): Promise<{ id: number; tenantId: number } | null> {
  if (!rawKey) return null;
  const host = await resolveAgentHostKey(env, db, rawKey);
  return host && host.id === id ? { id: host.id, tenantId: host.tenantId } : null;
}
