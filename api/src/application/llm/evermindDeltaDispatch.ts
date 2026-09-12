/**
 * Dispatch a PRE-DIFFED weight delta to a project's coordinator (the single writer).
 *
 * The transport half of the delta door; the contract (shape, size cap, admission
 * rule) lives in {@link ./evermindDeltaLearn}. Kept out of `projectEvermind.ts` so
 * that file does not grow a second producer entry point — it already owns the text
 * door ({@link dispatchProjectEvermindLearnText}).
 *
 * Returns the coordinator's answer verbatim (status + body) so the gateway can hand a
 * producer exactly what it branches on: 200 queued, 409 + `headVersion` (stale base —
 * rebase), 409 unseeded, 423 frozen, 413 too large. No-op (503) when the coordinator
 * binding is unset.
 */
import type { Env } from '../../env';
import { coordinatorStub, type LearnDispatchResult } from './projectEvermind';
import type { DeltaLearnRequest } from './evermindDeltaLearn';

export async function dispatchProjectEvermindLearn(
  env: Env,
  tenantId: number,
  projectId: number,
  request: DeltaLearnRequest,
): Promise<LearnDispatchResult> {
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return { ok: false, status: 503, body: { error: 'concurrent learning not configured (no coordinator binding)' } };
  const res = await stub.fetch('https://coordinator/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      projectId,
      diff: request.diff,
      baseVersion: request.baseVersion,
      ...(request.weight !== undefined ? { weight: request.weight } : {}),
      ...(request.label ? { label: request.label } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}
