/**
 * The transport half of the federated ML-head doors (`evermindMlHeads`): hand a head
 * contribution to the project's coordinator (the single writer), and read the merged
 * head back — cached, keyed on a version token the coordinator bumps on every accepted
 * merge, so a fleet of hosts refreshing their head costs a KV read, not a DO round trip.
 *
 * The LM door's twin is {@link ./evermindDeltaDispatch}; kept apart so neither grows a
 * target branch.
 */
import type { Env } from '../../env';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { coordinatorStub, type LearnDispatchResult } from './projectEvermind';

/** The version token a project's head for `target` is cached under; bumped on merge. */
export function mlHeadVersionKey(tenantId: number, projectId: number, target: string): string {
  return `evermind-ml-head:${tenantId}:${projectId}:${target}`;
}

const NO_COORDINATOR: LearnDispatchResult = { ok: false, status: 503, body: { error: 'concurrent learning not configured (no coordinator binding)' } };

/**
 * Send a head contribution (the delta-wire body plus its `holdout` rows) to the
 * coordinator. The body is passed through: the coordinator trusts no front door and
 * parses it again with the head's target. Its answer is returned verbatim — 200 queued,
 * 409 + `headVersion` (stale base: rebase), 423 frozen, 400 malformed.
 */
export async function dispatchProjectEvermindHeadLearn(
  env: Env,
  tenantId: number,
  projectId: number,
  body: Record<string, unknown>,
): Promise<LearnDispatchResult> {
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return NO_COORDINATOR;
  const res = await stub.fetch('https://coordinator/learn-head', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, tenantId, projectId }),
  });
  const answer = (await res.json().catch((error: unknown) => ({ ok: false, error: `coordinator answered unreadable JSON: ${String(error)}` }))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body: answer };
}

/** The project's merged head for `target` (`{ target, version, params, evalLoss }`), cached until the next merge. */
export async function readProjectEvermindMlHead(
  env: Env,
  tenantId: number,
  projectId: number,
  target: string,
): Promise<LearnDispatchResult> {
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return NO_COORDINATOR;
  const versionKey = mlHeadVersionKey(tenantId, projectId, target);
  const token = await getCacheVersion(env, versionKey);
  return getOrSetCached(env, `${versionKey}:v:${token}`, async () => {
    const res = await stub.fetch(`https://coordinator/ml-head?target=${encodeURIComponent(target)}`);
    const body = (await res.json()) as Record<string, unknown>;
    // Only a served head is worth caching; anything else is thrown so the next read retries.
    if (!res.ok) throw new Error(`coordinator ml-head read answered ${res.status}: ${String(body.error ?? '')}`);
    return { ok: true, status: 200, body };
  }, { kvTtlSeconds: 86_400 });
}
