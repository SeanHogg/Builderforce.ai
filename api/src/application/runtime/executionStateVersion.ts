import type { Env } from '../../env';
import { bumpCacheVersion, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * ONE version token per tenant for "which executions are live, and in what state".
 *
 * Every cached reader of that state folds the token into its key: the attention
 * badge (`attentionSnapshot.ts`), the active-runs board (`activeRuns.ts`) and the
 * tenant executions list. Every status change bumps it — the executions-table
 * trigger writes the lifecycle outbox, and draining the outbox
 * (`executionLifecycleOutbox.ts`, inline on the audited path and on the frequent
 * sweep for direct SQL writers) calls {@link bumpExecutionState}. The readers' KV
 * TTL is the backstop for a writer the outbox has not drained yet.
 *
 * The stored key keeps its original `attention:` prefix so tokens already in KV
 * stay valid across the rename.
 */
export const executionStateVersionKey = (tenantId: number): string => `attention:tenant:${tenantId}`;

/** The tenant's current token — fold it into a cache key. */
export function executionStateVersion(env: Env, tenantId: number): Promise<string> {
  return getCacheVersion(env, executionStateVersionKey(tenantId));
}

/** Orphan every cached reading of `tenantId`'s execution state. Best-effort — the TTL is the backstop. */
export async function bumpExecutionState(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  try {
    await bumpCacheVersion(env, executionStateVersionKey(tenantId));
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/executionStateVersion.ts', operation: 'bumpExecutionState', context: { details: { tenantId } } });
  }
}
