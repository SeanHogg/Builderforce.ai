import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * Exponential retry backoff for mailboxes whose watch could not be ARMED.
 *
 * A failed arm leaves no `mailbox_watches` row (the error write targets a row that does
 * not exist yet), so `armUnwatchedMailboxes` found the same unarmable connections —
 * revoked consent, a provider outage, a missing Pub/Sub topic — on every tick and spent a
 * token refresh plus a provider call on each, forever. The attempt count and next-try time
 * live in KV, keyed by connection, so no schema change is needed and the state expires
 * on its own. KV being unbound degrades to the old behaviour (retry every tick).
 */
const KEY = (connectionId: number) => `mailbox:arm-backoff:${connectionId}`;
const BASE_MS = 5 * 60_000;
const CAP_MS = 6 * 60 * 60_000;
const STATE_TTL_SECONDS = 24 * 60 * 60;

/** Delay after the Nth consecutive failure: 5m, 10m, 20m … capped at 6h. */
export function armBackoffMs(attempts: number): number {
  return Math.min(BASE_MS * 2 ** Math.max(0, Math.min(attempts, 12) - 1), CAP_MS);
}

interface BackoffState { attempts: number; nextAtMs: number }

function parse(raw: string | null): BackoffState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BackoffState>;
    return typeof v.attempts === 'number' && typeof v.nextAtMs === 'number' ? { attempts: v.attempts, nextAtMs: v.nextAtMs } : null;
  } catch {
    return null;
  }
}

/** Connection ids still inside their backoff window. One KV read per candidate. */
export async function backedOffConnections(env: Env, connectionIds: readonly number[], nowMs: number): Promise<Set<number>> {
  const kv = env.AUTH_CACHE_KV;
  const out = new Set<number>();
  if (!kv) return out;
  await Promise.all(connectionIds.map(async (id) => {
    try {
      const state = parse(await kv.get(KEY(id)));
      if (state && state.nextAtMs > nowMs) out.add(id);
    } catch (error) {
      reportCaughtError(error, { source: 'application/mailbox/armBackoff.ts', operation: 'backedOffConnections' });
    }
  }));
  return out;
}

export async function recordArmFailure(env: Env, connectionId: number, nowMs: number): Promise<void> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return;
  try {
    const attempts = (parse(await kv.get(KEY(connectionId)))?.attempts ?? 0) + 1;
    await kv.put(KEY(connectionId), JSON.stringify({ attempts, nextAtMs: nowMs + armBackoffMs(attempts) } satisfies BackoffState), { expirationTtl: STATE_TTL_SECONDS });
  } catch (error) {
    reportCaughtError(error, { source: 'application/mailbox/armBackoff.ts', operation: 'recordArmFailure' });
  }
}

export async function clearArmBackoff(env: Env, connectionId: number): Promise<void> {
  try {
    await env.AUTH_CACHE_KV?.delete(KEY(connectionId));
  } catch (error) {
    reportCaughtError(error, { source: 'application/mailbox/armBackoff.ts', operation: 'clearArmBackoff' });
  }
}
